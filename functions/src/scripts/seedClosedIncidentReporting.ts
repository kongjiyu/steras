import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { COLLECTIONS, type AuthorityType, type EventType, type UserProfile } from '@shared/types';
import { M4_AI_AUTHORITY_PROMPT_VERSION, M4_AI_PROMPT_VERSION, M4_SCHEMA_VERSION, type M4IncidentCategory, type M4IncidentHistoryEntry, type M4IncidentRecord } from '@shared/m4';

const PROJECT_ID = 'linkos-496505';
const DATASET_ID = 'm4-reporting-closed-2026-09-v1';
const DAY = 86_400_000;
const HOUR = 3_600_000;
const RECORD_COUNT = 60;

const EVENTS: Array<{ id: string; name: string; type: EventType; venue: string; venueId: string }> = [
  { id: 'reporting-kl-cultural-day', name: 'KL Cultural Day', type: 'cultural', venue: 'Dataran Merdeka', venueId: 'venue-dataran-merdeka' },
  { id: 'reporting-pj-sports-fiesta', name: 'PJ Sports Fiesta', type: 'sports', venue: 'Petaling Jaya Stadium', venueId: 'venue-pj-stadium' },
  { id: 'reporting-river-of-life', name: 'River of Life Night Market', type: 'fair', venue: 'Masjid Jamek Riverside', venueId: 'venue-river-of-life' },
  { id: 'reporting-tourism-expo', name: 'Malaysia Tourism Product Expo', type: 'exhibition', venue: 'KL Convention Centre', venueId: 'venue-klcc' },
  { id: 'reporting-heritage-run', name: 'KL Heritage Run', type: 'sports', venue: 'Padang Merbok', venueId: 'venue-padang-merbok' },
  { id: 'reporting-music-festival', name: 'Merdeka Music Festival', type: 'concert', venue: 'Bukit Jalil Open Grounds', venueId: 'venue-bukit-jalil' },
  { id: 'reporting-food-fair', name: 'Kuala Lumpur Food Fair', type: 'festival', venue: 'Titiwangsa Event Lawn', venueId: 'venue-titiwangsa' },
  { id: 'reporting-craft-market', name: 'Malaysia Craft and Design Market', type: 'fair', venue: 'Central Market', venueId: 'venue-central-market' },
];

const CATEGORIES: M4IncidentCategory[] = ['crowd', 'medical_safety', 'access_traffic', 'property_damage', 'security', 'lost_found', 'missing_person', 'suspicious_activity', 'event_control_discrepancy', 'other'];
const INTERNAL_TEAMS = ['Festival Operations Team', 'Security Response Team', 'Medical Response Team', 'Venue Operations Team'];
const AUTHORITY_CHOICES: Array<{ id: string; type: AuthorityType; name: string }> = [
  { id: 'pdrm-event-operations', type: 'PDRM', name: 'PDRM Event Operations Desk' },
  { id: 'bomba-fire-rescue', type: 'BOMBA', name: 'BOMBA Fire and Rescue Desk' },
  { id: 'kkm-medical-response', type: 'KKM', name: 'KKM Medical Response Desk' },
  { id: 'dbkl-city-operations', type: 'DBKL', name: 'DBKL City Operations Desk' },
];

