import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  type IntegrityAuditReport,
  type IntegrityRepairAction,
  type IntegrityRepairManifest,
  type IntegrityRepairOperation,
} from '@shared/dataIntegrity';

interface Options {
  auditPath: string;
  outputPath: string;
  projectId?: string;
}

function argument(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function parseOptions(argv: string[]): Options {
  const auditPath = argument(argv, '--audit');
  const outputPath = argument(argv, '--output');
  if (!auditPath || !outputPath) throw new Error('Usage: --audit <integrity-audit.json> --output <manifest.json> [--project <project-id>]');
  return { auditPath, outputPath, projectId: argument(argv, '--project') };
}

function operationForCode(code: string): IntegrityRepairOperation {
  switch (code) {
    case 'unverified_public_projection':
    case 'public_event_not_approved':
    case 'public_event_version_mismatch':
    case 'public_controls_without_event':
      return 'quarantine_public_projection';
    case 'orphan_incident_event':
      return 'create_historical_occurrence';
    case 'legacy_source_marker':
      return 'migrate_legacy_metadata';
    case 'storage_legacy_source_marker':
      return 'manual_review';
    case 'legacy_identifier':
      return 'migrate_identifier';
    default:
      return 'manual_review';
  }
}

function isDestructive(operation: IntegrityRepairOperation): boolean {
  return operation !== 'manual_review';
}

function actionId(findingId: string, operation: IntegrityRepairOperation): string {
  return createHash('sha256').update(`${findingId}|${operation}`).digest('hex').slice(0, 24);
}

export function buildRepairManifest(report: IntegrityAuditReport): IntegrityRepairManifest {
  const actions: IntegrityRepairAction[] = report.findings.map((finding) => {
    const operation = operationForCode(finding.code);
    return {
      actionId: actionId(finding.findingId, operation),
      findingId: finding.findingId,
      operation,
      documentPath: finding.documentPath,
      relatedPaths: [...finding.relatedPaths].sort(),
      expectedBeforeHash: finding.beforeHash,
      reason: finding.proposedAction ?? finding.summary,
      destructive: isDestructive(operation),
      status: 'proposed',
    };
  });
  const manifestId = createHash('sha256').update(JSON.stringify({
    projectId: report.projectId,
    auditRunId: report.auditRunId,
    generatedAt: report.generatedAt,
    actions: actions.map(({ actionId: id, ...action }) => ({ id, ...action })),
  })).digest('hex').slice(0, 32);
  return {
    manifestId,
    projectId: report.projectId,
    auditRunId: report.auditRunId,
    generatedAt: new Date().toISOString(),
    expectedReportGeneratedAt: report.generatedAt,
    actions,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const report = JSON.parse(await readFile(resolve(options.auditPath), 'utf8')) as IntegrityAuditReport;
  if (options.projectId && options.projectId !== report.projectId) throw new Error(`Project mismatch: report=${report.projectId}, requested=${options.projectId}.`);
  const manifest = buildRepairManifest(report);
  await writeFile(resolve(options.outputPath), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const byOperation = Object.fromEntries([...new Set(manifest.actions.map((action) => action.operation))].sort().map((operation) => [operation, manifest.actions.filter((action) => action.operation === operation).length]));
  console.log(JSON.stringify({ manifestId: manifest.manifestId, projectId: manifest.projectId, auditRunId: manifest.auditRunId, actions: manifest.actions.length, byOperation, output: resolve(options.outputPath) }, null, 2));
}

if (require.main === module) main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });

export const __testOnly = { actionId, operationForCode, buildRepairManifest };
