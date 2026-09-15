export default function warning(condition: unknown, message?: string): void {
  if (condition || import.meta.env.PROD) return;
  console.warn(message ?? 'Warning');
}
