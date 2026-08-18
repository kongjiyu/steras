import { deleteApp, initializeApp } from 'firebase-admin/app';
import { GeoPoint, Timestamp, getFirestore } from 'firebase-admin/firestore';
import { afterAll, describe, expect, it } from 'vitest';
import { decodeFirestoreValue, encodeFirestoreValue } from './firestoreBackupCodec';

const app = initializeApp({ projectId: 'steras-codec-test' }, 'steras-codec-test');
const db = getFirestore(app);

afterAll(() => deleteApp(app));

describe('Firestore backup codec', () => {
  it('round-trips Firestore scalar and nested value types losslessly', () => {
    const original = {
      timestamp: new Timestamp(1_700_000_000, 123_456_789),
      point: new GeoPoint(3.139, 101.6869),
      bytes: Buffer.from('STERAS'),
      reference: db.doc('events/event-1'),
      date: new Date('2026-08-19T00:00:00.000Z'),
      nested: [{ nan: Number.NaN, positive: Number.POSITIVE_INFINITY, negative: Number.NEGATIVE_INFINITY }],
    };
    const decoded = decodeFirestoreValue(encodeFirestoreValue(original), (path) => db.doc(path)) as typeof original;
    expect(decoded.timestamp.isEqual(original.timestamp)).toBe(true);
    expect(decoded.point.isEqual(original.point)).toBe(true);
    expect(decoded.bytes.equals(original.bytes)).toBe(true);
    expect(decoded.reference.path).toBe(original.reference.path);
    expect(decoded.date).toEqual(original.date);
    expect(Number.isNaN(decoded.nested[0].nan)).toBe(true);
    expect(decoded.nested[0].positive).toBe(Number.POSITIVE_INFINITY);
    expect(decoded.nested[0].negative).toBe(Number.NEGATIVE_INFINITY);
  });
});
