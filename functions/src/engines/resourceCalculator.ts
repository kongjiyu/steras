import { createHash } from 'node:crypto';
import {
  AISuccessfulProposal,
  CalculatedAssessmentResult,
  DeterministicCategoryResult,
  EventDetails,
  HARD_RULE_VERSION,
  PROVISIONAL_FORMULA_VERSION,
  ProvisionalAssessmentResult,
  ManualOfficialAssessmentResult,
  MANUAL_OFFICIAL_FORMULA_VERSION,
  RESOURCE_KEYS,
  RESOURCE_SCHEMA_VERSION,
  ResourceAppliedRule,
  ResourceAssumption,
  ResourceInputReference,
  ResourceKey,
  ResourceRecommendationItem,
  ResourceSourceSnapshot,
  RiskLevel,
  ScoreRating,
  hirarcRiskLevelFor,
  riskLevelFor,
} from '@shared/types';
import {
  ACTIVE_RESOURCE_CONFIG,
  RESOURCE_SOURCE_REGISTRY,
  ResourceRecommendationConfig,
} from '../config/resourceRecommendationConfig';
import { ACTIVE_CATEGORY_SCHEMA } from '../config/categorySchema';
import { evaluateCategoryHardRules } from './hardRuleEvaluator';
import { canonicalHazardId, isCanonicalEvidenceReferenceList } from './proposalContract';

export interface ResourceCalculationInput<T extends CalculatedAssessmentResult = ProvisionalAssessmentResult> {
  eventId: string;
  versionId: string;
  assessmentId: string;
  eventDetails: EventDetails;
  assessmentResult: T;
}

export type ResourceCalculationFailureCode =
  | 'missing_input'
  | 'invalid_input'
  | 'unsafe_calculation'
  | 'incomplete_provenance';

export type ResourceCalculationResult =
  | {
      ok: true;
      resourceInputHash: string;
      formulaVersion: string;
      configVersion: string;
      sourceRegistryVersion: string;
      items: Record<ResourceKey, ResourceRecommendationItem>;
    }
  | {
      ok: false;
      code: ResourceCalculationFailureCode;
      message: string;
    };

class ResourceCalculationFault extends Error {
  constructor(readonly code: ResourceCalculationFailureCode, message: string) {
    super(message);
  }
}

/** Deterministic provisional calculation; callers add revision and timestamps. */
export function computeResources<T extends CalculatedAssessmentResult>(
  input: ResourceCalculationInput<T>,
  config: ResourceRecommendationConfig = ACTIVE_RESOURCE_CONFIG,
): ResourceCalculationResult {
  try {
    validateInput(input, config);
    const source = numericSource(config);
    const categoryLevels = categoryRiskLevels(input.assessmentResult, config.assessmentCategoryIds);
    const items = Object.fromEntries(RESOURCE_KEYS.map((resource) => [
      resource,
      calculateItem(resource, input.eventDetails, input.assessmentResult.overallRiskLevel, categoryLevels, config, source),
    ])) as Record<ResourceKey, ResourceRecommendationItem>;
    validateCompleteItems(items);
    return {
      ok: true,
      resourceInputHash: resourceInputHash(input, config),
      formulaVersion: config.formulaVersion,
      configVersion: config.configVersion,
      sourceRegistryVersion: config.sourceRegistryVersion,
      items,
    };
  } catch (error) {
    if (error instanceof ResourceCalculationFault) return { ok: false, code: error.code, message: error.message };
    return {
      ok: false,
      code: 'unsafe_calculation',
      message: error instanceof Error ? error.message : 'Unknown resource calculation failure.',
    };
  }
}

