"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrivilegedAccount = void 0;
exports.validatePrivilegedAccountInput = validatePrivilegedAccountInput;
const node_crypto_1 = require("node:crypto");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const https_1 = require("firebase-functions/v2/https");
const types_1 = require("../../../shared/types");
const runtime_1 = require("../config/runtime");
const AUTHORITY_TYPES = new Set(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);
const REQUEST_FIELDS = new Set(['email', 'password', 'name', 'phone', 'role', 'authorityType', 'idempotencyKey']);
exports.createPrivilegedAccount = (0, https_1.onCall)({ region: runtime_1.FUNCTION_REGION }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError('unauthenticated', 'Sign in before creating an account.');
    const db = (0, firestore_1.getFirestore)();
    const adminSnapshot = await db.collection(types_1.COLLECTIONS.USERS).doc(request.auth.uid).get();
    if (adminSnapshot.data()?.role !== 'admin') {
        throw new https_1.HttpsError('permission-denied', 'Only an authorised administrator can create privileged accounts.');
    }
    const input = validatePrivilegedAccountInput(request.data);
    // Never persist even a raw password digest: the operation fingerprint only
    // covers the durable account identity and role. Replays cannot change Auth.
    const durableInput = {
        email: input.email, name: input.name, role: input.role,
        ...(input.phone ? { phone: input.phone } : {}),
        ...(input.authorityType ? { authorityType: input.authorityType } : {}),
        idempotencyKey: input.idempotencyKey,
    };
    const payloadHash = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(durableInput)).digest('hex');
    const operationId = (0, node_crypto_1.createHash)('sha256').update(`${request.auth.uid}:${input.idempotencyKey}`).digest('hex');
    const operationRef = db.collection(types_1.COLLECTIONS.ADMIN_OPERATIONS).doc(operationId);
    const existingOperation = await operationRef.get();
    if (existingOperation.exists) {
        const operation = existingOperation.data();
        if (operation?.kind !== 'create_privileged_account' || operation.payloadHash !== payloadHash) {
            throw new https_1.HttpsError('already-exists', 'This idempotency key was already used for a different request.');
        }
        return { uid: operation.targetId, role: input.role, idempotent: true };
    }
    const auth = (0, auth_1.getAuth)();
    try {
        await auth.getUserByEmail(input.email);
        throw new https_1.HttpsError('already-exists', 'An account with this email already exists.');
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        const code = error.code;
        if (code !== 'auth/user-not-found')
            throw error;
    }
    let createdUid;
    try {
        const account = await auth.createUser({
            email: input.email,
            password: input.password,
            displayName: input.name,
            disabled: false,
        });
        createdUid = account.uid;
        await auth.setCustomUserClaims(account.uid, {
            role: input.role,
            ...(input.role === 'authority' ? { authorityType: input.authorityType } : {}),
        });
        const now = Date.now();
        const profile = {
            uid: account.uid,
            email: input.email,
            name: input.name,
            role: input.role,
            ...(input.phone ? { phone: input.phone } : {}),
            ...(input.role === 'authority' ? { authorityType: input.authorityType } : {}),
            createdAt: now,
            updatedAt: now,
        };
        const auditRef = db.collection(types_1.COLLECTIONS.ADMIN_AUDIT_LOGS).doc(`account-${operationId}`);
        const batch = db.batch();
        batch.create(db.collection(types_1.COLLECTIONS.USERS).doc(account.uid), profile);
        batch.create(operationRef, {
            operationId,
            kind: 'create_privileged_account',
            actorId: request.auth.uid,
            targetId: account.uid,
            payloadHash,
            createdAt: now,
        });
        batch.create(auditRef, {
            auditId: auditRef.id,
            action: 'privileged_account_created',
            actorId: request.auth.uid,
            targetId: account.uid,
            role: input.role,
            ...(input.authorityType ? { authorityType: input.authorityType } : {}),
            timestamp: now,
        });
        await batch.commit();
        return { uid: account.uid, role: input.role, idempotent: false };
    }
    catch (error) {
        if (createdUid) {
            await auth.deleteUser(createdUid).catch((cleanupError) => {
                console.error('[createPrivilegedAccount] unable to compensate incomplete Auth account', cleanupError);
            });
        }
        if (error.code === 'auth/email-already-exists') {
            throw new https_1.HttpsError('already-exists', 'An account with this email already exists.');
        }
        throw error;
    }
});
function validatePrivilegedAccountInput(value) {
    if (!isRecord(value))
        throw new https_1.HttpsError('invalid-argument', 'Account details are required.');
    const unknown = Object.keys(value).filter((key) => !REQUEST_FIELDS.has(key));
    if (unknown.length > 0)
        throw new https_1.HttpsError('invalid-argument', `Unsupported fields: ${unknown.join(', ')}.`);
    const email = requiredString(value.email, 'email', 254).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new https_1.HttpsError('invalid-argument', 'Enter a valid email address.');
    const password = requiredString(value.password, 'password', 128, false);
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
        throw new https_1.HttpsError('invalid-argument', 'Temporary password must be at least 12 characters and include upper-case, lower-case, number, and symbol.');
    }
    const name = requiredString(value.name, 'name', 100);
    if (name.length < 2)
        throw new https_1.HttpsError('invalid-argument', 'name must be at least 2 characters.');
    if (value.role !== 'authority' && value.role !== 'admin')
        throw new https_1.HttpsError('invalid-argument', 'role must be authority or admin.');
    const authorityType = value.authorityType;
    if (value.role === 'authority' && (typeof authorityType !== 'string' || !AUTHORITY_TYPES.has(authorityType))) {
        throw new https_1.HttpsError('invalid-argument', 'A valid authorityType is required for authority accounts.');
    }
    if (value.role === 'admin' && authorityType !== undefined)
        throw new https_1.HttpsError('invalid-argument', 'Admin accounts cannot have an authorityType.');
    const phone = optionalString(value.phone, 'phone', 30);
    const idempotencyKey = requiredString(value.idempotencyKey, 'idempotencyKey', 100);
    if (idempotencyKey.length < 8 || !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) {
        throw new https_1.HttpsError('invalid-argument', 'idempotencyKey must be 8-100 letters, numbers, underscores, or hyphens.');
    }
    return {
        email, password, name, role: value.role,
        ...(phone ? { phone } : {}),
        ...(value.role === 'authority' ? { authorityType: authorityType } : {}),
        idempotencyKey,
    };
}
function requiredString(value, field, max, trim = true) {
    if (typeof value !== 'string')
        throw new https_1.HttpsError('invalid-argument', `${field} is required.`);
    const result = trim ? value.trim() : value;
    if (!result || result.length > max)
        throw new https_1.HttpsError('invalid-argument', `${field} must be 1-${max} characters.`);
    return result;
}
function optionalString(value, field, max) {
    if (value === undefined || value === '')
        return undefined;
    return requiredString(value, field, max);
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=adminUserManagement.js.map