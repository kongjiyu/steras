export const MALAYSIA_STATES = [
  'Johor', 'Kedah', 'Kelantan', 'Melaka', 'Negeri Sembilan', 'Pahang',
  'Perak', 'Perlis', 'Pulau Pinang', 'Sabah', 'Sarawak', 'Selangor',
  'Terengganu', 'Kuala Lumpur', 'Labuan', 'Putrajaya',
] as const;

export type MalaysiaState = (typeof MALAYSIA_STATES)[number];

const MALAYSIA_STATE_ALIASES: ReadonlyArray<readonly [string, MalaysiaState]> = [
  ['federal territory of kuala lumpur', 'Kuala Lumpur'],
  ['wilayah persekutuan kuala lumpur', 'Kuala Lumpur'],
  ['kuala lumpur', 'Kuala Lumpur'],
  ['federal territory of labuan', 'Labuan'],
  ['wilayah persekutuan labuan', 'Labuan'],
  ['labuan', 'Labuan'],
  ['federal territory of putrajaya', 'Putrajaya'],
  ['wilayah persekutuan putrajaya', 'Putrajaya'],
  ['putrajaya', 'Putrajaya'],
  ['pulau pinang', 'Pulau Pinang'],
  ['penang', 'Pulau Pinang'],
  ['malacca', 'Melaka'],
  ['melaka', 'Melaka'],
  ...MALAYSIA_STATES.filter((state) => !['Kuala Lumpur', 'Labuan', 'Putrajaya', 'Pulau Pinang', 'Melaka'].includes(state))
    .map((state) => [state.toLocaleLowerCase('en-MY'), state] as const),
];

function normalizedAddressText(value: string): string {
  return value.toLocaleLowerCase('en-MY').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function normalizeMalaysiaState(value: string): MalaysiaState | undefined {
  const normalized = normalizedAddressText(value);
  return MALAYSIA_STATE_ALIASES.find(([alias]) => normalized === alias)?.[1];
}

export function inferMalaysiaStateFromAddress(address: string): MalaysiaState | undefined {
  const normalized = ` ${normalizedAddressText(address)} `;
  return MALAYSIA_STATE_ALIASES.find(([alias]) => normalized.includes(` ${alias} `))?.[1];
}

