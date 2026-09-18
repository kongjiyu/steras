import { describe, expect, it } from 'vitest';
import { __testOnly } from './applyIntegrityRepairs';

describe('applyIntegrityRepairs safeguards', () => {
  it('finds legacy markers at any nested path', () => {
    expect(__testOnly.legacyPaths({ presentationData: { value: 1 }, nested: { synthetic: true } })).toEqual(['presentationData', 'nested.synthetic']);
  });

  it('hashes equivalent objects deterministically', () => {
    expect(__testOnly.hash({ b: 2, a: 1 })).toBe(__testOnly.hash({ a: 1, b: 2 }));
  });
});
