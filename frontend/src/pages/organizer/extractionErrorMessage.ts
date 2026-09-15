export function extractionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Document extraction failed. Try again.';
  if (/roles appear to be reversed/i.test(message)) return 'The Core and scenario files appear swapped. Put each file in its matching upload box, then extract again.';
  if (/does not identify itself|field ids|does not match STERAS/i.test(message)) return 'The uploaded application does not match the selected STERAS templates. Download the recommended Core and scenario templates, complete them, and replace the files above.';
  return message;
}