function validateInput(input: ResourceCalculationInput<CalculatedAssessmentResult>, config: ResourceRecommendationConfig): void {
  for (const [field, value] of Object.entries({
    eventId: input.eventId,
    versionId: input.versionId,
    assessmentId: input.assessmentId,
  })) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new ResourceCalculationFault('missing_input', `${field} is required.`);
    }
  }
  if (!assessmentSourceId(input.assessmentResult)) {
    throw new ResourceCalculationFault('missing_input', 'Assessment source identity is required.');
  }
  const attendance = input.eventDetails?.expectedAttendance;
  if (attendance === undefined || attendance === null) {
    throw new ResourceCalculationFault('missing_input', 'expectedAttendance is required.');
  }
  if (!Number.isFinite(attendance) || !Number.isSafeInteger(attendance) || attendance <= 0) {
    throw new ResourceCalculationFault('invalid_input', 'expectedAttendance must be a positive safe integer.');
  }
  if (!(input.eventDetails.type in config.securityEventMultipliers)) {
    throw new ResourceCalculationFault('invalid_input', `Unsupported event type: ${String(input.eventDetails.type)}.`);
  }
  if (!['indoor', 'outdoor', 'mixed'].includes(input.eventDetails.environment)) {
    throw new ResourceCalculationFault('invalid_input', `Unsupported event environment: ${String(input.eventDetails.environment)}.`);
  }
  if (!isRiskLevel(input.assessmentResult.overallRiskLevel)) {
    throw new ResourceCalculationFault('invalid_input', 'Assessment overallRiskLevel is invalid.');
  }
  const assessmentErrors = validateCalculatedAssessmentResult(input.assessmentResult, config.assessmentCategoryIds);
  if (assessmentErrors.length > 0) {
    throw new ResourceCalculationFault('invalid_input', `Invalid provisional assessment result: ${assessmentErrors.join(', ')}.`);
  }
  const versions = [config.formulaVersion, config.configVersion, config.sourceRegistryVersion];
  if (versions.some((version) => typeof version !== 'string' || version.trim().length === 0)) {
    throw new ResourceCalculationFault('incomplete_provenance', 'Resource calculation versions are incomplete.');
  }
  if (!Number.isFinite(config.planningRangeMultiplier) || config.planningRangeMultiplier < 1) {
    throw new ResourceCalculationFault('invalid_input', 'Planning range multiplier must be finite and at least 1.');
  }
  for (const resource of RESOURCE_KEYS) {
    const baseline = config.baselines[resource];
    if (!baseline || !positiveFinite(baseline.divisor) || !nonNegativeSafeInteger(baseline.minimum)) {
      throw new ResourceCalculationFault('invalid_input', `Invalid baseline configuration for ${resource}.`);
    }
    if (!config.reviewingAuthorities[resource]) {
      throw new ResourceCalculationFault('incomplete_provenance', `Reviewing authority is missing for ${resource}.`);
    }
  }
  if (!positiveFinite(config.toiletSecondaryDivisor)) {
    throw new ResourceCalculationFault('invalid_input', 'Toilet secondary divisor must be positive and finite.');
  }
  for (const [eventType, multiplier] of Object.entries(config.securityEventMultipliers)) {
    if (!positiveFinite(multiplier)) {
      throw new ResourceCalculationFault('invalid_input', `Invalid security multiplier for ${eventType}.`);
    }
  }
  const modifierGroups: Array<Partial<Record<ResourceKey, number>>> = [
    config.highOverallModifiers,
    config.indoorModifiers,
    ...Object.values(config.highCategoryModifiers),
  ];
  for (const modifiers of modifierGroups) {
    for (const [resource, modifier] of Object.entries(modifiers)) {
      if (!nonNegativeSafeInteger(modifier)) {
        throw new ResourceCalculationFault('invalid_input', `Invalid resource modifier for ${resource}.`);
      }
    }
  }
}

function numericSource(config: ResourceRecommendationConfig): ResourceSourceSnapshot {
  const source = RESOURCE_SOURCE_REGISTRY[config.numericSourceId];
  if (!source || source.verificationStatus !== 'prototype_unverified' || source.kind !== 'internal_prototype') {
    throw new ResourceCalculationFault(
      'incomplete_provenance',
      'Numeric resource rules require an internal prototype_unverified source snapshot.',
    );
  }
  return { ...source };
}

function categoryRiskLevels(result: CalculatedAssessmentResult, expectedCategoryIds: readonly string[]): Map<string, RiskLevel> {
  if (!Array.isArray(result.categories)) {
    throw new ResourceCalculationFault('missing_input', 'Assessment categories are required.');
  }
  const levels = new Map<string, RiskLevel>();
  for (const category of result.categories) {
    if (levels.has(category.categoryId)) {
      throw new ResourceCalculationFault('invalid_input', `Duplicate assessment category: ${category.categoryId}.`);
    }
    if (!isRiskLevel(category.riskLevel)) {
      throw new ResourceCalculationFault('invalid_input', `Invalid risk level for category ${category.categoryId}.`);
    }
    levels.set(category.categoryId, category.riskLevel);
  }
  if (levels.size !== expectedCategoryIds.length) {
    throw new ResourceCalculationFault('missing_input', 'The complete validated assessment category set is required.');
  }
  for (const required of expectedCategoryIds) {
    if (!levels.has(required)) {
      throw new ResourceCalculationFault('missing_input', `Required assessment category is missing: ${required}.`);
    }
  }
  for (const categoryId of levels.keys()) {
    if (!expectedCategoryIds.includes(categoryId)) {
      throw new ResourceCalculationFault('invalid_input', `Unknown assessment category: ${categoryId}.`);
    }
  }
  return levels;
}

export function validateCalculatedAssessmentResult(
  result: CalculatedAssessmentResult,
  expectedCategoryIds: readonly string[] = ACTIVE_RESOURCE_CONFIG.assessmentCategoryIds,
): string[] {
  return isManualOfficialResult(result)
    ? validateManualOfficialAssessmentResult(result, expectedCategoryIds)
    : validateProvisionalAssessmentResult(result, expectedCategoryIds);
}

