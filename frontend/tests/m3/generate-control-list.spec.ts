/**
 * M3 Workstream 2 — generate + edit + cache on the per-authority event
 * control list. The flow is admin-initiated (no Firestore trigger;
 * the M3 owner decided on 2026-08-18 that the admin must click).
 *
 *   1. Admin opens AdminControlListEditor, clicks "Generate proposal".
 *      The function returns the cached snapshot (after the first
 *      commit) or calls the proposeEventControlList stub fresh.
 *   2. Admin edits the items in place (rename, add/remove Stage 1
 *      requirements, add/remove control items).
 *   3. Admin clicks "Commit changes". The function writes one
 *      `event_controls/{controlId}` doc per item, sets
 *      `event.controlListGenerated = true` + writes a snapshot, and
 *      writes a `control_list_published` audit log entry.
 *   4. A second call to `generateEventControlList` returns the
 *      cached snapshot (no re-call to MiniMax), marked
 *      `cached: true` (A23: don't regenerate without explicit reason).
 */
import { test, expect, EVENTS } from './fixtures';
import { resetApprovedEvent } from './admin-reset';

const APPROVED = EVENTS.musicFestival;

test.describe('@M3 Workstream 2: generate + edit + cache event control list', () => {
  test.setTimeout(90_000);

  test.beforeEach(async () => {
    await resetApprovedEvent();
  });

  test('admin generates a proposal for an Approved event; items match the validated proposal contract', async ({ api, loginAs }) => {
    await loginAs('admin');
    const result = await api.callFunction<{ eventId: string }, { items: Array<{ controlName: string; authority: string; stage1Requirements: Array<{ docType: string; label: string; required: boolean }> }>; cached: boolean; source: string }>(
      'generateEventControlList',
      { eventId: APPROVED },
    );
    expect(result.cached).toBe(false);
    expect(['minimax', 'deterministic_fallback']).toContain(result.source);
    if (process.env.STERAS_REQUIRE_MINIMAX === 'true') expect(result.source).toBe('minimax');
    // The proposal returns one item per authority required by this event.
    const event = await api.getDoc<{ requiredAuthorities: string[] }>(`events/${APPROVED}`);
    expect(event?.requiredAuthorities).toBeTruthy();
    expect(result.items.length).toBe(event!.requiredAuthorities.length);
    const auths = result.items.map((it) => it.authority);
    expect(auths).toEqual(expect.arrayContaining(event!.requiredAuthorities));
    // Spot-check the shape: each item has stage1Requirements + stage2Requirement.
    for (const item of result.items) {
      expect(item.controlName).toBeTruthy();
      expect(item.stage1Requirements.length).toBeGreaterThan(0);
      expect(item.stage2Requirement).toBeTruthy();
    }
  });

  test('admin commits the list; event_controls/{id} docs are written; controlListGenerated=true; audit log written', async ({ api, loginAs }) => {
    await loginAs('admin');
    // Generate first.
    const gen = await api.callFunction<{ eventId: string }, { items: Array<{ controlName: string; authority: string; stageRequirement: 'stage1_only' | 'stage1_and_stage2'; stage1Requirements: Array<{ docType: 'application' | 'license' | 'insurance' | 'receipt' | 'floor_plan' | 'other'; label: string; required: boolean }>; stage2Requirement: { kind: 'image'; label: string } | null }> }>(
      'generateEventControlList',
      { eventId: APPROVED },
    );
    expect(gen.items.length).toBeGreaterThan(0);

    // Commit.
    const commit = await api.callFunction<{ eventId: string; items: typeof gen.items }, { written: number; controlIds: string[] }>(
      'editEventControlList',
      { eventId: APPROVED, items: gen.items },
    );
    expect(commit.written).toBe(gen.items.length);
    expect(commit.controlIds.length).toBe(gen.items.length);

    // event.controlListGenerated is true + snapshot is populated.
    const event = await api.getDoc<{ controlListGenerated: boolean; controlListSnapshot: Array<{ controlId: string; authority: string; controlName: string; stage1RequirementsCount: number; controlItemVersion: number; label: string }> }>(`events/${APPROVED}`);
    expect(event?.controlListGenerated).toBe(true);
    expect(event?.controlListSnapshot?.length).toBe(gen.items.length);
    for (const s of event!.controlListSnapshot!) {
      expect(s.controlItemVersion).toBe(1);
      expect(s.label).toBe('pending');
    }

    // Per-control docs are written (one per item).
    for (const id of commit.controlIds) {
      const ctrl = await api.getDoc<{ controlId: string; authority: string; controlName: string; label: string; versionId: string }>(`events/${APPROVED}/event_controls/${id}`);
      expect(ctrl?.controlId).toBe(id);
      expect(ctrl?.label).toBe('pending');
    }

    // Audit log entry written.
    const audits = await api.getCollection<{ action: string; actorRole: string; metadata: { controlItemVersion: number; controlIds: string[] } }>(
      `events/${APPROVED}/audit_logs`,
    );
    const published = audits.filter((a) => a.action === 'control_list_published');
    expect(published.length).toBe(1);
    expect(published[0].actorRole).toBe('admin');
    expect(published[0].metadata.controlItemVersion).toBe(1);
    expect(published[0].metadata.controlIds.length).toBe(gen.items.length);
  });

  test('second generate returns the cached list (no re-call to proposeEventControlList)', async ({ api, loginAs }) => {
    await loginAs('admin');
    // First call: fresh proposal.
    const first = await api.callFunction<{ eventId: string }, { items: unknown[]; cached: boolean; source: string }>(
      'generateEventControlList',
      { eventId: APPROVED },
    );
    expect(first.cached).toBe(false);
    expect(['minimax', 'deterministic_fallback']).toContain(first.source);
    if (process.env.STERAS_REQUIRE_MINIMAX === 'true') expect(first.source).toBe('minimax');

    // Commit so the snapshot is persisted.
    await api.callFunction('editEventControlList', { eventId: APPROVED, items: first.items });

    // Second call (without force): cached.
    const second = await api.callFunction<{ eventId: string }, { items: unknown[]; cached: boolean; source: string }>(
      'generateEventControlList',
      { eventId: APPROVED },
    );
    expect(second.cached).toBe(true);
    expect(second.source).toBe('cache');
    expect(second.items.length).toBe(first.items.length);

    // Third call (with force: true): fresh re-fetch.
    const third = await api.callFunction<{ eventId: string; force?: boolean }, { items: unknown[]; cached: boolean; source: string }>(
      'generateEventControlList',
      { eventId: APPROVED, force: true },
    );
    expect(third.cached).toBe(false);
    expect(['minimax', 'deterministic_fallback']).toContain(third.source);
    if (process.env.STERAS_REQUIRE_MINIMAX === 'true') expect(third.source).toBe('minimax');
  });
});
