import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { COLLECTIONS, type UserProfile } from '@shared/types';
import { M4_AI_PROMPT_VERSION, M4_SCHEMA_VERSION, type M4IncidentHistoryEntry, type M4IncidentRecord } from '@shared/m4';

const PROJECT_ID = 'linkos-496505';
const SOURCE_INCIDENT_ID = 'INC-260918-0002';
const SAMPLE_IDS = ['INC-260918-0005', 'INC-260918-0006'] as const;
const SAMPLE_MARKER = 'm4-incident-workflow-samples-2026-09-v1';

type FirestoreValue = { stringValue: string } | { integerValue: string } | { doubleValue: number } | { booleanValue: boolean } | { timestampValue: string } | { nullValue: null } | { mapValue: { fields?: Record<string, FirestoreValue> } } | { arrayValue: { values?: FirestoreValue[] } };
type FirestoreDocument = { name: string; fields?: Record<string, FirestoreValue> };

function encodeValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeValue) } };
  if (typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encodeValue(item)])) } };
  return { stringValue: String(value) };
}

function decodeValue(value: FirestoreValue): unknown {
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('timestampValue' in value) return Date.parse(value.timestampValue);
  if ('nullValue' in value) return null;
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  return Object.fromEntries(Object.entries(value.mapValue.fields ?? {}).map(([key, item]) => [key, decodeValue(item)]));
}

class RestFirestore {
  private readonly base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  private readonly documentPrefix = `projects/${PROJECT_ID}/databases/(default)/documents`;
  constructor(private readonly token: string) {}
  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.base}${path}`, { ...init, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error(`Firestore REST request failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<Record<string, unknown>>;
  }
  async get(collection: string, id: string) {
    const document = await this.request(`/${collection}/${encodeURIComponent(id)}`) as unknown as FirestoreDocument;
    return Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decodeValue(value)]));
  }
  async commit(writes: Array<{ update: { name: string; fields: Record<string, FirestoreValue> } }>) {
    await this.request(':commit', { method: 'POST', body: JSON.stringify({ writes }) });
  }
  async listUsers() {
    const result = await this.request(`/${COLLECTIONS.USERS}?pageSize=300`) as unknown as { documents?: Array<{ fields?: Record<string, FirestoreValue> }> };
    return ((result.documents ?? []) as Array<{ fields?: Record<string, FirestoreValue> }>).map((document) => Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decodeValue(value)])) as unknown as UserProfile);
  }
  path(collection: string, id: string) { return `${this.documentPrefix}/${collection}/${id}`; }
}

function historyEntry(incidentId: string, action: string, actorUid: string, actorRole: M4IncidentHistoryEntry['actorRole'], timestamp: number, summary: string): M4IncidentHistoryEntry {
  return { historyId: `${incidentId}-${action}`, incidentId, action, actorUid, actorRole, timestamp, summary, evidence: [] };
}

function asFields(value: object) {
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encodeValue(item)]));
}