export function validateManualOfficialAssessmentResult(
  result: ManualOfficialAssessmentResult,
  expectedCategoryIds: readonly string[] = ACTIVE_RESOURCE_CONFIG.assessmentCategoryIds,
): string[] {
  const errors: string[] = [];
  const evidenceKeys = new Set(['weather', 'crowd', 'venue', 'history', 'holiday', 'public_health', 'sanitation', 'medical', 'security', 'transport', 'compliance']);
  if (!result || typeof result !== 'object' || result.sourceKind !== 'admin_manual') return ['source-kind'];
  if (typeof result.manualAssessmentId !== 'string' || !result.manualAssessmentId.trim()) errors.push('manual-assessment-id');
  if (result.formulaVersion !== MANUAL_OFFICIAL_FORMULA_VERSION) errors.push('formula-version');
  if (result.hardRuleVersion !== HARD_RULE_VERSION) errors.push('hard-rule-version');
  if (result.categorySchemaVersion !== ACTIVE_CATEGORY_SCHEMA.version) errors.push('category-schema-version');
  if (!Array.isArray(result.manualHazards) || result.manualHazards.length < 1 || result.manualHazards.length > 40) errors.push('manual-hazards');
  const hazardIds = new Set<string>();
  if (Array.isArray(result.manualHazards)) for (const hazard of result.manualHazards) {
    if (!hazard || typeof hazard !== 'object'
      || typeof hazard.hazardId !== 'string' || !hazard.hazardId.trim() || hazardIds.has(hazard.hazardId)
      || typeof hazard.hazardName !== 'string' || !hazard.hazardName.trim()
      || !expectedCategoryIds.includes(hazard.categoryId)
      || !Array.isArray(hazard.evidenceReferences)
      || new Set(hazard.evidenceReferences).size !== hazard.evidenceReferences.length
      || hazard.evidenceReferences.some((reference) => typeof reference !== 'string' || !evidenceKeys.has(reference))
      || typeof hazard.rationale !== 'string' || !hazard.rationale.trim()) errors.push('manual-hazard-shape');
    else hazardIds.add(hazard.hazardId);
  }
  if (!Array.isArray(result.categories)) return [...errors, 'categories'];
  const definitions = new Map(ACTIVE_CATEGORY_SCHEMA.categories.map((category) => [category.id, category]));
  const seen = new Set<string>();
  let weightedScore = 0;
  let highest: RiskLevel = 'Low';
  if (result.categories.length !== expectedCategoryIds.length) errors.push('category-count');
  for (const category of result.categories) {
    if (!isRuntimeRecord(category)) {
      errors.push('category-shape');
      continue;
    }
    const definition = definitions.get(category.categoryId);
    if (!definition || !expectedCategoryIds.includes(category.categoryId) || seen.has(category.categoryId)) {
      errors.push(`category-${category.categoryId || 'unknown'}`);
      continue;
    }
    seen.add(category.categoryId);
    const matrix = category.validatedLikelihood * category.validatedSeverity;
    const normalized = matrix * 4;
    if (!isScore(category.manualLikelihood) || !isScore(category.manualSeverity)
      || !isScore(category.validatedLikelihood) || !isScore(category.validatedSeverity)
      || category.validatedLikelihood < category.manualLikelihood
      || category.validatedSeverity < category.manualSeverity
      || category.categoryName !== definition.name
      || category.matrixScore !== matrix || category.normalizedScore !== normalized
      || category.weight !== definition.weight
      || category.weightedContribution !== round(normalized * definition.weight)
      || category.riskLevel !== hirarcRiskLevelFor(matrix)
      || !Array.isArray(category.evidenceReferences)
      || new Set(category.evidenceReferences).size !== category.evidenceReferences.length
      || category.evidenceReferences.some((reference) => typeof reference !== 'string' || !evidenceKeys.has(reference))
      || typeof category.rationale !== 'string' || !category.rationale.trim()
      || typeof category.missingInformation !== 'string'
      || (category.evidenceReferences.length === 0 && category.missingInformation.trim().length < 10)
      || !sameStringSet(category.guidelineChecks, definition.guidelineChecks)
      || validateAppliedHardRules(category as unknown as ProvisionalAssessmentResult['categories'][number], category.manualLikelihood, category.manualSeverity).length > 0) {
      errors.push(`calculation-${category.categoryId}`);
    }
    weightedScore += normalized * definition.weight;
    highest = higherRisk(highest, hirarcRiskLevelFor(matrix));
  }
  if (expectedCategoryIds.some((categoryId) => !seen.has(categoryId))) errors.push('missing-category');
  const overallScore = round(weightedScore);
  const weighted = riskLevelFor(overallScore);
  if (result.overallScore !== overallScore || result.weightedRiskLevel !== weighted
    || result.highestCategoryRiskLevel !== highest || result.overallRiskLevel !== higherRisk(weighted, highest)) errors.push('overall-calculation');
  if (!/^[a-f0-9]{64}$/.test(result.officialInputHash)) errors.push('official-input-hash');
  if (![result.calculatedAt, result.finalizedAt].every(Number.isFinite) || typeof result.finalizedBy !== 'string' || !result.finalizedBy) errors.push('finalization');
  return [...new Set(errors)];
}

function isManualOfficialResult(result: CalculatedAssessmentResult): result is ManualOfficialAssessmentResult {
  return isRuntimeRecord(result) && result.sourceKind === 'admin_manual';
}

function assessmentSourceId(result: CalculatedAssessmentResult): string | undefined {
  if (!isRuntimeRecord(result)) return undefined;
  return isManualOfficialResult(result) ? result.manualAssessmentId : result.proposalId;
}

