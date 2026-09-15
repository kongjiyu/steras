import { describe, expect, it } from 'vitest';
import { ASSESSMENT_SCHEMA_VERSION, Assignment, AuthorityDecision, AuthorityReviewState, EventRecord, RiskAssessment } from '@shared/types';
import { deriveAdminWorkflow, deriveAuthorityProgress, friendlyAdminStatus } from './adminApplicationPresentation';

const baseEvent = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  eventId: 'event-1', organizerId: 'org-1', status: 'UnderReview',
  eventDetails: {} as EventRecord['eventDetails'], currentVersionNumber: 1,
  draftDocumentPaths: [], requiredAuthorities: ['PDRM', 'BOMBA'],
  submittedAt: 10, currentVersionId: 'v1', createdAt: 1, updatedAt: 1, ...overrides,
} as EventRecord);

const provisionalAssessment = (heads?: AuthorityReviewState): RiskAssessment => ({
  assessmentId: 'a1', eventId: 'event-1', versionId: 'v1', status: 'authority_review',
  schemaVersion: ASSESSMENT_SCHEMA_VERSION, contextSnapshot: {} as never, evidence: [], contextEvidence: [],
  sourceTimestamps: {}, contextStatuses: {}, assessmentReadiness: 'complete', complianceStatus: 'pass',
  complianceChecks: [], dataConfidenceScore: 100, dataConfidenceLevel: 'high', inputHash: 'hash', createdAt: 1,
  aiProposal: {} as never, warnings: [], authorityReviewRequired: true, provisionalResult: {} as never,
  authorityReviewState: heads,
} as unknown as RiskAssessment);

describe('admin application presentation', () => {
  it('uses friendly status labels', () => {
    expect(friendlyAdminStatus('UnderReview')).toBe('Under Review');
  });

  it('derives all five stages and skips authority work after an early rejection', () => {
    const event = baseEvent({
      status: 'Rejected',
      reviewStage: 'closed',
      initialReview: { decision: 'Rejected', reason: 'Missing evidence', reviewerUid: 'admin', reviewedAt: 20 },
    });
    const workflow = deriveAdminWorkflow(event, null, null, []);
    expect(workflow.steps.map((step) => step.label)).toEqual(['Submitted', 'M2 Assessment', 'Initial Review', 'Authority Review', 'Final Decision']);
    expect(workflow.steps[2].state).toBe('rejected');
    expect(workflow.steps[3].state).toBe('skipped');
    expect(workflow.steps[4].state).toBe('rejected');
  });

  it('reports score heads and current-version assignments, with legacy decisions as fallback', () => {
    const assessment = provisionalAssessment({
      requiredAuthorities: ['PDRM', 'BOMBA'],
      activeReviewHeads: { PDRM: { reviewId: 'r1', createdAt: 1 } },
      conflicts: [], updatedAt: 1,
    });
    const assignments: Assignment[] = [{
      assignmentId: 'v1_BOMBA', eventId: 'event-1', versionId: 'v1', authorityType: 'BOMBA', officerUid: 'o1', assignedBy: 'admin', assignedAt: 1, status: 'completed', decision: 'Approved', reason: 'ok', decidedAt: 2,
    }];
    const legacyDecision: AuthorityDecision = {
      decisionId: 'v1_PDRM', eventId: 'event-1', versionId: 'v1', authorityType: 'PDRM', decision: 'Rejected', rationale: 'reason', reviewerId: 'o2', decidedAt: 2, current: true,
    };
    expect(deriveAuthorityProgress(baseEvent(), assessment, assignments, [legacyDecision])).toEqual([
      { authority: 'PDRM', scoreStatus: 'pending', decisionStatus: 'rejected', assignmentStatus: 'not_assigned' },
      { authority: 'BOMBA', scoreStatus: 'record_missing', decisionStatus: 'approved', assignmentStatus: 'completed' },
    ]);
  });

  it('does not present pre-assignment score heads as authority reviews', () => {
    const assessment = provisionalAssessment({
      requiredAuthorities: ['PDRM', 'BOMBA'],
      activeReviewHeads: { PDRM: { reviewId: 'r1', createdAt: 1 }, BOMBA: { reviewId: 'r2', createdAt: 1 } },
      conflicts: [], updatedAt: 1,
    });
    expect(deriveAuthorityProgress(baseEvent(), assessment, [])).toEqual([
      { authority: 'PDRM', scoreStatus: 'pending', decisionStatus: 'pending', assignmentStatus: 'not_assigned' },
      { authority: 'BOMBA', scoreStatus: 'pending', decisionStatus: 'pending', assignmentStatus: 'not_assigned' },
    ]);
  });

  it('keeps Initial Review pending while a manual assessment is still required', () => {
    const workflow = deriveAdminWorkflow(baseEvent({ status: 'Manual Review Required', reviewStage: 'manual' }), {
      ...provisionalAssessment(), status: 'manual_review_required', assessmentReadiness: 'insufficient_data', aiProposal: null,
    } as unknown as RiskAssessment, null, []);
    expect(workflow.steps[1].state).toBe('active');
    expect(workflow.steps[2].state).toBe('pending');
  });

  it('keeps Initial Review pending while M2 is still processing', () => {
    const workflow = deriveAdminWorkflow(baseEvent({ status: 'Pending', reviewStage: 'initial' }), null, null, []);
    expect(workflow.steps[1].state).toBe('active');
    expect(workflow.steps[2].state).toBe('pending');
  });

  it('marks manual-official score rows as Admin assessed and missing final review records explicitly', () => {
    const assessment = {
      ...provisionalAssessment(), status: 'official_ready', sourceKind: 'admin_manual', authorityReviewRequired: false,
    } as unknown as RiskAssessment;
    const assignments: Assignment[] = [
      { assignmentId: 'v1_PDRM', eventId: 'event-1', versionId: 'v1', authorityType: 'PDRM', officerUid: 'o1', assignedBy: 'admin', assignedAt: 1, status: 'completed', decision: 'Approved', reason: 'approved', decidedAt: 2 },
      { assignmentId: 'v1_BOMBA', eventId: 'event-1', versionId: 'v1', authorityType: 'BOMBA', officerUid: 'o2', assignedBy: 'admin', assignedAt: 1, status: 'completed', decision: 'Approved', reason: 'approved', decidedAt: 2 },
    ];
    expect(deriveAuthorityProgress({ currentVersionId: 'v1', requiredAuthorities: ['PDRM', 'BOMBA'] }, assessment, assignments).map((row) => row.scoreStatus)).toEqual(['manual_official', 'manual_official']);
    expect(deriveAuthorityProgress({ currentVersionId: 'v1', requiredAuthorities: ['PDRM', 'BOMBA'] }, provisionalAssessment(), assignments).map((row) => row.scoreStatus)).toEqual(['record_missing', 'record_missing']);
  });
});
