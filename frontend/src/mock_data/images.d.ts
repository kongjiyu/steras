/**
 * Type declarations for image asset imports in the mock_data folder.
 *
 * Vite bundles these as hashed URLs at build time. The returned string
 * is the public URL Vite serves them at, which is the same shape as a
 * live Firebase Storage URL — so swapping mock data to live data is a
 * one-line change (replace the import with a string literal).
 */

declare module '*.jpg' {
  const src: string;
  export default src;
}

declare module '*.jpeg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.webp' {
  const src: string;
  export default src;
}
