import {
  AuthorityType,
  DecisionValue,
  EventRecord,
  EventStatus,
  EventType,
  ProposedControlItem,
  RejectionReasonCategory,
  RiskLevel,
} from '@shared/types';

/** Versioned, deterministic fixture-derived workflow contract. */
export const FIXED_WORKFLOW_PRESET_VERSION = 'm3-fixed-workflow-v1';

export interface FixedWorkflowPresetSelection {
  version: typeof FIXED_WORKFLOW_PRESET_VERSION;
  presetId: string;
  templateStatus: EventStatus;
  matchedEventType: EventType;
  matchedRiskLevel: RiskLevel;
  selectedAt: number;
}

export interface FixedWorkflowPreset {
  id: string;
  templateStatus: EventStatus;
  eventTypes: EventType[];
  riskLevel: RiskLevel;
  requiredAuthorities: AuthorityType[];
  initialDecision: DecisionValue;
  authorityDecision: DecisionValue;
  finalDecision: DecisionValue;
  reason: string;
  suggestion: string;
  rejectionReasonCategory?: RejectionReasonCategory;
  controls: ProposedControlItem[];
}

const STAGE1_REQUIREMENTS: Record<AuthorityType, ProposedControlItem['stage1Requirements']> = {
  PDRM: [
    { docType: 'application', label: 'PDRM event notification acknowledgement', required: true },
    { docType: 'insurance', label: 'Public liability insurance', required: true },
  ],
  BOMBA: [
    { docType: 'application', label: 'BOMBA event notification acknowledgement', required: true },
    { docType: 'license', label: 'Fire safety officer posting licence', required: true },
  ],
  KKM: [
    { docType: 'application', label: 'KKM medical plan acknowledgement', required: true },
    { docType: 'insurance', label: 'Public liability insurance', required: true },
  ],
  DBKL: [
    { docType: 'application', label: 'DBKL venue permit acknowledgement', required: true },
    { docType: 'license', label: 'Venue operating licence', required: true },
  ],
  MOTAC: [
    { docType: 'application', label: 'MOTAC tourism permit acknowledgement', required: true },
    { docType: 'license', label: 'Tourism operator licence', required: true },
  ],
};

const CONTROL_NAMES: Record<AuthorityType, string> = {
  PDRM: 'PDRM presence and traffic management',
  BOMBA: 'BOMBA fire safety and egress verification',
  KKM: 'KKM medical and sanitation verification',
  DBKL: 'DBKL venue and emergency access verification',
  MOTAC: 'MOTAC tourism operator compliance',
};

const STAGE2_LABELS: Record<AuthorityType, string> = {
  PDRM: 'Photo of PDRM officers on-site at venue',
  BOMBA: 'Photo of BOMBA officers and fire extinguishers at venue',
  KKM: 'Photo of KKM medical team and ambulance at venue',
  DBKL: 'Photo of DBKL-approved venue setup',
  MOTAC: 'Photo of MOTAC permit displayed at venue',
};

const APPROVED_TEMPLATES: Array<Pick<FixedWorkflowPreset, 'id' | 'templateStatus' | 'eventTypes' | 'riskLevel'>> = [
  { id: 'heritage-night', templateStatus: 'Approved', eventTypes: ['cultural'], riskLevel: 'Medium' },
  { id: 'wellness-run', templateStatus: 'Approved', eventTypes: ['sports'], riskLevel: 'Low' },
  { id: 'travel-expo', templateStatus: 'Approved', eventTypes: ['exhibition'], riskLevel: 'Low' },
  { id: 'arts-festival', templateStatus: 'Approved', eventTypes: ['festival'], riskLevel: 'Medium' },
  { id: 'flavours-carnival', templateStatus: 'Approved', eventTypes: ['fair'], riskLevel: 'High' },
  { id: 'tourism-forum', templateStatus: 'Approved', eventTypes: ['conference'], riskLevel: 'Low' },
  { id: 'community-harmony', templateStatus: 'Approved', eventTypes: ['religious'], riskLevel: 'Medium' },
  { id: 'merdeka-music', templateStatus: 'Rejected', eventTypes: ['concert'], riskLevel: 'High' },
  { id: 'river-lanterns', templateStatus: 'UnderReview', eventTypes: ['festival'], riskLevel: 'Medium' },
  { id: 'urban-parade', templateStatus: 'UnderReview', eventTypes: ['cultural'], riskLevel: 'High' },
];

function authoritiesFor(type: EventType): AuthorityType[] {
  const values: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL'];
  if (['festival', 'cultural', 'religious', 'exhibition'].includes(type)) values.push('MOTAC');
  return values;
}

