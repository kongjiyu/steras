import { describe, expect, it } from 'vitest';
import { formatStage1ReviewerLabel } from './AdminStage2Review';
import type { OfficerProfile } from '@shared/types';

const officer: OfficerProfile = {
  uid: 'uid-that-must-not-render',
  authorityType: 'BOMBA',
  state: 'Selangor',
  scopeType: 'state',
  workloadCount: 0,
  workloadLimit: 10,
  active: true,
  createdAt: 1,
  updatedAt: 1,
};

describe('Stage 1 reviewer labels', () => {
  it('uses the resolved human name and never renders a raw UID', () => {
    expect(formatStage1ReviewerLabel(officer, {
      [officer.uid]: { name: 'Aisyah Rahman', role: 'authority', authorityType: 'BOMBA' },
    })).toBe('Aisyah Rahman · BOMBA · Selangor');
  });

  it('uses a safe fallback when identity lookup is unavailable', () => {
    expect(formatStage1ReviewerLabel(officer, {})).toBe('BOMBA officer · BOMBA · Selangor');
    expect(formatStage1ReviewerLabel(officer, {})).not.toContain(officer.uid);
  });
});
