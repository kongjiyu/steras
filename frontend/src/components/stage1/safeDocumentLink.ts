const SAFE_DATA_PREFIXES = [
  'data:application/pdf;base64,',
  'data:image/jpeg;base64,',
  'data:image/png;base64,',
] as const;

export function safeStage1DocumentHref(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (SAFE_DATA_PREFIXES.some((prefix) => value.startsWith(prefix))) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
