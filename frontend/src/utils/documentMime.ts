/** Storage can return application/octet-stream: identify renderable bytes, never HTML. */
export function documentMime(bytes: Uint8Array): string | undefined {
  const text = new TextDecoder().decode(bytes.slice(0, 12));
  if (text.startsWith('%PDF-')) return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, i) => bytes[i] === value)) return 'image/png';
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return undefined;
}
