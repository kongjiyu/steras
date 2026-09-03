import type { Stage2Doc } from '@shared/types';

export function counterMatchesStage2(counter: unknown, stage2: Stage2Doc): boolean {
  return Boolean(counter
    && typeof counter === 'object'
    && (counter as Record<string, unknown>).stage2UploadedAt === stage2.uploadedAt);
}
