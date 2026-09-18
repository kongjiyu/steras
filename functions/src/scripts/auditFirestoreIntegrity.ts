import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { applicationDefault, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import {
  compareIntegrityFindings,
  GOVERNANCE_COLLECTION,
  HISTORICAL_OCCURRENCES_COLLECTION,
  LEGACY_SOURCE_FIELDS,
  type IntegrityAuditReport,
  type IntegrityFinding,
  type IntegritySeverity,
} from '@shared/dataIntegrity';
import { COLLECTIONS, type AuthorityType } from '@shared/types';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? '';
const KNOWN_TOP_LEVEL_COLLECTIONS = new Set<string>([
  ...Object.values(COLLECTIONS),
  GOVERNANCE_COLLECTION,
  HISTORICAL_OCCURRENCES_COLLECTION,
  'authority_directory',
  'incident_counters',
  'incident_notification_outbox',
  'incident_submission_keys',
]);
const KNOWN_NESTED_COLLECTIONS = new Set<string>([
  ...Object.values(COLLECTIONS),
  'history',
  'items',
  'revisions',
  'redactions',
  'proposals',
]);
const AUTHORITY_TYPES = new Set<AuthorityType>(['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC']);

interface AuditOptions {
  projectId: string;
  outputDirectory?: string;
  failOn: IntegritySeverity;
}

interface DocumentNode {
  path: string;
  id: string;
  collection: string;
  parentPath: string | null;
  data: Record<string, unknown>;
}

interface StorageSnapshot {
  names: Set<string>;
  count: number;
  metadata: Map<string, Record<string, unknown>>;
}

interface AuditContext {
  db: Firestore;
  nodes: Map<string, DocumentNode>;
  topLevelCounts: Map<string, number>;
  storage: StorageSnapshot;
  governance: Map<string, Record<string, unknown>>;
  findings: IntegrityFinding[];
}

function parseOptions(argv: string[]): AuditOptions {
  const valueAfter = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const projectId = valueAfter('--project') ?? PROJECT_ID;
  if (!projectId) throw new Error('Set FIREBASE_PROJECT_ID or pass --project.');
  const failOn = (valueAfter('--fail-on') ?? 'critical') as IntegritySeverity;
  if (!['info', 'warning', 'error', 'critical'].includes(failOn)) throw new Error('--fail-on must be info, warning, error, or critical.');
  return { projectId, outputDirectory: valueAfter('--output'), failOn };
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `<buffer:${value.length}>`;
  if (value && typeof value === 'object' && 'toMillis' in value && typeof (value as { toMillis?: unknown }).toMillis === 'function') {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  }
  return String(value);
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

function pathFor(collection: string, id: string, parentPath?: string | null): string {
  return parentPath ? `${parentPath}/${collection}/${id}` : `${collection}/${id}`;
}

function fieldPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const paths: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if ((LEGACY_SOURCE_FIELDS as readonly string[]).includes(key)) paths.push(next);
    paths.push(...fieldPaths(child, next));
  }
  return paths;
}

function severityAtLeast(value: IntegritySeverity, threshold: IntegritySeverity): boolean {
  const rank: Record<IntegritySeverity, number> = { info: 0, warning: 1, error: 2, critical: 3 };
  return rank[value] >= rank[threshold];
}

function findingId(code: string, documentPath: string, relatedPaths: string[]): string {
  return createHash('sha256').update(`${code}|${documentPath}|${[...relatedPaths].sort().join('|')}`).digest('hex').slice(0, 20);
}

function addFinding(
  context: AuditContext,
  code: string,
  severity: IntegritySeverity,
  documentPath: string,
  relatedPaths: string[],
  summary: string,
  data: unknown,
  proposedAction?: string,
): void {
  context.findings.push({
    findingId: findingId(code, documentPath, relatedPaths),
    code,
    severity,
    documentPath,
    relatedPaths: [...relatedPaths].sort(),
    beforeHash: hash(data),
    summary,
    ...(proposedAction ? { proposedAction } : {}),
  });
}