function controlItemsFor(authorities: AuthorityType[]): ProposedControlItem[] {
  return authorities.map((authority) => ({
    controlName: CONTROL_NAMES[authority],
    authority,
    stageRequirement: 'stage1_and_stage2',
    stage1Requirements: STAGE1_REQUIREMENTS[authority],
    stage2Requirement: { kind: 'image', label: STAGE2_LABELS[authority] },
  }));
}

function buildPreset(template: Pick<FixedWorkflowPreset, 'id' | 'templateStatus' | 'eventTypes' | 'riskLevel'>): FixedWorkflowPreset {
  const type = template.eventTypes[0];
  const authorities = authoritiesFor(type);
  const rejected = template.templateStatus === 'Rejected';
  return {
    ...template,
    requiredAuthorities: authorities,
    initialDecision: rejected ? 'Rejected' : 'Approved',
    authorityDecision: rejected ? 'Rejected' : 'Approved',
    finalDecision: rejected ? 'Rejected' : 'Approved',
    reason: rejected
      ? 'The fixed safety review found that the current risk controls require correction before approval.'
      : 'The fixed safety review confirms the submitted application and required review materials.',
    suggestion: rejected
      ? 'Provide the missing safety evidence and update the risk controls before resubmitting.'
      : 'Complete each authority requirement and keep the approved evidence available for publication.',
    ...(rejected ? { rejectionReasonCategory: 'risk_controls_inadequate' as const } : {}),
    controls: controlItemsFor(authorities),
  };
}

export const FIXED_WORKFLOW_PRESETS: readonly FixedWorkflowPreset[] = APPROVED_TEMPLATES.map(buildPreset);

function statusRank(status: EventStatus): number {
  return status === 'Approved' ? 0 : status === 'UnderReview' ? 1 : 2;
}

/** Select once using type/risk, with Approved templates taking precedence. */
export function selectFixedWorkflowPreset(eventType: EventType, riskLevel: RiskLevel = 'Medium'): FixedWorkflowPreset {
  const exact = FIXED_WORKFLOW_PRESETS
    .filter((preset) => preset.eventTypes.includes(eventType) && preset.riskLevel === riskLevel)
    .sort((a, b) => statusRank(a.templateStatus) - statusRank(b.templateStatus) || a.id.localeCompare(b.id));
  const byType = FIXED_WORKFLOW_PRESETS
    .filter((preset) => preset.eventTypes.includes(eventType))
    .sort((a, b) => statusRank(a.templateStatus) - statusRank(b.templateStatus) || a.id.localeCompare(b.id));
  const approved = FIXED_WORKFLOW_PRESETS
    .filter((preset) => preset.templateStatus === 'Approved')
    .sort((a, b) => a.id.localeCompare(b.id));
  return exact[0] ?? byType[0] ?? approved[0] ?? FIXED_WORKFLOW_PRESETS[0];
}

export function riskLevelFromAssessment(value: unknown): RiskLevel {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  const provisional = record?.provisionalResult && typeof record.provisionalResult === 'object'
    ? record.provisionalResult as Record<string, unknown> : undefined;
  const official = record?.officialResult && typeof record.officialResult === 'object'
    ? record.officialResult as Record<string, unknown> : undefined;
  const candidate = record?.overallRiskLevel ?? official?.overallRiskLevel ?? provisional?.overallRiskLevel;
  return candidate === 'Low' || candidate === 'High' ? candidate : 'Medium';
}

type FixedPresetEventInput = Pick<EventRecord, 'fixedWorkflowPreset'> & {
  eventDetails: Pick<EventRecord['eventDetails'], 'type'>;
};

export function selectionForEvent(event: FixedPresetEventInput, riskLevel: RiskLevel, now = Date.now()): FixedWorkflowPresetSelection {
  if (event.fixedWorkflowPreset?.version === FIXED_WORKFLOW_PRESET_VERSION) return event.fixedWorkflowPreset as FixedWorkflowPresetSelection;
  const preset = selectFixedWorkflowPreset(event.eventDetails.type, riskLevel);
  return {
    version: FIXED_WORKFLOW_PRESET_VERSION,
    presetId: preset.id,
    templateStatus: preset.templateStatus,
    matchedEventType: event.eventDetails.type,
    matchedRiskLevel: riskLevel,
    selectedAt: now,
  };
}

export function presetFromSelection(selection?: FixedWorkflowPresetSelection): FixedWorkflowPreset | undefined {
  if (!selection || selection.version !== FIXED_WORKFLOW_PRESET_VERSION) return undefined;
  return FIXED_WORKFLOW_PRESETS.find((preset) => preset.id === selection.presetId);
}

export function fixedPresetForEvent(event: FixedPresetEventInput, riskLevel: RiskLevel): { preset: FixedWorkflowPreset; selection: FixedWorkflowPresetSelection } {
  const selection = selectionForEvent(event, riskLevel);
  const preset = presetFromSelection(selection) ?? selectFixedWorkflowPreset(event.eventDetails.type, riskLevel);
  return { preset, selection };
}
