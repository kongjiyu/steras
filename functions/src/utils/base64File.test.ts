import { describe, expect, it } from 'vitest';
import { validateBase64File } from './base64File';

describe('base64 document boundary', () => {
  it('accepts matching PDF, JPEG and PNG signatures', () => {
    expect(validateBase64File(Buffer.from('%PDF-1.7\nbody\n%%EOF').toString('base64'), 'application/pdf', 100).sizeBytes).toBe(19);
    expect(validateBase64File(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]).toString('base64'), 'image/jpeg', 100).sizeBytes).toBe(6);
    const png = Buffer.alloc(24); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png); png.write('IHDR', 12);
    expect(validateBase64File(png.toString('base64'), 'image/png', 100).sizeBytes).toBe(24);
  });

  it('rejects malformed, oversized, and MIME-spoofed payloads', () => {
    expect(() => validateBase64File('!!!!', 'application/pdf', 100)).toThrow(/valid base64/);
    expect(() => validateBase64File(Buffer.from('%PDF-oversized').toString('base64'), 'application/pdf', 4)).toThrow();
    expect(() => validateBase64File(Buffer.from('<html>').toString('base64'), 'image/png', 100)).toThrow(/does not match/);
    expect(() => validateBase64File(Buffer.from('%PDF-1.7').toString('base64'), 'application/pdf', 100)).toThrow(/does not match/);
    expect(() => validateBase64File(Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'), 'image/jpeg', 100)).toThrow(/does not match/);
  });
});