async function main() {
  const firebaseConfigPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  const firebaseConfig = JSON.parse(await readFile(firebaseConfigPath, 'utf8')) as { tokens?: { access_token?: string } };
  if (!firebaseConfig.tokens?.access_token) throw new Error('Firebase CLI access token was not found. Run firebase login first.');
  const db = new RestFirestore(firebaseConfig.tokens.access_token);
  const source = await db.get(COLLECTIONS.INCIDENTS, SOURCE_INCIDENT_ID) as unknown as M4IncidentRecord;
  const users = await db.listUsers();
  const organizer = users.find((item) => item.uid === source.organizerId && item.role === 'organizer');
  if (!organizer) throw new Error('The source incident organizer profile could not be found.');
  const now = Date.now();
  const baseCreatedAt = now - 45 * 60_000;
  const shared = {
    schemaVersion: M4_SCHEMA_VERSION as typeof M4_SCHEMA_VERSION,
    eventId: source.eventId,
    eventVersionId: source.eventVersionId,
    venueId: source.venueId,
    eventType: source.eventType,
    eventName: source.eventName,
    organizerId: source.organizerId,
    reporterUid: source.reporterUid,
    reporterRole: source.reporterRole,
    evidence: [],
    assessmentEligible: true,
    synthetic: true,
    date: source.occurredAt,
    linkedControlId: undefined,
    linkedStage2DocId: undefined,
    publicReportTicketId: undefined,
    referredAuthorityId: undefined,
    referredAuthorityType: undefined,
    referredAuthorityName: undefined,
    assignedAuthorityOfficerUid: undefined,
    finalResolution: undefined,
    resolvedAt: undefined,
    activityClosed: undefined,
  };
  const definitions: Array<{ record: M4IncidentRecord; history: M4IncidentHistoryEntry[] }> = [
    {
      record: {
        ...shared,
        incidentId: SAMPLE_IDS[0],
        category: 'medical_safety',
        incidentType: 'medical_safety',
        description: 'A visitor fainted near the finish area. The event medical team is monitoring the visitor and keeping the route clear for assistance.',
        location: 'Finish area · Medical post 1',
        occurredAt: source.occurredAt,
        aiAssessment: { status: 'success', model: 'workflow-fixture', promptVersion: M4_AI_PROMPT_VERSION, severity: 'high', immediateActionRequired: true, rationale: 'High severity medical incident. Keep the medical post active and monitor the visitor.', assessedAt: baseCreatedAt + 5 * 60_000 },
        severity: 'high',
        immediateActionRequired: true,
        status: 'responding',
        assignedInternalTeam: 'Medical Response Team',
        recommendedAuthorityIds: [],
        createdAt: baseCreatedAt,
        updatedAt: baseCreatedAt + 15 * 60_000,
        reviewedAt: baseCreatedAt + 10 * 60_000,
        actionStartedAt: baseCreatedAt + 15 * 60_000,
      },
      history: [
        historyEntry(SAMPLE_IDS[0], 'incident_submitted', source.reporterUid, 'public', baseCreatedAt, 'Workflow sample: visitor fainted near the event finish area.'),
        historyEntry(SAMPLE_IDS[0], 'ai_incident_assessment', 'system', 'system', baseCreatedAt + 5 * 60_000, 'High severity. Immediate medical response recommended.'),
        historyEntry(SAMPLE_IDS[0], 'assign_internal', organizer.uid, 'organizer', baseCreatedAt + 15 * 60_000, 'Assigned Medical Response Team to coordinate the response.'),
      ],
    },
    {
      record: {
        ...shared,
        incidentId: SAMPLE_IDS[1],
        category: 'access_traffic',
        incidentType: 'access_traffic',
        description: 'The temporary parking area is too small for the expected visitor flow. Additional directional signs were placed while the organiser reviews the final arrangement.',
        location: 'Parking area · North access road',
        occurredAt: source.occurredAt,
        aiAssessment: { status: 'success', model: 'workflow-fixture', promptVersion: M4_AI_PROMPT_VERSION, severity: 'low', immediateActionRequired: false, rationale: 'Low severity access issue. Record the organiser response and review the final resolution.', assessedAt: baseCreatedAt + 5 * 60_000 },
        severity: 'low',
        immediateActionRequired: false,
        status: 'awaiting_resolution',
        recommendedAuthorityIds: [],
        createdAt: baseCreatedAt - 10 * 60_000,
        updatedAt: baseCreatedAt + 20 * 60_000,
        reviewedAt: baseCreatedAt,
        actionStartedAt: baseCreatedAt + 10 * 60_000,
      },
      history: [
        historyEntry(SAMPLE_IDS[1], 'incident_submitted', source.reporterUid, 'public', baseCreatedAt - 10 * 60_000, 'Workflow sample: parking space is too small for visitor demand.'),
        historyEntry(SAMPLE_IDS[1], 'ai_incident_assessment', 'system', 'system', baseCreatedAt - 5 * 60_000, 'Low severity. No immediate action required; organiser response should be recorded.'),
        historyEntry(SAMPLE_IDS[1], 'record_response', organizer.uid, 'organizer', baseCreatedAt + 20 * 60_000, 'Recorded temporary parking signs and visitor-flow guidance. Ready for final resolution.'),
      ],
    },
  ];
  const writes: Array<{ update: { name: string; fields: Record<string, FirestoreValue> } }> = [];
  for (const item of definitions) {
    writes.push({ update: { name: db.path(COLLECTIONS.INCIDENTS, item.record.incidentId), fields: asFields(item.record) } });
    for (const entry of item.history) writes.push({ update: { name: `${db.path(COLLECTIONS.INCIDENTS, item.record.incidentId)}/history/${entry.historyId}`, fields: asFields(entry) } });
  }
  writes.push({ update: { name: db.path(COLLECTIONS.DATASET_MANIFESTS, SAMPLE_MARKER), fields: asFields({ datasetId: SAMPLE_MARKER, managedBy: 'seed:incident-workflow-samples', synthetic: true, generatedAt: now, sourceIncidentId: SOURCE_INCIDENT_ID, counts: { inProgress: 1, awaitingResolution: 1 } }) } });
  await db.commit(writes);
  console.info(JSON.stringify({ projectId: PROJECT_ID, datasetId: SAMPLE_MARKER, records: definitions.map(({ record }) => ({ incidentId: record.incidentId, status: record.status, eventName: record.eventName })) }, null, 2));
}

if (require.main === module) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
