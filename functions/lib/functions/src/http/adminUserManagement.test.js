"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const adminUserManagement_1 = require("./adminUserManagement");
const valid = {
    email: ' Officer@Example.com ', password: 'StrongPass!234', name: ' Safety Officer ',
    role: 'authority', authorityType: 'PDRM', idempotencyKey: 'request_1234',
};
(0, vitest_1.describe)('M1 privileged account input', () => {
    (0, vitest_1.it)('normalizes a complete authority request without retaining extra fields', () => {
        (0, vitest_1.expect)((0, adminUserManagement_1.validatePrivilegedAccountInput)(valid)).toEqual({
            email: 'officer@example.com', password: 'StrongPass!234', name: 'Safety Officer',
            role: 'authority', authorityType: 'PDRM', idempotencyKey: 'request_1234',
        });
    });
    (0, vitest_1.it)('accepts admin only without an authority type', () => {
        (0, vitest_1.expect)((0, adminUserManagement_1.validatePrivilegedAccountInput)({ ...valid, role: 'admin', authorityType: undefined })).toMatchObject({ role: 'admin' });
        (0, vitest_1.expect)(() => (0, adminUserManagement_1.validatePrivilegedAccountInput)({ ...valid, role: 'admin' })).toThrow('cannot have an authorityType');
    });
    vitest_1.it.each([
        [{ ...valid, role: 'organizer' }, 'role must be'],
        [{ ...valid, authorityType: 'CIA' }, 'valid authorityType'],
        [{ ...valid, email: 'not-email' }, 'valid email'],
        [{ ...valid, password: 'weak-password' }, 'Temporary password'],
        [{ ...valid, idempotencyKey: '../collision' }, 'idempotencyKey'],
        [{ ...valid, admin: true }, 'Unsupported fields'],
        [{ ...valid, name: 'x'.repeat(101) }, 'name must be'],
    ])('rejects adversarial payload %#', (payload, message) => {
        (0, vitest_1.expect)(() => (0, adminUserManagement_1.validatePrivilegedAccountInput)(payload)).toThrow(message);
    });
});
//# sourceMappingURL=adminUserManagement.test.js.map