async function collectDocuments(db: Firestore): Promise<{ nodes: Map<string, DocumentNode>; topLevelCounts: Map<string, number>; collectionDocumentCounts: Map<string, number>; findings: IntegrityFinding[] }> {
  const nodes = new Map<string, DocumentNode>();
  const topLevelCounts = new Map<string, number>();
  const collectionDocumentCounts = new Map<string, number>();
  const findings: IntegrityFinding[] = [];
  const collectionContext = (): AuditContext => ({ db, nodes, topLevelCounts, storage: { names: new Set<string>(), count: 0, metadata: new Map() }, governance: new Map(), findings });
  const walk = async (snapshot: DocumentSnapshot, collection: string, parentPath: string | null): Promise<void> => {
    if (!snapshot.exists) return;
    const path = pathFor(collection, snapshot.id, parentPath);
    const data = snapshot.data() as Record<string, unknown>;
    nodes.set(path, { path, id: snapshot.id, collection, parentPath, data });
    const subcollections = await snapshot.ref.listCollections();
    for (const subcollection of subcollections) {
      if (!KNOWN_NESTED_COLLECTIONS.has(subcollection.id)) {
        addFinding(collectionContext(), 'unknown_nested_collection', 'error', `${path}/${subcollection.id}`, [], 'Unknown nested collection requires an explicit schema policy.', data);
      }
      const childSnapshot = await subcollection.get();
      collectionDocumentCounts.set(`${path}/${subcollection.id}`, childSnapshot.size);
      for (const child of childSnapshot.docs) await walk(child, subcollection.id, path);
    }
  };
  for (const collection of await db.listCollections()) {
    const snapshot = await collection.get();
    topLevelCounts.set(collection.id, snapshot.size);
    collectionDocumentCounts.set(collection.id, snapshot.size);
    if (!KNOWN_TOP_LEVEL_COLLECTIONS.has(collection.id)) {
      addFinding(collectionContext(), 'unknown_top_level_collection', 'error', collection.id, [], 'Unknown top-level collection requires an explicit schema policy.', {});
    }
    for (const document of snapshot.docs) await walk(document, collection.id, null);
  }
  return { nodes, topLevelCounts, collectionDocumentCounts, findings };
}

async function collectStorage(app: App): Promise<StorageSnapshot> {
  const bucket = getStorage(app).bucket();
  try {
    const [files] = await bucket.getFiles({ autoPaginate: true });
    const metadata = new Map<string, Record<string, unknown>>();
    await Promise.all(files.map(async (file) => {
      try {
        const [value] = await file.getMetadata();
        metadata.set(file.name, (value.metadata ?? {}) as Record<string, unknown>);
      } catch {
        // A metadata read failure is reported as a missing metadata snapshot
        // rather than making the whole audit fail closed.
      }
    }));
    return { names: new Set(files.map((file) => file.name)), count: files.length, metadata };
  } catch {
    return { names: new Set(), count: 0, metadata: new Map() };
  }
}

function childNodes(context: AuditContext, parentPath: string | null, collection: string): DocumentNode[] {
  return [...context.nodes.values()].filter((node) => node.parentPath === parentPath && node.collection === collection);
}

function nodeAt(context: AuditContext, path: string | undefined): DocumentNode | undefined {
  return path ? context.nodes.get(path) : undefined;
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nestedString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}

function scanLegacyFields(context: AuditContext): void {
  for (const node of context.nodes.values()) {
    if (node.collection === GOVERNANCE_COLLECTION) continue;
    const legacyPaths = fieldPaths(node.data);
    if (legacyPaths.length > 0) addFinding(context, 'legacy_source_marker', 'warning', node.path, [], 'Legacy source metadata is still embedded in a business document.', node.data, 'Copy provenance to governance registry, then remove legacy fields.');
    if (node.id.toLowerCase().includes('test')) addFinding(context, 'legacy_identifier', 'warning', node.path, [], 'Document ID contains a legacy test marker.', node.data, 'Migrate to a neutral production ID after verification.');
  }
  for (const [storagePath, metadata] of context.storage.metadata.entries()) {
    if (fieldPaths(metadata).length > 0) addFinding(context, 'storage_legacy_source_marker', 'warning', `storage/${storagePath}`, [], 'Legacy source metadata is still embedded in a Storage object.', metadata, 'Copy provenance to governance registry, then remove custom metadata.');
  }
}

