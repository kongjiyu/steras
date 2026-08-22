/** Calls the isolated Admin SDK helper in a separate Node process. */
import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { promisify } from 'node:util';
import { m3UatAdminEnvironment, m3UatAdminScriptPath } from './global-setup';

const execFileAsync = promisify(execFile);

async function run(action: string, argument?: string): Promise<string> {
  const { stdout } = await execFileAsync(
    process.execPath,
    [m3UatAdminScriptPath(), action, ...(argument ? [argument] : [])],
    { env: m3UatAdminEnvironment(), maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.trim();
}

export async function resetFoodFair(): Promise<void> { await run('reset-food-fair'); }
export async function resetMountainRun(): Promise<void> { await run('reset-mountain-run'); }
export async function resetApprovedEvent(): Promise<void> { await run('reset-approved-event'); }
export async function restoreControlVerificationFixture(): Promise<void> { await run('reset-control-verification'); }
export async function resetMarathon(): Promise<void> { await run('reset-marathon'); }

export async function seedPublicEvent(eventId: string, payload: Record<string, unknown>): Promise<void> {
  const encoded = Buffer.from(JSON.stringify({ eventId, payload }), 'utf8').toString('base64url');
  await run('seed-public-event', encoded);
}

export async function dedicatedOfficerUids(): Promise<{ pdrm: string; bomba: string; kkm: string; dbkl: string; motac: string }> {
  return JSON.parse(await run('identity-uids')) as { pdrm: string; bomba: string; kkm: string; dbkl: string; motac: string };
}
