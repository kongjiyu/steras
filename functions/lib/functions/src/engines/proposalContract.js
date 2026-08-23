"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANONICAL_EVIDENCE_KEYS = void 0;
exports.canonicalHazardId = canonicalHazardId;
exports.hasCanonicalDuplicateHazardIds = hasCanonicalDuplicateHazardIds;
exports.isCanonicalEvidenceReferenceList = isCanonicalEvidenceReferenceList;
exports.CANONICAL_EVIDENCE_KEYS = new Set([
    'weather', 'crowd', 'venue', 'history', 'holiday', 'public_health',
    'sanitation', 'medical', 'security', 'transport', 'compliance',
]);
function canonicalHazardId(value) {
    return value.trim().toLocaleLowerCase('en-US');
}
function hasCanonicalDuplicateHazardIds(values) {
    const canonical = values.map(canonicalHazardId);
    return new Set(canonical).size !== canonical.length;
}
function isCanonicalEvidenceReferenceList(value) {
    return Array.isArray(value)
        && value.length > 0
        && value.every((item) => typeof item === 'string' && exports.CANONICAL_EVIDENCE_KEYS.has(item))
        && new Set(value).size === value.length;
}
//# sourceMappingURL=proposalContract.js.map