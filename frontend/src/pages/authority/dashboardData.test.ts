import { describe, expect, it } from 'vitest';
import { EventRecord, RiskAssessment, RiskLevel } from '@shared/types';
import { DashboardRecord, dashboardSummary, riskDistribution, sortReviewPriority } from './dashboardData';

function record(id: string, status: EventRecord['status'], risk?: RiskLevel, updatedAt = 1): DashboardRecord {
  const event: EventRecord = {
    eventId: id,
    organizerId: 'organizer',
    status,
    currentVersionNumber: 1,
    draftDocumentPaths: [],
    requiredAuthorities: ['PDRM'],
    createdAt: 1,
    updatedAt,
    eventDetails: {
      name: id,
      type: 'festival',
      venueName: 'Venue',
      venueAddress: 'Kuala Lumpur',
      venueCapacity: 1000,
      expectedAttendance: 500,
      environment: 'outdoor',
      coverage: 'uncovered',
      seating: 'standing',
      startDatetime: 10,
      endDatetime: 20,
      emergencyPlanSummary: 'Plan',
      organizerName: 'Organizer',
      organizerEmail: 'organizer@example.com',
      organizerPhone: '+601',
    },
  };
  const assessment = risk ? { finalRiskLevel: risk } as RiskAssessment : undefined;
  return { event, assessment };
}

describe('dashboardData', () => {
  const records = [
    record('medium amendment', 'AmendmentRequested', 'Medium', 4),
    record('high pending', 'Pending', 'High', 2),
    record('low review', 'UnderReview', 'Low', 8),
    record('approved', 'Approved', 'Low', 10),
    record('pending assessment', 'Pending', undefined, 12),
  ];

  it('summarizes assigned authority work from live records', () => {
    expect(dashboardSummary(records)).toMatchObject({ total: 5, active: 4, pending: 2, amendments: 1, approved: 1, highRisk: 1, unassessed: 1, resolved: 1 });
    expect(riskDistribution(records)).toEqual({ Low: 2, Medium: 1, High: 1, Unassessed: 1 });
  });

  it('orders active work by final risk before workflow status', () => {
    expect(sortReviewPriority(records).map(({ event }) => event.eventId)).toEqual([
      'high pending',
      'medium amendment',
      'pending assessment',
      'low review',
    ]);
  });
});