function scanUsersAndOfficers(context: AuditContext): void {
  const users = new Map(childNodes(context, null, 'users').map((node) => [node.id, node.data]));
  for (const officer of childNodes(context, null, 'officers')) {
    const uid = stringField(officer.data, 'uid') ?? officer.id;
    const user = users.get(uid);
    if (!user) addFinding(context, 'officer_user_missing', 'error', officer.path, [], 'Officer profile has no matching user profile.', officer.data);
    else {
      if (user.role !== 'authority') addFinding(context, 'officer_user_role_mismatch', 'error', officer.path, [`users/${uid}`], 'Officer profile points to a non-authority user.', officer.data);
      if (user.authorityType !== officer.data.authorityType) addFinding(context, 'officer_authority_mismatch', 'error', officer.path, [`users/${uid}`], 'Officer and user authority departments differ.', officer.data);
    }
    if (!AUTHORITY_TYPES.has(officer.data.authorityType as AuthorityType)) addFinding(context, 'officer_authority_invalid', 'error', officer.path, [], 'Officer has an unsupported authority department.', officer.data);
  }
  for (const venue of childNodes(context, null, 'venues')) {
    if (!stringField(venue.data, 'state')) addFinding(context, 'venue_state_missing', 'error', venue.path, [], 'Venue has no state or federal jurisdiction.', venue.data);
    if (!(Number(venue.data.capacity) > 0 || Number(venue.data.verifiedSafeCapacity) > 0)) addFinding(context, 'venue_capacity_invalid', 'error', venue.path, [], 'Venue has no positive capacity.', venue.data);
    if (venue.data.active === true && venue.data.verificationStatus !== 'verified') addFinding(context, 'active_venue_not_verified', 'error', venue.path, [], 'Active venue is not verified.', venue.data);
  }
}

