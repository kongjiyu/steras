import { describe, expect, it } from 'vitest';
import { safeStage1DocumentHref } from './safeDocumentLink';

describe('Stage 1 document link sanitization', () => {
  it('allows backend-produced document data URLs and HTTPS links', () => {
    expect(safeStage1DocumentHref('data:application/pdf;base64,JVBERi0=')).toBe('data:application/pdf;base64,JVBERi0=');
    expect(safeStage1DocumentHref('https://storage.example.test/file.pdf')).toBe('https://storage.example.test/file.pdf');
  });

  it('rejects script, HTML data, insecure, protocol-relative, and relative links', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html;base64,PGgxPg==', 'http://example.test/file', '//example.test/file', 'evidence/file.pdf']) {
      expect(safeStage1DocumentHref(value)).toBeUndefined();
    }
  });
});
