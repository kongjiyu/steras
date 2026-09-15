import type { Assignment, AuthorityDecision, AuthorityType, DecisionValue, EventRecord } from '@shared/types';

const AUTHORITIES: AuthorityType[] = ['PDRM', 'BOMBA', 'KKM', 'DBKL', 'MOTAC'];

export interface AdminOfficerDecisionRow {
  id: string;
  authorityType: AuthorityType;
  decision: DecisionValue;
  rationale: string;
  suggestion?: string;
  decidedAt?: number;
  source: 'second_review' | 'assignment' | 'legacy';
}

export function adminOfficerDecisionRows(
  event: EventRecord,
  assignments: Assignment[],
  legacyDecisions: AuthorityDecision[],
): AdminOfficerDecisionRow[] {
  const secondReviewRows = (event.secondReview?.officerFeedback ?? [])
    .filter((feedback) => isAuthority(feedback.authorityType)
      && isDecision(feedback.decision)
      && typeof feedback.reason === 'string' && feedback.reason.trim().length > 0)
    .map((feedback) => ({
      id: `second-review-${feedback.authorityType}`,
      authorityType: feedback.authorityType,
      decision: feedback.decision,
      rationale: feedback.reason.trim(),
      ...(typeof feedback.suggestion === 'string' && feedback.suggestion.trim()
        ? { suggestion: feedback.suggestion.trim() }
        : {}),
      ...(typeof feedback.decidedAt === 'number' && Number.isFinite(feedback.decidedAt)
        ? { decidedAt: feedback.decidedAt }
        : {}),
      source: 'second_review' as const,
    }));
  if (secondReviewRows.length > 0) return orderedUniqueRows(secondReviewRows, event.requiredAuthorities);

  const assignmentRows = assignments
    .filter((assignment) => assignment.versionId === event.currentVersionId
      && assignment.status === 'completed'
      && isAuthority(assignment.authorityType)
      && isDecision(assignment.decision)
      && typeof assignment.reason === 'string' && assignment.reason.trim().length > 0)
    .map((assignment) => ({
      id: assignment.assignmentId,
      authorityType: assignment.authorityType,
      decision: assignment.decision as DecisionValue,
      rationale: assignment.reason!.trim(),
      ...(typeof assignment.suggestion === 'string' && assignment.suggestion.trim()
        ? { suggestion: assignment.suggestion.trim() }
        : {}),
      ...(typeof assignment.decidedAt === 'number' && Number.isFinite(assignment.decidedAt)
        ? { decidedAt: assignment.decidedAt }
        : {}),
      source: 'assignment' as const,
    }));
  if (assignmentRows.length > 0) return orderedUniqueRows(assignmentRows, event.requiredAuthorities);

  const legacyRows = legacyDecisions
    .filter((decision) => decision.versionId === event.currentVersionId
      && decision.current === true
      && isAuthority(decision.authorityType)
      && isDecision(decision.decision)
      && typeof decision.rationale === 'string' && decision.rationale.trim().length > 0)
    .map((decision) => ({
      id: decision.decisionId,
      authorityType: decision.authorityType,
      decision: decision.decision,
      rationale: decision.rationale.trim(),
      ...(typeof decision.suggestion === 'string' && decision.suggestion.trim()
        ? { suggestion: decision.suggestion.trim() }
        : {}),
      ...(typeof decision.decidedAt === 'number' && Number.isFinite(decision.decidedAt)
        ? { decidedAt: decision.decidedAt }
        : {}),
      source: 'legacy' as const,
    }));
  return orderedUniqueRows(legacyRows, event.requiredAuthorities);
}

function orderedUniqueRows(rows: AdminOfficerDecisionRow[], requiredAuthorities: AuthorityType[]): AdminOfficerDecisionRow[] {
  const latestByAuthority = new Map<AuthorityType, AdminOfficerDecisionRow>();
  for (const row of rows) {
    const existing = latestByAuthority.get(row.authorityType);
    if (!existing || (row.decidedAt ?? 0) >= (existing.decidedAt ?? 0)) latestByAuthority.set(row.authorityType, row);
  }
  const order = [...requiredAuthorities, ...AUTHORITIES.filter((authority) => !requiredAuthorities.includes(authority))];
  return [...latestByAuthority.values()].sort(
    (left, right) => order.indexOf(left.authorityType) - order.indexOf(right.authorityType),
  );
}

function isAuthority(value: unknown): value is AuthorityType {
  return AUTHORITIES.includes(value as AuthorityType);
}

function isDecision(value: unknown): value is DecisionValue {
  return value === 'Approved' || value === 'Rejected';
}
