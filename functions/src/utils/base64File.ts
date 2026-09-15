import { HttpsError } from 'firebase-functions/v2/https';

export function validateBase64File(value: string, mimeType: string, maxBytes: number): { sizeBytes: number } {
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4 + 4;
  if (!value || value.length > maxEncodedLength || value.length % 4 === 1
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new HttpsError('invalid-argument', 'The uploaded file is not valid base64 data.');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length < 1 || bytes.length > maxBytes
    || bytes.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new HttpsError('invalid-argument', `File must contain 1-${maxBytes} decoded bytes.`);
  }
  if (!contentMatchesMime(bytes, mimeType)) {
    throw new HttpsError('invalid-argument', `File content does not match declared MIME type ${mimeType}.`);
  }
  return { sizeBytes: bytes.length };
}

function contentMatchesMime(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === 'application/pdf') {
    return bytes.length >= 12
      && bytes.subarray(0, 5).toString('ascii') === '%PDF-'
      && bytes.lastIndexOf(Buffer.from('%%EOF')) >= Math.max(0, bytes.length - 1_024);
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 6
      && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
  }
  if (mimeType === 'image/png') {
    return bytes.length >= 24
      && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      && bytes.subarray(12, 16).toString('ascii') === 'IHDR';
  }
  return false;
}