function scanEvent(context: AuditContext, event: DocumentNode, publicEventIds: Set<string>): void {
  const data = event.data;
  const eventId = event.id;
  const versionId = stringField(data, 'currentVersionId');
  const assessmentId = stringField(data, 'currentAssessmentId');
  const resourceId = stringField(data, 'currentResourceId');
  const versionPath = versionId ? `${event.path}/${COLLECTIONS.VERSIONS}/${versionId}` : undefined;
  const assessmentPath = assessmentId ? `${event.path}/${COLLECTIONS.ASSESSMENTS}/${assessmentId}` : undefined;
  const resourcePath = resourceId ? `${event.path}/${COLLECTIONS.RESOURCES}/${resourceId}` : undefined;
  const version = nodeAt(context, versionPath);
  const assessment = nodeAt(context, assessmentPath);
  const resource = nodeAt(context, resourcePath);
  const draft = data.status === 'Draft';
  if (!draft && !versionId) addFinding(context, 'current_version_missing', 'error', event.path, [], 'Non-draft application has no current version pointer.', data);
  if (versionId && !version) addFinding(context, 'current_version_pointer_missing', 'critical', event.path, [versionPath!], 'Current version pointer does not resolve.', data);
  if (assessmentId && !assessment) addFinding(context, 'current_assessment_pointer_missing', 'critical', event.path, [assessmentPath!], 'Current assessment pointer does not resolve.', data);
  if (resourceId && !resource) addFinding(context, 'current_resource_pointer_missing', 'critical', event.path, [resourcePath!], 'Current resource pointer does not resolve.', data);
  if (version && version.data.eventId !== eventId) addFinding(context, 'version_event_mismatch', 'error', version.path, [event.path], 'Version eventId does not match its parent.', version.data);
  if (assessment && (assessment.data.eventId !== eventId || assessment.data.versionId !== versionId)) addFinding(context, 'assessment_identity_mismatch', 'critical', assessment.path, [event.path, versionPath ?? ''], 'Current assessment identity does not match the event pointer.', assessment.data);
  if (resource && (resource.data.eventId !== eventId || resource.data.versionId !== versionId || nestedString(resource.data.assessmentReference, 'assessmentId') !== assessmentId)) addFinding(context, 'resource_identity_mismatch', 'critical', resource.path, [event.path, assessmentPath ?? ''], 'Current resource identity does not match the event pointers.', resource.data);
  if (data.status === 'Manual Review Required' && resourceId) addFinding(context, 'manual_review_has_resource', 'error', event.path, [resourcePath!], 'Manual Review Required application unexpectedly points to a resource.', data);

  const assignments = childNodes(context, event.path, COLLECTIONS.ASSIGNMENTS);
  const required = new Set(Array.isArray(data.requiredAuthorities) ? data.requiredAuthorities.filter((value): value is string => typeof value === 'string') : []);
  const seenAuthorities = new Set<string>();
  const activeAssignments = assignments.filter((assignment) => assignment.data.status !== 'revoked');
  for (const assignment of assignments) {
    const authority = stringField(assignment.data, 'authorityType');
    if (authority && seenAuthorities.has(authority)) addFinding(context, 'duplicate_authority_assignment', 'error', assignment.path, assignments.map((item) => item.path), 'More than one assignment exists for the same authority in the current event.', assignment.data);
    if (authority) seenAuthorities.add(authority);
    if (authority && required.size > 0 && !required.has(authority)) addFinding(context, 'assignment_authority_not_required', 'error', assignment.path, [event.path], 'Assignment authority is not required by the event.', assignment.data);
    if (versionId && assignment.data.versionId !== versionId) addFinding(context, 'assignment_version_mismatch', 'error', assignment.path, [versionPath ?? ''], 'Assignment belongs to a non-current version.', assignment.data);
    if (!stringField(assignment.data, 'officerUid')) addFinding(context, 'assignment_officer_missing', 'error', assignment.path, [], 'Assignment has no officer UID.', assignment.data);
  }
  if ((data.status === 'UnderReview' || data.reviewStage === 'authority') && activeAssignments.length === 0) addFinding(context, 'review_without_active_assignment', 'error', event.path, assignments.map((item) => item.path), 'Authority review state has no active authority assignment.', data);

  const controls = childNodes(context, event.path, COLLECTIONS.EVENT_CONTROLS);
  if (data.controlListGenerated === true && controls.length === 0) addFinding(context, 'published_controls_missing', 'error', event.path, [], 'Event says the control list is generated but has no control records.', data);
  for (const control of controls) scanControl(context, control, event, versionId);

  const publicEvent = nodeAt(context, `${COLLECTIONS.PUBLIC_EVENTS}/${eventId}`);
  if (publicEvent) {
    publicEventIds.add(eventId);
    if (data.status !== 'Approved') addFinding(context, 'public_event_not_approved', 'critical', publicEvent.path, [event.path], 'Public projection exists for a non-approved event.', publicEvent.data);
    if (versionId && publicEvent.data.versionId && publicEvent.data.versionId !== versionId) addFinding(context, 'public_event_version_mismatch', 'critical', publicEvent.path, [event.path], 'Public projection points to a non-current version.', publicEvent.data);
    if (fieldPaths(data).length > 0 && !context.governance.has(event.path)) addFinding(context, 'unverified_public_projection', 'critical', publicEvent.path, [event.path], 'Public projection exists while source provenance is not verified.', publicEvent.data, 'Hide the projection until the source record is verified.');
  }
}

