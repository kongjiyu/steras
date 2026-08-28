import { EventRiskProfile } from './types';

export interface M1EvidenceRequirementDefinition {
  id: string;
  source: 'core' | 'scenario';
  requirement: 'always' | 'conditional';
  /** A true application declaration makes this conditional requirement mandatory. */
  riskFlag?: keyof EventRiskProfile;
}

export const M1_CORE_EVIDENCE_REQUIREMENT_IDS = [
  'DOC-A01', 'DOC-A02', 'DOC-A03', 'DOC-B01', 'DOC-B02',
  'DOC-C01', 'DOC-C02', 'DOC-D01', 'DOC-D02',
] as const;

const SCENARIO_COUNTS: Record<string, number> = {
  'STERAS-T01-ENT-IN-v2.0': 9,
  'STERAS-T02-ENT-OF-v1.0': 10,
  'STERAS-T03-ENT-OR-v1.0': 10,
  'STERAS-T04-SPT-IN-v1.0': 5,
  'STERAS-T05-SPT-OF-v1.0': 4,
  'STERAS-T06-SPT-OR-v1.0': 4,
  'STERAS-T07-CUL-IN-v1.0': 6,
  'STERAS-T08-CUL-OF-v1.0': 8,
  'STERAS-T09-CUL-OR-v1.0': 8,
  'STERAS-T10-EXP-IN-v1.0': 7,
  'STERAS-T11-EXP-OF-v1.0': 8,
  'STERAS-T12-EXP-OR-v1.0': 9,
  'STERAS-T13-CAR-IN-v1.0': 8,
  'STERAS-T14-CAR-OF-v1.0': 9,
  'STERAS-T15-CAR-OR-v1.0': 9,
};

const ALWAYS_SCENARIO_IDS = new Set([
  'T03-DOC-01',
  'T06-DOC-01', 'T06-DOC-02',
  'T09-DOC-01',
  'T12-DOC-01',
  'T15-DOC-01',
]);

const RISK_FLAG_BY_REQUIREMENT: Record<string, keyof EventRiskProfile> = {
  'T01-DOC-02': 'pyrotechnics', 'T01-DOC-04': 'temporaryStructures', 'T01-DOC-05': 'foodServed', 'T01-DOC-06': 'alcoholServed', 'T01-DOC-09': 'ticketedEntry',
  'T02-DOC-02': 'temporaryStructures', 'T02-DOC-03': 'pyrotechnics', 'T02-DOC-04': 'foodServed', 'T02-DOC-05': 'alcoholServed', 'T02-DOC-10': 'ticketedEntry',
  'T03-DOC-04': 'temporaryStructures', 'T03-DOC-05': 'pyrotechnics', 'T03-DOC-07': 'ticketedEntry',
  'T04-DOC-02': 'temporaryStructures', 'T04-DOC-04': 'foodServed',
  'T05-DOC-01': 'temporaryStructures',
  'T06-DOC-03': 'temporaryStructures',
  'T07-DOC-01': 'foodServed', 'T07-DOC-02': 'temporaryStructures', 'T07-DOC-04': 'pyrotechnics',
  'T08-DOC-01': 'foodServed', 'T08-DOC-02': 'temporaryStructures', 'T08-DOC-04': 'pyrotechnics',
  'T09-DOC-04': 'pyrotechnics', 'T09-DOC-05': 'temporaryStructures',
  'T10-DOC-01': 'temporaryStructures', 'T10-DOC-03': 'foodServed', 'T10-DOC-04': 'ticketedEntry', 'T10-DOC-05': 'alcoholServed',
  'T11-DOC-01': 'temporaryStructures', 'T11-DOC-03': 'foodServed', 'T11-DOC-04': 'pyrotechnics', 'T11-DOC-07': 'ticketedEntry',
  'T12-DOC-03': 'temporaryStructures', 'T12-DOC-04': 'foodServed', 'T12-DOC-05': 'pyrotechnics', 'T12-DOC-08': 'ticketedEntry',
  'T13-DOC-02': 'foodServed', 'T13-DOC-03': 'temporaryStructures', 'T13-DOC-04': 'pyrotechnics', 'T13-DOC-06': 'ticketedEntry', 'T13-DOC-07': 'alcoholServed',
  'T14-DOC-02': 'foodServed', 'T14-DOC-03': 'temporaryStructures', 'T14-DOC-04': 'pyrotechnics', 'T14-DOC-08': 'alcoholServed',
  'T15-DOC-04': 'foodServed', 'T15-DOC-05': 'temporaryStructures', 'T15-DOC-06': 'pyrotechnics',
};

export function m1EvidenceRequirementsFor(scenarioTemplateId: string): M1EvidenceRequirementDefinition[] {
  const count = SCENARIO_COUNTS[scenarioTemplateId];
  const prefix = scenarioTemplateId.match(/STERAS-(T\d{2})-/)?.[1];
  if (!count || !prefix) return [];
  return [
    ...M1_CORE_EVIDENCE_REQUIREMENT_IDS.map((id) => ({ id, source: 'core' as const, requirement: 'always' as const })),
    ...Array.from({ length: count }, (_, index) => {
      const id = `${prefix}-DOC-${String(index + 1).padStart(2, '0')}`;
      return {
        id,
        source: 'scenario' as const,
        requirement: ALWAYS_SCENARIO_IDS.has(id) ? 'always' as const : 'conditional' as const,
        ...(RISK_FLAG_BY_REQUIREMENT[id] ? { riskFlag: RISK_FLAG_BY_REQUIREMENT[id] } : {}),
      };
    }),
  ];
}

export function isM1EvidenceForcedRequired(
  definition: M1EvidenceRequirementDefinition,
  riskProfile: EventRiskProfile | undefined,
): boolean {
  return definition.requirement === 'always'
    || (definition.riskFlag !== undefined && riskProfile?.[definition.riskFlag] === true);
}
