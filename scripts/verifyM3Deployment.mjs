import fs from 'node:fs';

const file = process.argv[2];
if (!file) throw new Error('Usage: node scripts/verifyM3Deployment.mjs <firebase-functions-list.json>');

const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
const deployed = new Set((payload.result ?? []).map((entry) => entry.id));
const required = [
  'assignAuthorityOfficers',
  'recordOfficerProposal',
  'makeSecondReviewDecision',
  'unassignAuthorityOfficers',
  'makeInitialReviewDecision',
  'reviewAssessmentScores',
  'verifyStage1Doc',
  'submitStage1Doc',
  'submitStage2Doc',
  'publishStage2Doc',
  'unpublishStage2Doc',
  'confirmStage2Doc',
  'reportStage2Doc',
  'onM4ReportOutcome',
  'onEventStatusChanged',
  'generateEventControlList',
  'editEventControlList',
  'proposeEventControlList',
];
const missing = required.filter((name) => !deployed.has(name));
if (missing.length > 0) {
  throw new Error(`Missing deployed M3 functions: ${missing.join(', ')}`);
}
console.log(`Verified ${required.length} required M3 functions are active.`);