function calculateItem(
  resource: ResourceKey,
  details: EventDetails,
  overallRisk: RiskLevel,
  categoryLevels: Map<string, RiskLevel>,
  config: ResourceRecommendationConfig,
  source: ResourceSourceSnapshot,
): ResourceRecommendationItem {
  const attendanceReference: ResourceInputReference = {
    inputId: 'event.expectedAttendance', kind: 'event_field', path: 'eventDetails.expectedAttendance', value: details.expectedAttendance,
  };
  const overallReference: ResourceInputReference = {
    inputId: 'assessment.overallRiskLevel',
    kind: 'assessment_overall',
    path: 'assessmentResult.overallRiskLevel',
    value: overallRisk,
  };
  const inputReferences: ResourceInputReference[] = [attendanceReference, overallReference];
  const appliedRules: ResourceAppliedRule[] = [];
  const baselineConfig = config.baselines[resource];
  let baseline: number;

  if (resource === 'security') {
    const eventTypeReference: ResourceInputReference = {
      inputId: 'event.type', kind: 'event_field', path: 'eventDetails.type', value: details.type,
    };
    inputReferences.push(eventTypeReference);
    const attendanceBase = safeCeil(details.expectedAttendance / baselineConfig.divisor, `${resource} attendance ratio`);
    const multiplier = config.securityEventMultipliers[details.type];
    baseline = Math.max(baselineConfig.minimum, safeCeil(attendanceBase * multiplier, `${resource} event type multiplier`));
    appliedRules.push(rule(
      'resource.security.attendance-event-type',
      `Ceiling of 1 per ${baselineConfig.divisor} attendees, multiplied by ${multiplier} for ${details.type}, with minimum ${baselineConfig.minimum}.`,
      [attendanceReference.inputId, eventTypeReference.inputId], source.sourceId, baseline,
    ));
  } else if (resource === 'toilets') {
    const primary = safeCeil(details.expectedAttendance / baselineConfig.divisor, 'toilets primary attendance ratio');
    const secondary = safeCeil(details.expectedAttendance / config.toiletSecondaryDivisor, 'toilets secondary attendance ratio');
    baseline = Math.max(baselineConfig.minimum, safeAdd(primary, secondary, 'toilets combined attendance ratios'));
    appliedRules.push(rule(
      'resource.toilets.combined-attendance',
      `Sum of ceilings at 1 per ${baselineConfig.divisor} and 1 per ${config.toiletSecondaryDivisor} attendees, with minimum ${baselineConfig.minimum}.`,
      [attendanceReference.inputId], source.sourceId, baseline,
    ));
  } else {
    const attendanceBase = safeCeil(details.expectedAttendance / baselineConfig.divisor, `${resource} attendance ratio`);
    baseline = Math.max(baselineConfig.minimum, attendanceBase);
    appliedRules.push(rule(
      `resource.${resource}.attendance`,
      `Ceiling of 1 per ${baselineConfig.divisor} attendees with minimum ${baselineConfig.minimum}.`,
      [attendanceReference.inputId], source.sourceId, baseline,
    ));
  }

  const overallModifier = config.highOverallModifiers[resource] ?? 0;
  if (overallModifier > 0) {
    if (overallRisk === 'High') {
      baseline = safeAdd(baseline, overallModifier, `${resource} overall risk modifier`);
      appliedRules.push(rule(
        `resource.${resource}.high-overall-risk`, 'Add the configured high overall risk uplift.',
        [overallReference.inputId], source.sourceId, overallModifier,
      ));
    }
  }

  for (const categoryId of ['crowd', 'weather_environment', 'venue_fire'] as const) {
    const modifier = config.highCategoryModifiers[categoryId]?.[resource] ?? 0;
    if (modifier <= 0) continue;
    const reference: ResourceInputReference = {
      inputId: `assessment.category.${categoryId}.riskLevel`,
      kind: 'assessment_category',
      path: `assessmentResult.categories.${categoryId}.riskLevel`,
      value: categoryLevels.get(categoryId) as RiskLevel,
    };
    inputReferences.push(reference);
    if (reference.value === 'High') {
      baseline = safeAdd(baseline, modifier, `${resource} ${categoryId} modifier`);
      appliedRules.push(rule(
        `resource.${resource}.high-${categoryId}`, `Add the configured uplift when ${categoryId} risk is High.`,
        [reference.inputId], source.sourceId, modifier,
      ));
    }
  }

  const indoorModifier = config.indoorModifiers[resource] ?? 0;
  if (indoorModifier > 0) {
    const reference: ResourceInputReference = {
      inputId: 'event.environment', kind: 'event_field', path: 'eventDetails.environment', value: details.environment,
    };
    inputReferences.push(reference);
    if (details.environment === 'indoor') {
      baseline = safeAdd(baseline, indoorModifier, `${resource} indoor modifier`);
      appliedRules.push(rule(
        `resource.${resource}.indoor`, 'Add the configured indoor-event uplift.',
        [reference.inputId], source.sourceId, indoorModifier,
      ));
    }
  }

  const planningMax = safeCeil(baseline * config.planningRangeMultiplier, `${resource} planning range`);
  appliedRules.push(rule(
    `resource.${resource}.planning-range`,
    `Apply the configured ${config.planningRangeMultiplier} planning-range multiplier to the calculated baseline.`,
    inputReferences.map((reference) => reference.inputId),
    source.sourceId,
    planningMax - baseline,
  ));
  const assumptions: ResourceAssumption[] = [{
    assumptionId: `resource.${resource}.prototype-baseline`,
    statement: 'This numeric baseline is an internal academic prototype, not an authority minimum.',
    sourceIds: [source.sourceId],
  }];
  return {
    status: 'ready',
    resource,
    baseline,
    planningRange: { min: baseline, max: planningMax },
    inputReferences,
    assumptions,
    appliedRules,
    sourceSnapshots: [{ ...source }],
    authoritySource: {
      status: 'not_supplied',
      reason: 'No verified authority-issued numeric resource ratio has been supplied for this prototype.',
    },
    confidence: 'prototype',
    reviewingAuthority: config.reviewingAuthorities[resource],
    authorityReviewRequired: true,
  };
}

