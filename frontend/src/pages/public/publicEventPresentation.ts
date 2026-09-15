export function formatEventDateRange(startTimestamp: number, endTimestamp: number): string {
  const start = new Date(startTimestamp);
  const end = new Date(endTimestamp);
  const dateKey = (value: Date) => `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  const long = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (dateKey(start) === dateKey(end)) return long.format(start);
  return `${long.format(start)} – ${long.format(end)}`;
}
