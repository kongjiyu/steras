import { describe, expect, it } from 'vitest';
import { stage1DocumentId, stage1RevisionId } from './stage1';

describe('Stage 1 canonical identifiers', () => {
  it('uses one document id for every reader and writer', () => {
    expect(stage1DocumentId('event-ctrl-bomba-v1', 'insurance')).toBe('event-ctrl-bomba-v1-s1-insurance');
  });

  it('derives immutable revision ids from the canonical document id', () => {
    expect(stage1RevisionId('event-ctrl-bomba-v1-s1-insurance', 2)).toBe('event-ctrl-bomba-v1-s1-insurance-r2');
  });
});