type Identity = { organizer: UserProfile; reporter: UserProfile; authorityUids: Partial<Record<AuthorityType, string>> };
type FirestoreValue = { stringValue: string } | { integerValue: string } | { doubleValue: number } | { booleanValue: boolean } | { timestampValue: string } | { nullValue: null } | { arrayValue: { values?: FirestoreValue[] } } | { mapValue: { fields?: Record<string, FirestoreValue> } };
type FirestoreWrite = { update: { name: string; fields: Record<string, FirestoreValue> } };

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
  readonly base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  readonly documentPrefix = `projects/${PROJECT_ID}/databases/(default)/documents`;
  constructor(private readonly token: string) {}
  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.base}${path}`, { ...init, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error(`Firestore REST request failed (${response.status}): ${await response.text()}`);
    return response.json() as Promise<Record<string, unknown>>;
  }
  async list(collection: string) {
    const result = await this.request(`/${collection}?pageSize=300`);
    return ((result.documents ?? []) as Array<{ name: string; fields?: Record<string, FirestoreValue> }>).map((document) => ({ name: document.name, data: Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decodeValue(value)])) }));
  }
  async commit(writes: FirestoreWrite[]) {
    await this.request(':commit', { method: 'POST', body: JSON.stringify({ writes }) });
  }
}

function dateKey(timestamp: number) {
  const date = new Date(timestamp);
  return `${String(date.getUTCFullYear()).slice(-2)}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`;
}

function incidentNarrative(category: M4IncidentCategory, event: typeof EVENTS[number], index: number) {
  const location = `${event.venue} · ${['North entrance', 'Main stage', 'Medical post', 'Information counter'][index % 4]}`;
  const narratives: Record<M4IncidentCategory, string> = {
    crowd: 'A dense queue formed near the entrance and temporary marshals opened an alternate lane.',
    medical_safety: 'A visitor felt unwell and received an assessment at the event medical point.',
    access_traffic: 'Vehicle congestion briefly blocked the marked drop-off route and accessible entrance.',
    property_damage: 'A temporary barrier was damaged and the venue operations team secured the area.',
    security: 'A dispute between visitors was reported to event security and separated without escalation.',
    lost_found: 'A personal item was found and handed to the event information counter for recording.',
    missing_person: 'A family reported a missing member and the information team coordinated a safe reunion.',
    suspicious_activity: 'An unattended item was reported and the security team completed a controlled check.',
    event_control_discrepancy: 'The published event-control arrangement differed from the setup observed on site.',
    other: 'A participant reported an operational issue that was reviewed and closed by the organiser.',
  };
  return { location, description: narratives[category] };
}

function assessment(category: M4IncidentCategory, severity: M4IncidentRecord['severity'], immediateActionRequired: boolean) {
  const action = immediateActionRequired ? 'Immediate response was recommended.' : 'No immediate escalation was required.';
  return `${severity === 'high' ? 'High' : severity === 'medium' ? 'Medium' : 'Low'} severity ${category.replaceAll('_', ' ')}. ${action}`;
}

function historyEntry(incidentId: string, action: string, actorUid: string, actorRole: M4IncidentHistoryEntry['actorRole'], timestamp: number, summary: string): M4IncidentHistoryEntry {
  return { historyId: `${incidentId}-${action}`, incidentId, action, actorUid, actorRole, timestamp, summary, evidence: [] };
}

async function loadIdentity(db: RestFirestore): Promise<Identity> {
  const users = (await db.list(COLLECTIONS.USERS)).map((item) => item.data as unknown as UserProfile);
  const organizer = users.filter((item) => item.role === 'organizer').find((item) => item.email === 'organizer1@steras.test') ?? users.find((item) => item.role === 'organizer');
  const reporter = users.filter((item) => item.role === 'public').find((item) => item.email === 'participant.showcase@steras.test') ?? users.find((item) => item.role === 'public');
  if (!organizer?.uid || !reporter?.uid) throw new Error('An organizer and public reporter profile are required.');
  const authorityUids: Partial<Record<AuthorityType, string>> = {};
  users.filter((item) => item.role === 'authority').forEach((profile) => {
    if (profile.authorityType && !authorityUids[profile.authorityType]) authorityUids[profile.authorityType] = profile.uid;
  });
  return { organizer, reporter, authorityUids };
}

function buildRecords(identity: Identity, now: number) {
  const records: Array<{ record: M4IncidentRecord; history: M4IncidentHistoryEntry[] }> = [];
  const dateSequences = new Map<string, number>();
  for (let index = 0; index < RECORD_COUNT; index += 1) {
    const createdAt = now - index * 3 * DAY - (index % 6) * HOUR;
    const key = dateKey(createdAt);
    const sequence = (dateSequences.get(key) ?? 0) + 1;
    dateSequences.set(key, sequence);
    const incidentId = `INC-${key}-${String(sequence).padStart(4, '0')}`;
    const event = EVENTS[index % EVENTS.length];
    const category = CATEGORIES[index % CATEGORIES.length];
    const severity: M4IncidentRecord['severity'] = index % 9 === 0 ? 'high' : index % 3 === 0 ? 'medium' : 'low';
    const immediateActionRequired = severity === 'high' || (severity === 'medium' && index % 2 === 0);
    const authority = index % 4 === 0 ? AUTHORITY_CHOICES[(index / 4) % AUTHORITY_CHOICES.length] : undefined;
    const internalTeam = authority ? undefined : INTERNAL_TEAMS[index % INTERNAL_TEAMS.length];
    const occurredAt = createdAt - 30 * 60_000;
    const reviewedAt = createdAt + 15 * 60_000;
    const actionStartedAt = createdAt + 25 * 60_000;
    const resolvedAt = createdAt + (authority ? 6 : 3) * HOUR;
    const narrative = incidentNarrative(category, event, index);
    const result = assessment(category, severity, immediateActionRequired);
    const record: M4IncidentRecord & { reportingData: Record<string, unknown> } = {
      schemaVersion: M4_SCHEMA_VERSION,
      incidentId,
      eventId: event.id,
      eventVersionId: 'v1',
      venueId: event.venueId,
      eventType: event.type,
      eventName: event.name,
      organizerId: identity.organizer.uid,
      reporterUid: identity.reporter.uid,
      reporterRole: 'public',
      category,
      incidentType: category,
      description: narrative.description,
      location: narrative.location,
      occurredAt,
      evidence: [],
      aiAssessment: { status: 'success', model: 'reporting-fixture', promptVersion: M4_AI_PROMPT_VERSION, severity, immediateActionRequired, rationale: result, assessedAt: createdAt + 10 * 60_000 },
      aiAuthorityRecommendation: { status: 'success', model: 'reporting-fixture', promptVersion: M4_AI_AUTHORITY_PROMPT_VERSION, authorityIds: [authority?.id ?? AUTHORITY_CHOICES[index % AUTHORITY_CHOICES.length].id], rationale: 'Recommendation based on the incident category and severity.', assessedAt: createdAt + 12 * 60_000 },
      severity,
      immediateActionRequired,
      status: 'resolved',
      ...(internalTeam ? { assignedInternalTeam: internalTeam } : {}),
      ...(authority ? { referredAuthorityId: authority.id, referredAuthorityType: authority.type, referredAuthorityName: authority.name, assignedAuthorityOfficerUid: identity.authorityUids[authority.type] } : {}),
      finalResolution: authority ? `${authority.name} completed the investigation and the organiser recorded the final resolution.` : `${internalTeam} completed the response and the organiser recorded the final resolution.`,
      recommendedAuthorityIds: [authority?.id ?? AUTHORITY_CHOICES[index % AUTHORITY_CHOICES.length].id],
      assessmentEligible: true,
      synthetic: true,
      date: occurredAt,
      createdAt,
      updatedAt: resolvedAt,
      reviewedAt,
      actionStartedAt,
      resolvedAt,
      reportingData: { datasetId: DATASET_ID, purpose: 'closed incident reporting and analytics fixture', generatedAt: now },
    };
    const history: M4IncidentHistoryEntry[] = [
      historyEntry(incidentId, 'incident_submitted', identity.reporter.uid, 'public', createdAt, 'Synthetic reporting record submitted for historical analysis.'),
      historyEntry(incidentId, 'ai_incident_assessment', 'system', 'system', createdAt + 10 * 60_000, result),
    ];
    if (internalTeam) {
      history.push(historyEntry(incidentId, 'assign_internal', identity.organizer.uid, 'organizer', actionStartedAt, `Assigned ${internalTeam} to coordinate the response.`));
      history.push(historyEntry(incidentId, 'record_response', identity.organizer.uid, 'organizer', resolvedAt - 45 * 60_000, `${internalTeam} completed the documented response action.`));
    } else if (authority) {
      history.push(historyEntry(incidentId, 'refer_authority', identity.organizer.uid, 'organizer', actionStartedAt, `Referred the incident to ${authority.name}.`));
      history.push(historyEntry(incidentId, 'record_investigation', identity.authorityUids[authority.type] ?? identity.organizer.uid, 'authority', resolvedAt - 45 * 60_000, `${authority.name} submitted the investigation finding.`));
    }
    history.push(historyEntry(incidentId, 'resolve', identity.organizer.uid, 'organizer', resolvedAt, record.finalResolution!));
    records.push({ record, history });
  }
  return records;
}

async function writeDataset(db: RestFirestore, records: Array<{ record: M4IncidentRecord; history: M4IncidentHistoryEntry[] }>, now: number) {
  let writes: FirestoreWrite[] = [];
  const commit = async () => { if (writes.length > 0) await db.commit(writes); writes = []; };
  for (const { record, history } of records) {
    writes.push({ update: { name: `${db.documentPrefix}/${COLLECTIONS.INCIDENTS}/${record.incidentId}`, fields: Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined).map(([key, value]) => [key, encodeValue(value)])) } });
    for (const entry of history) {
      writes.push({ update: { name: `${db.documentPrefix}/${COLLECTIONS.INCIDENTS}/${record.incidentId}/history/${entry.historyId}`, fields: Object.fromEntries(Object.entries(entry).map(([key, value]) => [key, encodeValue(value)])) } });
    }
    if (writes.length >= 400) await commit();
  }
  await commit();
  await db.commit([{ update: { name: `${db.documentPrefix}/${COLLECTIONS.DATASET_MANIFESTS}/${DATASET_ID}`, fields: Object.fromEntries(Object.entries({ datasetId: DATASET_ID, managedBy: 'seed:closed-incident-reporting', synthetic: true, generatedAt: now, intendedUse: 'Organizer incident reporting and analytics demonstration only.', counts: { incidents: records.length, closed: records.length } }).map(([key, value]) => [key, encodeValue(value)])) } }]);
}

async function main() {
  const firebaseConfigPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  const firebaseConfig = JSON.parse(await readFile(firebaseConfigPath, 'utf8')) as { tokens?: { access_token?: string } };
  if (!firebaseConfig.tokens?.access_token) throw new Error('Firebase CLI access token was not found. Run firebase login first.');
  const db = new RestFirestore(firebaseConfig.tokens.access_token);
  const identity = await loadIdentity(db);
  const now = Date.now();
  const records = buildRecords(identity, now);
  await writeDataset(db, records, now);
  console.info(JSON.stringify({ projectId: PROJECT_ID, datasetId: DATASET_ID, incidents: records.length, closed: records.filter(({ record }) => record.status === 'resolved').length, organizerUid: identity.organizer.uid }, null, 2));
}

if (require.main === module) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