export function validateProvisionalAssessmentResult(
  result: ProvisionalAssessmentResult,
  expectedCategoryIds: readonly string[] = ACTIVE_RESOURCE_CONFIG.assessmentCategoryIds,
): string[] {
  const errors: string[] = [];
  const evidenceKeys = new Set(['weather', 'crowd', 'venue', 'history', 'holiday', 'public_health', 'sanitation', 'medical', 'security', 'transport', 'compliance']);
  if (!result || typeof result !== 'object') return ['result'];
  if (typeof result.proposalId !== 'string' || !result.proposalId.trim()) errors.push('proposal-id');
  if (result.formulaVersion !== PROVISIONAL_FORMULA_VERSION) errors.push('formula-version');
  if (result.hardRuleVersion !== HARD_RULE_VERSION) errors.push('hard-rule-version');
  if (result.categorySchemaVersion !== ACTIVE_CATEGORY_SCHEMA.version) errors.push('category-schema-version');
  if (!Array.isArray(result.validatedHazards)) errors.push('validated-hazards');
  if (!Array.isArray(result.categories)) return [...errors, 'categories'];
  const validatedHazards = Array.isArray(result.validatedHazards) ? result.validatedHazards : [];

  const expected = new Map<string, number>(ACTIVE_CATEGORY_SCHEMA.categories.map((category) => [category.id, category.weight]));
  const expectedDefinitions = new Map<string, (typeof ACTIVE_CATEGORY_SCHEMA.categories)[number]>(
    ACTIVE_CATEGORY_SCHEMA.categories.map((category) => [category.id, category]),
  );
  const seen = new Set<string>();
  const hazardIds = new Set<string>();
  for (const hazard of validatedHazards) {
    const normalizedHazardId = typeof hazard?.hazardId === 'string' ? canonicalHazardId(hazard.hazardId) : '';
    if (!hazard || typeof hazard !== 'object'
      || typeof hazard.hazardId !== 'string' || !normalizedHazardId || hazardIds.has(normalizedHazardId)
      || typeof hazard.hazardName !== 'string' || !hazard.hazardName.trim()
      || !expected.has(hazard.categoryId)
      || !isCanonicalEvidenceReferenceList(hazard.evidenceReferences)
      || hazard.evidenceReferences.some((reference) => !evidenceKeys.has(reference))
      || typeof hazard.rationale !== 'string' || !hazard.rationale.trim()) {
      errors.push('validated-hazard-shape');
    } else {
      hazardIds.add(normalizedHazardId);
    }
  }
  let weightedScore = 0;
  let highest: RiskLevel = 'Low';
  if (result.categories.length !== expectedCategoryIds.length) errors.push('category-count');
  for (const rawCategory of result.categories as unknown[]) {
    if (!isRuntimeRecord(rawCategory)) { errors.push('category-shape'); continue; }
    const category = rawCategory as unknown as ProvisionalAssessmentResult['categories'][number];
    const weight = expected.get(category.categoryId);
    const definition = expectedDefinitions.get(category.categoryId);
    if (!expectedCategoryIds.includes(category.categoryId) || weight === undefined || seen.has(category.categoryId)) {
      errors.push(`category-${category.categoryId || 'unknown'}`);
      continue;
    }
    seen.add(category.categoryId);
    const authorityLikelihood = isScore((rawCategory as Record<string, unknown>).authorityLikelihood)
      ? (rawCategory as Record<string, unknown>).authorityLikelihood as ScoreRating
      : category.proposedLikelihood;
    const authoritySeverity = isScore((rawCategory as Record<string, unknown>).authoritySeverity)
      ? (rawCategory as Record<string, unknown>).authoritySeverity as ScoreRating
      : category.proposedSeverity;
    const matrix = category.validatedLikelihood * category.validatedSeverity;
    const normalized = matrix * 4;
    const hardRuleErrors = validateAppliedHardRules(category, authorityLikelihood, authoritySeverity);
    if (!isScore(category.proposedLikelihood) || !isScore(category.proposedSeverity)
      || !isScore(category.validatedLikelihood) || !isScore(category.validatedSeverity)
      || category.validatedLikelihood < authorityLikelihood
      || category.validatedSeverity < authoritySeverity
      || category.matrixScore !== matrix
      || category.normalizedScore !== normalized
      || category.weight !== weight
      || category.weightedContribution !== round(normalized * weight)
      || category.riskLevel !== hirarcRiskLevelFor(matrix)
      || typeof category.categoryName !== 'string' || category.categoryName !== definition?.name
      || !isCanonicalEvidenceReferenceList(category.evidenceReferences)
      || category.evidenceReferences.some((reference) => !evidenceKeys.has(reference))
      || typeof category.rationale !== 'string' || !category.rationale.trim()
      || !['low', 'medium', 'high'].includes(category.confidence)
      || !stringArray(category.concerns) || !stringArray(category.missingInformation)
      || !sameStringSet(category.guidelineChecks, definition?.guidelineChecks ?? [])
      || hardRuleErrors.length > 0) errors.push(`calculation-${category.categoryId}`);
    weightedScore += normalized * weight;
    highest = higherRisk(highest, hirarcRiskLevelFor(matrix));
  }
  if (expectedCategoryIds.some((categoryId) => !seen.has(categoryId))) errors.push('missing-category');
  const overallScore = round(weightedScore);
  const weightedRisk = riskLevelFor(overallScore);
  if (result.overallScore !== overallScore
    || result.weightedRiskLevel !== weightedRisk
    || result.highestCategoryRiskLevel !== highest
    || result.overallRiskLevel !== higherRisk(weightedRisk, highest)) errors.push('overall-calculation');
  if (!Number.isFinite(result.calculatedAt)) errors.push('calculated-at');
  return [...new Set(errors)];
}

