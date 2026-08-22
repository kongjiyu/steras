"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("firebase-admin/app");
const auth_1 = require("firebase-admin/auth");
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../shared/types");
const app = (0, app_1.initializeApp)({
    credential: (0, app_1.applicationDefault)(),
    projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? 'linkos-496505',
});
const email = process.env.AUTHORITY_EMAIL?.trim();
const password = process.env.AUTHORITY_PASSWORD;
const name = process.env.AUTHORITY_NAME?.trim();
const authorityType = process.env.AUTHORITY_TYPE;
const validAuthorities = new Set(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);
if (!email || !password || !name || !authorityType || !validAuthorities.has(authorityType)) {
    throw new Error('Set AUTHORITY_EMAIL, AUTHORITY_PASSWORD, AUTHORITY_NAME, and a valid AUTHORITY_TYPE.');
}
const config = { email, password, name, authorityType };
async function run() {
    const auth = (0, auth_1.getAuth)(app);
    const user = await auth.getUserByEmail(config.email).catch(() => auth.createUser({ email: config.email, password: config.password, displayName: config.name }));
    const now = Date.now();
    const profile = {
        uid: user.uid,
        name: config.name,
        email: config.email,
        role: 'authority',
        authorityType: config.authorityType,
        createdAt: now,
        updatedAt: now,
    };
    await (0, firestore_1.getFirestore)(app).collection(types_1.COLLECTIONS.USERS).doc(user.uid).set(profile, { merge: true });
    console.info(`Provisioned ${config.authorityType} authority account for ${config.email}.`);
}
run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
//# sourceMappingURL=seedAuthority.js.map