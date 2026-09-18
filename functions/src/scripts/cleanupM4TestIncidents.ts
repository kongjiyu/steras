import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT_ID = 'linkos-496505';
const COLLECTION = 'incidents';
const HISTORY = 'history';
const ID_PATTERN = /^INC-\d{6}-\d{4}$/;

type FirestoreValue = { stringValue: string } | { integerValue: string } | { doubleValue: number } | { booleanValue: boolean } | { timestampValue: string } | { nullValue: null } | { mapValue: { fields?: Record<string, FirestoreValue> } } | { arrayValue: { values?: FirestoreValue[] } };
type FirestoreDocument = { name: string; fields?: Record<string, FirestoreValue> };

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

function decodeDocument(document: FirestoreDocument) {
  return Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, decodeValue(value)]));
}

class RestFirestore {
  private readonly base = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  constructor(private readonly token: string) {}

  async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.base}${path}`, { ...init, headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } });
    if (!response.ok) throw new Error(`Firestore REST request failed (${response.status}): ${await response.text()}`);
    return response.status === 204 ? {} : response.json() as Promise<Record<string, unknown>>;
  }

  async list(path: string) {
    const documents: Array<FirestoreDocument & { fields?: Record<string, FirestoreValue> }> = [];
    let pageToken = '';
    do {
      const suffix = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
      const result = await this.request(`${path}?pageSize=300${suffix}`) as unknown as { documents?: FirestoreDocument[]; nextPageToken?: string };
      documents.push(...(result.documents ?? []));
      pageToken = result.nextPageToken ?? '';
    } while (pageToken);
    return documents;
  }

  async delete(path: string) { await this.request(path, { method: 'DELETE' }); }
}

async function main() {
  const firebaseConfigPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  const firebaseConfig = JSON.parse(await readFile(firebaseConfigPath, 'utf8')) as { tokens?: { access_token?: string } };
  if (!firebaseConfig.tokens?.access_token) throw new Error('Firebase CLI access token was not found. Run firebase login first.');
  const db = new RestFirestore(firebaseConfig.tokens.access_token);
  const documents = await db.list(`/${COLLECTION}`);
  const targets = documents.map((document) => {
    const id = document.name.split('/').pop() ?? '';
    const data = decodeDocument(document);
    const eventName = String(data.eventName ?? '');
    const reasons = [
      ...(!ID_PATTERN.test(id) ? ['invalid incident ID format'] : []),
      ...(/participant demo/i.test(eventName) ? ['participant demo event'] : []),
    ];
    return { id, eventName, reasons };
  }).filter((item) => item.reasons.length > 0);

  console.log(JSON.stringify({ project: PROJECT_ID, totalIncidentDocuments: documents.length, targetCount: targets.length, targets }, null, 2));
  if (!process.argv.includes('--apply')) {
    console.log('Dry run only. Re-run with --apply to delete these incident records and their history subcollections.');
    return;
  }
  for (const target of targets) {
    const historyDocuments = await db.list(`/${COLLECTION}/${encodeURIComponent(target.id)}/${HISTORY}`);
    for (const history of historyDocuments) {
      const historyId = history.name.split('/').pop() ?? '';
      await db.delete(`/${COLLECTION}/${encodeURIComponent(target.id)}/${HISTORY}/${encodeURIComponent(historyId)}`);
    }
    await db.delete(`/${COLLECTION}/${encodeURIComponent(target.id)}`);
    console.log(`Deleted ${target.id} (${target.eventName || 'unnamed event'})`);
  }
  console.log(`Deleted ${targets.length} incident records.`);
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
