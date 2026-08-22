/** Mutating M3 setup restricted to the manifest-managed linkos dataset. */
import type { FullConfig } from '@playwright/test';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { M3_UAT_DATASET_ID, M3_UAT_SHARED_PROJECT_ID } from '../../../shared/m3UatFixtures';

const execFileAsync = promisify(execFile);
const projectId = process.env.STERAS_E2E_PROJECT_ID?.trim() ?? '';
const baseUrl = process.env.STERAS_BASE_URL?.trim() ?? '';
const password = process.env.STERAS_E2E_PASSWORD?.trim() ?? '';

function assertTargetSafety(): void {
  if (!projectId) throw new Error('Set STERAS_E2E_PROJECT_ID before running the mutating M3 Playwright suite.');
  if (!baseUrl) throw new Error('Set STERAS_BASE_URL before running the mutating M3 Playwright suite.');
  if (process.env.STERAS_E2E_ALLOW_RESET !== 'true') throw new Error('Set STERAS_E2E_ALLOW_RESET=true.');
  if (password.length < 12) throw new Error('Set STERAS_E2E_PASSWORD to at least 12 characters.');
  if (projectId === M3_UAT_SHARED_PROJECT_ID) {
    if (process.env.STERAS_E2E_ALLOW_SHARED_PROJECT !== 'true') throw new Error('Set STERAS_E2E_ALLOW_SHARED_PROJECT=true to use linkos.');
    if (process.env.STERAS_E2E_DATASET_ID !== M3_UAT_DATASET_ID) throw new Error(`Set STERAS_E2E_DATASET_ID=${M3_UAT_DATASET_ID}.`);
    const expectedHosts = [`https://${projectId}.web.app`, `https://${projectId}.firebaseapp.com`];
    if (!expectedHosts.some((host) => baseUrl === host || baseUrl.startsWith(`${host}/`))) throw new Error(`STERAS_BASE_URL must target ${projectId}.`);
  }
}

export function m3UatAdminEnvironment(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FIREBASE_PROJECT_ID: projectId,
    M3_UAT_ALLOW_SHARED_PROJECT: process.env.STERAS_E2E_ALLOW_SHARED_PROJECT,
    M3_UAT_PASSWORD: password,
  };
}

export function m3UatAdminScriptPath(): string {
  const relative = 'functions/lib/functions/src/seed/m3UatTestAdmin.js';
  const candidates = [path.resolve(process.cwd(), relative), path.resolve(process.cwd(), '..', relative)];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error(`Build the Functions workspace first; missing ${relative}.`);
  return found;
}

export default async function globalSetup(_config: FullConfig): Promise<void> {
  void _config;
  assertTargetSafety();
  console.info(`[M3 setup] Resetting only ${M3_UAT_DATASET_ID} on ${projectId}...`);
  await execFileAsync(process.execPath, [m3UatAdminScriptPath(), 'prepare'], { env: m3UatAdminEnvironment(), maxBuffer: 10 * 1024 * 1024 });
  console.info('[M3 setup] Manifest-managed fixtures are ready.');
}
