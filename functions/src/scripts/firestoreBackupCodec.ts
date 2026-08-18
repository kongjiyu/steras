import { DocumentReference, GeoPoint, Timestamp } from 'firebase-admin/firestore';

type EncodedFirestoreValue =
  | null
  | string
  | number
  | boolean
  | { type: 'special-number'; value: 'NaN' | 'Infinity' | '-Infinity' }
  | { type: 'timestamp'; seconds: number; nanoseconds: number }
  | { type: 'geopoint'; latitude: number; longitude: number }
  | { type: 'bytes'; base64: string }
  | { type: 'reference'; path: string }
  | { type: 'date'; iso: string }
  | { type: 'array'; values: EncodedFirestoreValue[] }
  | { type: 'map'; values: Record<string, EncodedFirestoreValue> };

export function encodeFirestoreValue(value: unknown): EncodedFirestoreValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    return { type: 'special-number', value: Number.isNaN(value) ? 'NaN' : value > 0 ? 'Infinity' : '-Infinity' };
  }
  if (value instanceof Timestamp) return { type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  if (value instanceof GeoPoint) return { type: 'geopoint', latitude: value.latitude, longitude: value.longitude };
  if (Buffer.isBuffer(value)) return { type: 'bytes', base64: value.toString('base64') };
  if (value instanceof DocumentReference) return { type: 'reference', path: value.path };
  if (value instanceof Date) return { type: 'date', iso: value.toISOString() };
  if (Array.isArray(value)) return { type: 'array', values: value.map(encodeFirestoreValue) };
  if (typeof value === 'object') {
    return {
      type: 'map',
      values: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeFirestoreValue(item)])),
    };
  }
  throw new Error(`Unsupported Firestore backup value: ${typeof value}`);
}

export function decodeFirestoreValue(
  value: EncodedFirestoreValue,
  referenceForPath: (path: string) => DocumentReference,
): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value.type === 'special-number') {
    if (value.value === 'NaN') return Number.NaN;
    return value.value === 'Infinity' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  if (value.type === 'timestamp') return new Timestamp(value.seconds, value.nanoseconds);
  if (value.type === 'geopoint') return new GeoPoint(value.latitude, value.longitude);
  if (value.type === 'bytes') return Buffer.from(value.base64, 'base64');
  if (value.type === 'reference') return referenceForPath(value.path);
  if (value.type === 'date') return new Date(value.iso);
  if (value.type === 'array') return value.values.map((item) => decodeFirestoreValue(item, referenceForPath));
  return Object.fromEntries(Object.entries(value.values).map(
    ([key, item]) => [key, decodeFirestoreValue(item, referenceForPath)],
  ));
}

export type { EncodedFirestoreValue };
