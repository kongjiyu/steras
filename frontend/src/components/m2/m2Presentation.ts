import { ResourceKey, ResourceQuantities, ResourceRecommendation } from '@shared/types';

export const RESOURCE_FIELDS: { key: ResourceKey; label: string; shortLabel: string }[] = [
  { key: 'police', label: 'Police officers', shortLabel: 'Police' },
  { key: 'security', label: 'Security personnel', shortLabel: 'Security' },
  { key: 'medicalTeams', label: 'Medical teams', shortLabel: 'Medical' },
  { key: 'ambulances', label: 'Ambulances', shortLabel: 'Ambulances' },
  { key: 'fireOfficers', label: 'Fire officers', shortLabel: 'Fire' },
  { key: 'toilets', label: 'Portable toilets', shortLabel: 'Toilets' },
  { key: 'wasteBins', label: 'Waste bins', shortLabel: 'Waste bins' },
];

export function toResourceQuantities(resource: ResourceRecommendation): ResourceQuantities {
  return Object.fromEntries(RESOURCE_FIELDS.map(({ key }) => [key, resource.items[key].baseline])) as unknown as ResourceQuantities;
}
export function formatM2Timestamp(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return 'Not recorded';
  return new Intl.DateTimeFormat('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}
