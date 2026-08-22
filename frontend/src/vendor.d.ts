/** Narrow compatibility declarations for packages whose published export
 * maps do not expose their bundled declarations under TypeScript bundler
 * resolution. */
declare module 'date-fns' {
  export function format(date: Date | number, formatString: string, options?: Record<string, unknown>): string;
  export function formatDistanceToNowStrict(date: Date | number, options?: { addSuffix?: boolean }): string;
}

declare module 'firebase/storage' {
  export interface FirebaseStorage { app?: unknown }
  export interface StorageReference { fullPath: string }
  export interface UploadTaskSnapshot { bytesTransferred: number; totalBytes: number }
  export interface UploadTask {
    on(
      event: 'state_changed',
      next?: (snapshot: UploadTaskSnapshot) => void,
      error?: (error: Error) => void,
      complete?: () => void,
    ): unknown;
  }
  export function getStorage(app?: unknown): FirebaseStorage;
  export function connectStorageEmulator(storage: FirebaseStorage, host: string, port: number): void;
  export function ref(storage: FirebaseStorage, path: string): StorageReference;
  export function uploadBytesResumable(reference: StorageReference, data: Blob, metadata?: { contentType?: string }): UploadTask;
  export function deleteObject(reference: StorageReference): Promise<void>;
  export function getBlob(reference: StorageReference, maxDownloadSizeBytes?: number): Promise<Blob>;
}