function scanControl(context: AuditContext, control: DocumentNode, event: DocumentNode, versionId: string | undefined): void {
  const data = control.data;
  if (data.eventId !== event.id || (versionId && data.versionId !== versionId)) addFinding(context, 'control_identity_mismatch', 'error', control.path, [event.path], 'Control does not belong to the current event version.', data);
  const stage1 = childNodes(context, control.path, COLLECTIONS.STAGE1_DOCS);
  for (const document of stage1) {
    if (!document.id.startsWith(`${control.id}-s1-`)) addFinding(context, 'noncanonical_stage1_id', 'error', document.path, [control.path], 'Stage 1 document ID is not canonical.', document.data);
    const revision = Number(document.data.revision ?? 0);
    if (revision > 0 && !nodeAt(context, `${document.path}/${COLLECTIONS.STAGE1_REVISIONS}/${document.id}-r${revision}`)) addFinding(context, 'stage1_revision_missing', 'error', document.path, [control.path], 'Current Stage 1 document has no matching immutable revision.', document.data);
    const storagePath = stringField(document.data, 'storagePath') ?? stringField(document.data, 'path');
    if (storagePath && context.storage.count > 0 && !context.storage.names.has(storagePath)) addFinding(context, 'stage1_storage_missing', 'error', document.path, [control.path], 'Stage 1 document points to a missing Storage object.', document.data);
  }
  for (const document of childNodes(context, control.path, COLLECTIONS.STAGE2_DOCS)) {
    if (document.id !== `${control.id}-s2`) addFinding(context, 'noncanonical_stage2_id', 'error', document.path, [control.path], 'Stage 2 document ID is not canonical.', document.data);
    const storagePath = stringField(document.data, 'storagePath') ?? stringField(document.data, 'path');
    if (storagePath && context.storage.count > 0 && !context.storage.names.has(storagePath)) addFinding(context, 'stage2_storage_missing', 'error', document.path, [control.path], 'Stage 2 document points to a missing Storage object.', document.data);
  }
}

function scanIncidentsAndPublic(context: AuditContext): void {
  for (const incident of childNodes(context, null, COLLECTIONS.INCIDENTS)) {
    const eventId = stringField(incident.data, 'eventId');
    const reference = incident.data.eventReference && typeof incident.data.eventReference === 'object' && !Array.isArray(incident.data.eventReference)
      ? incident.data.eventReference as Record<string, unknown>
      : undefined;
    const historicalId = stringField(incident.data, 'historicalEventId') ?? nestedString(reference, 'historicalEventId');
    const applicationId = reference?.kind === 'application' ? nestedString(reference, 'eventId') ?? eventId : eventId;
    const resolvesApplication = Boolean(applicationId && nodeAt(context, `${COLLECTIONS.EVENTS}/${applicationId}`));
    const resolvesHistorical = Boolean(historicalId && nodeAt(context, `${HISTORICAL_OCCURRENCES_COLLECTION}/${historicalId}`));
    if (!resolvesApplication && !resolvesHistorical) addFinding(context, 'orphan_incident_event', 'critical', incident.path, [], 'Incident has no resolvable application or historical occurrence.', incident.data, 'Create a historical occurrence or approve an application reference repair.');
    if (historicalId && !nodeAt(context, `${HISTORICAL_OCCURRENCES_COLLECTION}/${historicalId}`)) addFinding(context, 'historical_incident_reference_missing', 'critical', incident.path, [`${HISTORICAL_OCCURRENCES_COLLECTION}/${historicalId}`], 'Incident historical reference does not resolve.', incident.data);
  }
  for (const notification of childNodes(context, null, COLLECTIONS.NOTIFICATIONS)) {
    const recipientUid = stringField(notification.data, 'recipientUid');
    if (recipientUid && !nodeAt(context, `${COLLECTIONS.USERS}/${recipientUid}`)) addFinding(context, 'notification_recipient_missing', 'error', notification.path, [`${COLLECTIONS.USERS}/${recipientUid}`], 'Notification recipient does not exist.', notification.data);
  }
  for (const projection of childNodes(context, null, COLLECTIONS.PUBLIC_EVENT_CONTROLS)) {
    if (!nodeAt(context, `${COLLECTIONS.PUBLIC_EVENTS}/${projection.id}`)) addFinding(context, 'public_controls_without_event', 'critical', projection.path, [`${COLLECTIONS.PUBLIC_EVENTS}/${projection.id}`], 'Public control projection has no public event projection.', projection.data);
  }
  for (const report of childNodes(context, null, COLLECTIONS.PUBLIC_REPORTS)) {
    const eventId = stringField(report.data, 'eventId');
    if (eventId && !nodeAt(context, `${COLLECTIONS.PUBLIC_EVENTS}/${eventId}`)) addFinding(context, 'public_report_without_event', 'error', report.path, [`${COLLECTIONS.PUBLIC_EVENTS}/${eventId}`], 'Public report has no public event projection.', report.data);
  }
}

