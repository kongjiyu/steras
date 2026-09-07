import { describe, expect, it } from 'vitest';
import { documentMime } from './documentMime';
describe('document preview types', () => {
  it('recognises JPEG binary even when Storage has returned a text MIME type', () => {
    expect(documentMime(new Uint8Array([255, 216, 255, 224]))).toBe('image/jpeg');
  });
  it('does not render HTML or renamed arbitrary data as an image', () => {
    expect(documentMime(new TextEncoder().encode('<html>test</html>'))).toBeUndefined();
    expect(documentMime(new Uint8Array())).toBeUndefined();
  });
  it('recognises PDF and PNG signatures', () => {
    expect(documentMime(new TextEncoder().encode('%PDF-1.7'))).toBe('application/pdf');
    expect(documentMime(new Uint8Array([137,80,78,71,13,10,26,10]))).toBe('image/png');
  });
});