export function validateAssessmentResultAgainstProposal(
  result: ProvisionalAssessmentResult,
  proposal: AISuccessfulProposal,
): string[] {
  const errors: string[] = [];
  if (!isRuntimeRecord(result) || !Array.isArray(result.categories)) return ['result-categories'];
  if (!isRuntimeRecord(proposal) || !Array.isArray(proposal.categories) || !Array.isArray(proposal.hazards)) return ['proposal-shape'];
  const proposedCategories = new Map(proposal.categories
    .filter(isRuntimeRecord)
    .map((category) => [category.categoryId, category]));
  if (proposedCategories.size !== ACTIVE_CATEGORY_SCHEMA.categories.length) errors.push('proposal-category-count');
  for (const rawCategory of result.categories) {
    if (!isRuntimeRecord(rawCategory) || typeof rawCategory.categoryId !== 'string') {
      errors.push('proposal-category-shape');
      continue;
    }
    const category = rawCategory as unknown as ProvisionalAssessmentResult['categories'][number];
    const proposed = proposedCategories.get(category.categoryId);
    if (!proposed
      || proposed.likelihood !== category.proposedLikelihood
      || proposed.severity !== category.proposedSeverity
      || proposed.rationale !== category.rationale
      || proposed.confidence !== category.confidence
      || stableStringify(proposed.concerns) !== stableStringify(category.concerns)
      || stableStringify(proposed.missingInformation) !== stableStringify(category.missingInformation)
      || category.evidenceReferences.some((reference) => !proposed.evidenceReferences.includes(reference))) {
      errors.push(`proposal-category-${category.categoryId}`);
    }
  }
  const proposedHazards = new Map(proposal.hazards
    .filter(isRuntimeRecord)
    .map((hazard) => [hazard.hazardId, hazard]));
  if (!Array.isArray(result.validatedHazards)) return [...new Set([...errors, 'result-hazards'])];
  for (const rawHazard of result.validatedHazards) {
    if (!isRuntimeRecord(rawHazard) || typeof rawHazard.hazardId !== 'string') {
      errors.push('proposal-hazard-shape');
      continue;
    }
    const hazard = rawHazard as unknown as ProvisionalAssessmentResult['validatedHazards'][number];
    const proposed = proposedHazards.get(hazard.hazardId);
    if (!proposed
      || proposed.hazardName !== hazard.hazardName
      || proposed.categoryId !== hazard.categoryId
      || proposed.rationale !== hazard.rationale
      || hazard.evidenceReferences.some((reference) => !proposed.evidenceReferences.includes(reference))) {
      errors.push(`proposal-hazard-${hazard.hazardId}`);
    }
  }
  return errors;
}

export function validateAssessmentResultAgainstHardRules(
  result: ProvisionalAssessmentResult,
  baseline: DeterministicCategoryResult,
): string[] {
  const errors: string[] = [];
  const constraints = new Map<string, ReturnType<typeof evaluateCategoryHardRules>[number]>(
    evaluateCategoryHardRules(baseline).map((constraint) => [constraint.categoryId, constraint]),
  );
  for (const category of result.categories) {
    const constraint = constraints.get(category.categoryId);
    if (!constraint) { errors.push(`hard-rule-${category.categoryId}`); continue; }
    for (const axis of ['likelihood', 'severity'] as const) {
      const official = category as typeof category & { authorityLikelihood?: ScoreRating; authoritySeverity?: ScoreRating };
      const proposed = axis === 'likelihood'
        ? official.authorityLikelihood ?? category.proposedLikelihood
        : official.authoritySeverity ?? category.proposedSeverity;
      const validated = axis === 'likelihood' ? category.validatedLikelihood : category.validatedSeverity;
      const floor = axis === 'likelihood' ? constraint.likelihoodFloor : constraint.severityFloor;
      const applied = category.appliedHardRules.filter((rule) => rule.axis === axis);
      if (validated !== Math.max(proposed, floor)) errors.push(`hard-rule-floor-${category.categoryId}-${axis}`);
      if (proposed < floor) {
        const expectedId = `${constraint.ruleId}.${axis}`;
        if (applied.length !== 1
          || applied[0].ruleId !== expectedId
          || applied[0].categoryId !== category.categoryId
          || applied[0].proposedValue !== proposed
          || applied[0].constrainedValue !== floor
          || applied[0].rationale !== `${constraint.rationale} The ${axis} floor is ${floor}.`
          || !sameStringSet(applied[0].guidelineReferences, constraint.guidelineReferences)) {
          errors.push(`hard-rule-record-${category.categoryId}-${axis}`);
        }
      } else if (applied.length !== 0) errors.push(`hard-rule-unexpected-${category.categoryId}-${axis}`);
    }
  }
  return errors;
}