async function buildReport(options: AuditOptions): Promise<IntegrityAuditReport> {
  const app = initializeApp({ credential: applicationDefault(), projectId: options.projectId, storageBucket: process.env.STERAS_STORAGE_BUCKET ?? `${options.projectId}.firebasestorage.app` }, `integrity-audit-${randomUUID()}`);
  const db = getFirestore(app);
  const { nodes, topLevelCounts, collectionDocumentCounts, findings: collectionFindings } = await collectDocuments(db);
  const context: AuditContext = { db, nodes, topLevelCounts, storage: await collectStorage(app), governance: new Map(), findings: collectionFindings };
  for (const node of childNodes(context, null, GOVERNANCE_COLLECTION)) {
    const sourcePath = stringField(node.data, 'sourcePath');
    if (sourcePath) context.governance.set(sourcePath, node.data);
  }
  scanLegacyFields(context);
  scanUsersAndOfficers(context);
  const publicEventIds = new Set<string>();
  for (const event of childNodes(context, null, COLLECTIONS.EVENTS)) scanEvent(context, event, publicEventIds);
  scanIncidentsAndPublic(context);
  const findings = context.findings.sort(compareIntegrityFindings);
  const collectionCounts = [...topLevelCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([collection, documents]) => ({ collection, documents }));
  const allCollectionCounts = [...collectionDocumentCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([collection, documents]) => ({ collection, documents }));
  return {
    auditRunId: randomUUID(), projectId: options.projectId, generatedAt: new Date().toISOString(),
    scannedDocuments: nodes.size, scannedStorageObjects: context.storage.count, collectionCounts, collectionDocumentCounts: allCollectionCounts, findings,
  };
}

function markdown(report: IntegrityAuditReport): string {
  const allCounts = report.collectionDocumentCounts ?? report.collectionCounts;
  const lines = [`# Firestore integrity audit`, '', `- Audit run: ${report.auditRunId}`, `- Project: ${report.projectId}`, `- Generated: ${report.generatedAt}`, `- Documents: ${report.scannedDocuments}`, `- Storage objects: ${report.scannedStorageObjects}`, '', '## Collection counts', '', '| Collection path | Documents |', '| --- | ---: |', ...allCounts.map((item) => `| ${item.collection} | ${item.documents} |`), '', '## Findings', '', '| Severity | Code | Document path | Summary |', '| --- | --- | --- | --- |', ...report.findings.map((finding) => `| ${finding.severity} | ${finding.code} | ${finding.documentPath} | ${finding.summary} |`), ''];
  return lines.join('\n');
}

async function writeReport(report: IntegrityAuditReport, directory: string): Promise<void> {
  const target = resolve(directory);
  await mkdir(target, { recursive: true });
  await writeFile(resolve(target, 'integrity-audit.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(resolve(target, 'integrity-audit.md'), markdown(report), 'utf8');
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const report = await buildReport(options);
  if (options.outputDirectory) await writeReport(report, options.outputDirectory);
  console.log(JSON.stringify({
    auditRunId: report.auditRunId,
    projectId: report.projectId,
    scannedDocuments: report.scannedDocuments,
    scannedStorageObjects: report.scannedStorageObjects,
    collectionCounts: report.collectionCounts,
    collectionDocumentCountEntries: report.collectionDocumentCounts?.length ?? report.collectionCounts.length,
    findings: report.findings.length,
    bySeverity: Object.fromEntries(['critical', 'error', 'warning', 'info'].map((severity) => [severity, report.findings.filter((finding) => finding.severity === severity).length])),
    outputDirectory: options.outputDirectory,
  }, null, 2));
  if (report.findings.some((finding) => severityAtLeast(finding.severity, options.failOn))) process.exitCode = 2;
}

if (require.main === module) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

export const __testOnly = { fieldPaths, findingId, hash, markdown, severityAtLeast };
