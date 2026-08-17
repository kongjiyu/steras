/**
 * M3 round N+1 — pre-Workstream-1 data setup (one-shot).
 *
 * Locked decisions from docs/team-handoffs/M3_INTEGRATION_CONTRACT.md:
 *   - A1: M3 owns `officers/{uid}` sub-collection
 *        (top-level, parallel to `users/{uid}`).
 *   - A2: venues get `state: string`; all current authority officers
 *        + venues = 'Selangor'.
 *   - A3: 'Manual Review Required' added to EventStatus enum (type-level only).
 *   - C1: seed uat-motac@steras.test user.
 *   - B2: generate the missing `event_controls` data with Stage 1/2 sub-collections
 *        for all approved events (production had empty event_controls collection).
 *
 * Safe to re-run: each section is idempotent (writes overwrite by id).
 * Run:  node scripts/seedM3RoundN1.js
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const SA_PATH = path.resolve(
  process.env.STERAS_SA_PATH ??
  'C:/Users/HP/Website_Project/STERAS - Collaborative Asm/steras/linkos-496505-firebase-adminsdk-fbsvc-a951ea775c.json',
);

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(SA_PATH, 'utf-8'))) });
const db = admin.firestore();
const now = Date.now();

const SELANGOR = 'Selangor';

const OFFICER_SEED = [
  { uid: 'mmcccuLb5kQOKGdf2eECQOiAS7h2', email: 'uat-pdrm@steras.test',  name: 'PDRM UAT Reviewer',  authorityType: 'PDRM'  },
  { uid: 'sKCMYylLOpY1dabTFcRwrxb0y0c2', email: 'uat-bomba@steras.test', name: 'BOMBA UAT Reviewer', authorityType: 'BOMBA' },
  { uid: 'qjLsLI8ZSJNX5t6HlsrRTQYG9Bl2', email: 'uat-kkm@steras.test',   name: 'KKM UAT Reviewer',   authorityType: 'KKM'   },
  { uid: 'efL2zcnyExZqvciYoq5V0oZZMPn1', email: 'uat-dbkl@steras.test',  name: 'DBKL UAT Reviewer',  authorityType: 'DBKL'  },
  // NEW per C1: seed MOTAC officer
  { uid: 'motacUatOfficerUid000000000001', email: 'uat-motac@steras.test', name: 'MOTAC UAT Reviewer', authorityType: 'MOTAC' },
];

async function seedOfficers() {
  console.log('--- 1. Seeding officers/{uid} (5 entries, all Selangor) ---');
  const batch = db.batch();
  for (const o of OFFICER_SEED) {
    const ref = db.collection('officers').doc(o.uid);
    batch.set(ref, {
      uid: o.uid,
      authorityType: o.authorityType,
      state: SELANGOR,
      scopeType: 'state',
      workloadCount: 0,
      workloadLimit: 5,
      active: true,
      createdAt: now,
      updatedAt: now,
    }, { merge: true });
    console.log(`  officers/${o.uid} -> ${o.authorityType} (state=${SELANGOR})`);
  }
  await batch.commit();
  console.log(`  ✓ ${OFFICER_SEED.length} officers written`);
}

async function seedMotacUser() {
  console.log('--- 2. Seeding uat-motac user (per C1) ---');
  const uid = 'motacUatOfficerUid000000000001';
  await db.collection('users').doc(uid).set({
    uid,
    name: 'MOTAC UAT Reviewer',
    email: 'uat-motac@steras.test',
    role: 'authority',
    authorityType: 'MOTAC',
    phone: '+60 12-000 0000',
    createdAt: now,
    updatedAt: now,
  }, { merge: true });
  console.log(`  users/${uid} -> role=authority authorityType=MOTAC`);
}

async function addStateToVenues() {
  console.log('--- 3. Adding state=Selangor to all venues ---');
  const venues = await db.collection('venues').get();
  let count = 0;
  for (const v of venues.docs) {
    const data = v.data();
    if (data.state === SELANGOR) {
      console.log(`  venues/${v.id} already has state=${SELANGOR}, skipping`);
      continue;
    }
    await v.ref.update({ state: SELANGOR });
    count++;
    console.log(`  venues/${v.id} (${data.name}) -> state=Selangor`);
  }
  console.log(`  ✓ ${count} venues updated`);
}

async function generateMissingEventControls() {
  console.log('--- 4. Generating event_controls + Stage 1/2 docs for approved events ---');
  // Per B2: production had an empty event_controls collection. Generate
  // a default set per approved event (one control per requiredAuthority,
  // 3 placeholder Stage 1 docs + 1 Stage 2 image per control).
  const events = await db.collection('events').where('status', '==', 'Approved').get();
  if (events.empty) {
    console.log('  no approved events found, skipping');
    return;
  }
  let controlsCreated = 0;
  for (const ev of events.docs) {
    const evData = ev.data();
    const versionId = evData.currentVersionId || 'v1';
    const required = evData.requiredAuthorities || [];
    console.log(`  event ${ev.id} (${required.join(', ')})`);
    for (const auth of required) {
      const controlId = `${ev.id}-ctrl-${auth.toLowerCase()}`;
      const controlRef = ev.ref.collection('event_controls').doc(controlId);
      // Skip if it already exists (idempotent re-runs)
      const existing = await controlRef.get();
      if (existing.exists) {
        console.log(`    - control ${controlId} already exists, skipping`);
        continue;
      }
      const stage1Requirements = [
        { docType: 'application', label: `${auth} event notification acknowledgement`, required: true },
        { docType: 'license',     label: `${auth} venue operating licence`,           required: true },
        { docType: 'insurance',   label: `${auth} public liability insurance`,        required: true },
      ];
      await controlRef.set({
        controlId,
        eventId: ev.id,
        versionId,
        controlName: `${auth} presence at venue`,
        authority: auth,
        stageRequirement: 'stage1_and_stage2',
        stage1Requirements,
        stage2Requirement: { kind: 'image', label: `Photo of ${auth} personnel on-site` },
        controlItemVersion: 1,
        label: 'pending',
        createdAt: now,
        updatedAt: now,
      });
      // Seed 3 placeholder Stage 1 docs (pending_submission) so the
      // Q1-refactored verifyStage1Doc has something to operate on.
      for (const req of stage1Requirements) {
        const docId = `${controlId}-s1-${req.docType}`;
        await controlRef.collection('stage1_docs').doc(docId).set({
          docId,
          docType: req.docType,
          label: req.label,
          status: 'pending_submission',
          uploadedAt: now,
        });
      }
      // 1 placeholder Stage 2 doc (pending_public_confirmation)
      const s2DocId = `${controlId}-s2-photo`;
      await controlRef.collection('stage2_docs').doc(s2DocId).set({
        docId: s2DocId,
        imageUrl: `https://linkos-496505.web.app/placeholders/${controlId}.jpg`,
        uploadedAt: now,
        uploadedBy: evData.organizerId || 'system',
        publicConfirmCount: 0,
        published: false,
      });
      controlsCreated++;
      console.log(`    + ${controlId} (3 stage1 + 1 stage2)`);
    }
  }
  console.log(`  ✓ ${controlsCreated} controls generated across ${events.size} approved events`);
}

async function main() {
  try {
    await seedOfficers();
    await seedMotacUser();
    await addStateToVenues();
    await generateMissingEventControls();
    console.log('\n✅ M3 round N+1 setup complete.');
    process.exit(0);
  } catch (err) {
    console.error('FATAL:', err);
    process.exit(1);
  }
}

main();