function validateAppliedHardRules(
  category: ProvisionalAssessmentResult['categories'][number],
  baselineLikelihood = category.proposedLikelihood,
  baselineSeverity = category.proposedSeverity,
): string[] {
  if (!Array.isArray(category.appliedHardRules)) return ['hard-rules'];
  const errors: string[] = [];
  for (const axis of ['likelihood', 'severity'] as const) {
    const proposed = axis === 'likelihood' ? baselineLikelihood : baselineSeverity;
    const validated = axis === 'likelihood' ? category.validatedLikelihood : category.validatedSeverity;
    const rules = category.appliedHardRules.filter((rule) => rule?.axis === axis);
    if ((validated > proposed && rules.length !== 1) || (validated === proposed && rules.length !== 0)) errors.push(axis);
    for (const rule of rules) {
      if (typeof rule.ruleId !== 'string' || !rule.ruleId.trim()
        || rule.categoryId !== category.categoryId
        || rule.proposedValue !== proposed
        || rule.constrainedValue !== validated
        || typeof rule.rationale !== 'string' || !rule.rationale.trim()
        || !stringArray(rule.guidelineReferences) || rule.guidelineReferences.length === 0) errors.push(axis);
    }
  }
  if (category.appliedHardRules.some((rule) => !isRuntimeRecord(rule))) errors.push('shape');
  const validRules = category.appliedHardRules.filter(isRuntimeRecord);
  if (validRules.some((rule, index, rules) =>
    rules.findIndex((candidate) => candidate.ruleId === rule.ruleId) !== index)) errors.push('duplicate');
  return errors;
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function sameStringSet(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && new Set(value).size === value.length
    && new Set(expected).size === expected.length
    && value.every((entry) => typeof entry === 'string' && (expected as readonly string[]).includes(entry))
    && expected.every((entry) => value.includes(entry));
}

function rule(
  ruleId: string,
  description: string,
  inputReferenceIds: string[],
  sourceId: string,
  contribution: number,
): ResourceAppliedRule {
  return { ruleId, description, inputReferenceIds, sourceIds: [sourceId], contribution };
}

function validateCompleteItems(items: Record<ResourceKey, ResourceRecommendationItem>): void {
  const keys = Object.keys(items);
  if (keys.length !== RESOURCE_KEYS.length || RESOURCE_KEYS.some((key) => !items[key])) {
    throw new ResourceCalculationFault('incomplete_provenance', 'Exactly seven resource items are required.');
  }
  for (const resource of RESOURCE_KEYS) {
    const item = items[resource];
    if (item.resource !== resource
      || !nonNegativeSafeInteger(item.baseline)
      || !nonNegativeSafeInteger(item.planningRange.min)
      || !nonNegativeSafeInteger(item.planningRange.max)
      || item.planningRange.min !== item.baseline
      || item.planningRange.max < item.planningRange.min) {
      throw new ResourceCalculationFault('unsafe_calculation', `Unsafe result for ${resource}.`);
    }
    if (item.appliedRules.length === 0
      || item.inputReferences.length === 0
      || item.assumptions.length === 0
      || item.sourceSnapshots.length === 0
      || item.authoritySource.status !== 'not_supplied') {
      throw new ResourceCalculationFault('incomplete_provenance', `Incomplete provenance for ${resource}.`);
    }
  }
}

function resourceInputHash(input: ResourceCalculationInput<CalculatedAssessmentResult>, config: ResourceRecommendationConfig): string {
  const payload = {
    schemaVersion: RESOURCE_SCHEMA_VERSION,
    formulaVersion: config.formulaVersion,
    configVersion: config.configVersion,
    sourceRegistryVersion: config.sourceRegistryVersion,
    config,
    numericSource: RESOURCE_SOURCE_REGISTRY[config.numericSourceId],
    eventId: input.eventId,
    versionId: input.versionId,
    assessmentId: input.assessmentId,
    eventDetails: input.eventDetails,
    assessmentResult: input.assessmentResult,
  };
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Official resource records may add authority-owned validation metadata, but
 * the numeric recommendation and every calculator-owned provenance field must
 * remain identical to the deterministic calculation.
 */
export function matchesDeterministicResourceItems(
  actual: Record<ResourceKey, ResourceRecommendationItem>,
  expected: Record<ResourceKey, ResourceRecommendationItem>,
): boolean {
  if (!isRuntimeRecord(actual) || !isRuntimeRecord(expected)) return false;
  return RESOURCE_KEYS.every((resource) => {
    const actualItem = actual[resource];
    const expectedItem = expected[resource];
    if (!isRuntimeRecord(actualItem) || !isRuntimeRecord(expectedItem)
      || !Array.isArray(actualItem.assumptions) || !Array.isArray(expectedItem.assumptions)
      || !Array.isArray(actualItem.appliedRules) || !Array.isArray(expectedItem.appliedRules)
      || !Array.isArray(actualItem.sourceSnapshots) || !Array.isArray(expectedItem.sourceSnapshots)
      || !actualItem.assumptions.every(isRuntimeRecord) || !expectedItem.assumptions.every(isRuntimeRecord)
      || !actualItem.appliedRules.every(isRuntimeRecord) || !expectedItem.appliedRules.every(isRuntimeRecord)
      || !actualItem.sourceSnapshots.every(isRuntimeRecord) || !expectedItem.sourceSnapshots.every(isRuntimeRecord)
      || !isRuntimeRecord(actualItem.authoritySource)
      || !['not_supplied', 'supplied'].includes(String(actualItem.authoritySource.status))
      || (actualItem.authoritySource.status === 'supplied' && !isRuntimeRecord(actualItem.authoritySource.source))) return false;
    const expectedAssumptionIds = new Set(expectedItem.assumptions.map((assumption) => assumption.assumptionId));
    const expectedRuleIds = new Set(expectedItem.appliedRules.map((rule) => rule.ruleId));
    const expectedSourceIds = new Set(expectedItem.sourceSnapshots.map((source) => source.sourceId));
    const extraAssumptions = actualItem.assumptions.filter((assumption) => !expectedAssumptionIds.has(assumption.assumptionId));
    const extraRules = actualItem.appliedRules.filter((rule) => !expectedRuleIds.has(rule.ruleId));
    const extraSources = actualItem.sourceSnapshots.filter((source) => !expectedSourceIds.has(source.sourceId));
    const authoritySourceId = actualItem.authoritySource.status === 'supplied'
      && isRuntimeRecord(actualItem.authoritySource.source)
      ? actualItem.authoritySource.source.sourceId
      : undefined;
    const validAuthorityExtras = authoritySourceId
      ? extraSources.length === 1
        && extraSources[0].sourceId === authoritySourceId
        && stableStringify(extraSources[0]) === stableStringify(actualItem.authoritySource.status === 'supplied'
          && isRuntimeRecord(actualItem.authoritySource.source) ? actualItem.authoritySource.source : undefined)
        && [...extraAssumptions, ...extraRules].length > 0
        && extraAssumptions.every((assumption) => Array.isArray(assumption.sourceIds)
          && assumption.sourceIds.length === 1 && assumption.sourceIds[0] === authoritySourceId)
        && extraRules.every((rule) => rule.contribution === 0 && Array.isArray(rule.sourceIds)
          && rule.sourceIds.length === 1 && rule.sourceIds[0] === authoritySourceId)
      : extraSources.length === 0 && extraAssumptions.length === 0 && extraRules.length === 0;
    return validAuthorityExtras && stableStringify({
      resource: actualItem.resource,
      status: actualItem.status,
      baseline: actualItem.baseline,
      planningRange: actualItem.planningRange,
      inputReferences: actualItem.inputReferences,
      reviewingAuthority: actualItem.reviewingAuthority,
    }) === stableStringify({
      resource: expectedItem.resource,
      status: expectedItem.status,
      baseline: expectedItem.baseline,
      planningRange: expectedItem.planningRange,
      inputReferences: expectedItem.inputReferences,
      reviewingAuthority: expectedItem.reviewingAuthority,
    })
      && containsStableEntries(actualItem.assumptions, expectedItem.assumptions)
      && containsStableEntries(actualItem.sourceSnapshots, expectedItem.sourceSnapshots)
      && containsStableEntries(actualItem.appliedRules, expectedItem.appliedRules)
      && extraRules.every((rule) => rule.contribution === 0);
  });
}

function containsStableEntries(actual: unknown[], expected: unknown[]): boolean {
  return expected.every((entry) => actual.some((candidate) => stableStringify(candidate) === stableStringify(entry)));
}

function safeCeil(value: number, label: string): number {
  const result = Math.ceil(value);
  if (!nonNegativeSafeInteger(result)) {
    throw new ResourceCalculationFault('unsafe_calculation', `${label} produced an unsafe quantity.`);
  }
  return result;
}

function safeAdd(left: number, right: number, label: string): number {
  const result = left + right;
  if (!nonNegativeSafeInteger(result)) {
    throw new ResourceCalculationFault('unsafe_calculation', `${label} produced an unsafe quantity.`);
  }
  return result;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function nonNegativeSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === 'Low' || value === 'Medium' || value === 'High';
}

function isScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function higherRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  const order: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2 };
  return order[left] >= order[right] ? left : right;
}
