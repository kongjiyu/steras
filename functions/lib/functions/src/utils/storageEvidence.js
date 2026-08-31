"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectStorageEvidence = inspectStorageEvidence;
exports.isValidEvidenceMetadata = isValidEvidenceMetadata;
const storage_1 = require("firebase-admin/storage");
const EVIDENCE_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_EVIDENCE_SIZE = 10 * 1024 * 1024;
async function inspectStorageEvidence(paths, now = Date.now()) {
    const bucket = (0, storage_1.getStorage)().bucket();
    return Promise.all(paths.map(async (path) => {
        try {
            const metadata = (await bucket.file(path).getMetadata())[0];
            if (!isValidEvidenceMetadata(metadata)) {
                return { path, status: 'ineligible', retrievedAt: now, sourceVersion: storageGeneration(metadata), reason: 'storage_metadata_invalid' };
            }
            return { path, status: 'eligible', retrievedAt: now, sourceVersion: storageGeneration(metadata) };
        }
        catch {
            return { path, status: 'missing', retrievedAt: now, sourceVersion: 'missing', reason: 'storage_object_missing' };
        }
    }));
}
function isValidEvidenceMetadata(value) {
    if (!isRecord(value))
        return false;
    const size = Number(value.size);
    return EVIDENCE_MIME_TYPES.has(String(value.contentType))
        && Number.isSafeInteger(size) && size >= 1 && size <= MAX_EVIDENCE_SIZE
        && typeof value.generation === 'string' && /^\d+$/.test(value.generation);
}
function storageGeneration(value) {
    return isRecord(value) && typeof value.generation === 'string' && /^\d+$/.test(value.generation)
        ? `storage-generation:${value.generation}`
        : 'storage-generation:unknown';
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=storageEvidence.js.map