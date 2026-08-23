"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const vitest_1 = require("vitest");
const firestoreBackupCodec_1 = require("./firestoreBackupCodec");
const app = (0, app_1.initializeApp)({ projectId: 'steras-codec-test' }, 'steras-codec-test');
const db = (0, firestore_1.getFirestore)(app);
(0, vitest_1.afterAll)(() => (0, app_1.deleteApp)(app));
(0, vitest_1.describe)('Firestore backup codec', () => {
    (0, vitest_1.it)('round-trips Firestore scalar and nested value types losslessly', () => {
        const original = {
            timestamp: new firestore_1.Timestamp(1_700_000_000, 123_456_789),
            point: new firestore_1.GeoPoint(3.139, 101.6869),
            bytes: Buffer.from('STERAS'),
            reference: db.doc('events/event-1'),
            date: new Date('2026-08-19T00:00:00.000Z'),
            nested: [{ nan: Number.NaN, positive: Number.POSITIVE_INFINITY, negative: Number.NEGATIVE_INFINITY }],
        };
        const decoded = (0, firestoreBackupCodec_1.decodeFirestoreValue)((0, firestoreBackupCodec_1.encodeFirestoreValue)(original), (path) => db.doc(path));
        (0, vitest_1.expect)(decoded.timestamp.isEqual(original.timestamp)).toBe(true);
        (0, vitest_1.expect)(decoded.point.isEqual(original.point)).toBe(true);
        (0, vitest_1.expect)(decoded.bytes.equals(original.bytes)).toBe(true);
        (0, vitest_1.expect)(decoded.reference.path).toBe(original.reference.path);
        (0, vitest_1.expect)(decoded.date).toEqual(original.date);
        (0, vitest_1.expect)(Number.isNaN(decoded.nested[0].nan)).toBe(true);
        (0, vitest_1.expect)(decoded.nested[0].positive).toBe(Number.POSITIVE_INFINITY);
        (0, vitest_1.expect)(decoded.nested[0].negative).toBe(Number.NEGATIVE_INFINITY);
    });
});
//# sourceMappingURL=firestoreBackupCodec.test.js.map