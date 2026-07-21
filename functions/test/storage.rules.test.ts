import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';

let environment: RulesTestEnvironment;

beforeAll(async () => {
  const [firestoreHost, firestorePort] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
  const [storageHost, storagePort] = (process.env.FIREBASE_STORAGE_EMULATOR_HOST ?? '127.0.0.1:9199').split(':');
  environment = await initializeTestEnvironment({
    projectId: 'steras-test',
    firestore: { host: firestoreHost, port: Number(firestorePort), rules: readFileSync('../firestore.rules', 'utf8') },
    storage: { host: storageHost, port: Number(storagePort), rules: readFileSync('../storage.rules', 'utf8') },
  });
});

afterEach(async () => {
  await environment.clearFirestore();
  await environment.clearStorage();
});
afterAll(() => environment.cleanup());

async function seedEditableEvent() {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'users/organizer-1'), { role: 'organizer' });
    await setDoc(doc(context.firestore(), 'events/event-1'), {
      organizerId: 'organizer-1', status: 'Draft', editableVersionId: 'v1',
    });
  });
}

describe('Storage security rules', () => {
  it('allows supported uploads only inside the editable version', async () => {
    await seedEditableEvent();
    const storage = environment.authenticatedContext('organizer-1').storage();
    const bytes = new Uint8Array([1, 2, 3]);
    await assertSucceeds(uploadBytes(ref(storage, 'event_documents/event-1/v1/plan.pdf'), bytes, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(storage, 'event_documents/event-1/v1/plan.pdf'), bytes, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(storage, 'event_documents/event-1/v2/plan.pdf'), bytes, { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(storage, 'event_documents/event-1/v1/script.exe'), bytes, { contentType: 'application/octet-stream' }));
    await assertFails(uploadBytes(ref(storage, 'event_documents/event-1/v1/empty.pdf'), new Uint8Array(), { contentType: 'application/pdf' }));
    await assertFails(uploadBytes(ref(storage, 'event_documents/event-1/v1/vector.svg'), bytes, { contentType: 'image/svg+xml' }));
    await assertFails(uploadBytes(ref(storage, `event_documents/event-1/v1/${'x'.repeat(201)}.pdf`), bytes, { contentType: 'application/pdf' }));
  });

  it('allows only the owner and assigned authorities to read submitted evidence', async () => {
    await seedEditableEvent();
    const organizer = environment.authenticatedContext('organizer-1');
    const filePath = 'event_documents/event-1/v1/submitted.pdf';
    await assertSucceeds(uploadBytes(ref(organizer.storage(), filePath), new Uint8Array([1, 2, 3]), { contentType: 'application/pdf' }));
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'users/pdrm-1'), { role: 'authority', authorityType: 'PDRM' });
      await setDoc(doc(context.firestore(), 'users/kkm-1'), { role: 'authority', authorityType: 'KKM' });
      await updateDoc(doc(context.firestore(), 'events/event-1'), { status: 'Pending', editableVersionId: null, requiredAuthorities: ['PDRM'] });
    });

    await assertSucceeds(getBytes(ref(organizer.storage(), filePath)));
    await assertSucceeds(getBytes(ref(environment.authenticatedContext('pdrm-1').storage(), filePath)));
    await assertFails(getBytes(ref(environment.authenticatedContext('kkm-1').storage(), filePath)));
    await assertFails(getBytes(ref(environment.unauthenticatedContext().storage(), filePath)));
  });

  it('prevents deletion after the version is submitted', async () => {
    await seedEditableEvent();
    const organizer = environment.authenticatedContext('organizer-1');
    const fileReference = ref(organizer.storage(), 'event_documents/event-1/v1/locked.pdf');
    await assertSucceeds(uploadBytes(fileReference, new Uint8Array([1]), { contentType: 'application/pdf' }));
    await environment.withSecurityRulesDisabled((context) => updateDoc(doc(context.firestore(), 'events/event-1'), { status: 'Pending', editableVersionId: null }));
    await assertFails(deleteObject(fileReference));
  });
});
