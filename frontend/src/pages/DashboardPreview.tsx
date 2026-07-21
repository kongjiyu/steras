/**
 * No-auth preview route for the Authority Dashboard.
 * Same layout and content as `/authority`, but uses a mock user
 * so designers / stakeholders can see the dashboard without Firebase auth.
 */
import AuthorityDashboard from './authority/AuthorityDashboard';
import AuthorityLayout from '../components/layout/AuthorityLayout';
import { EventRecord, EventStatus, RiskAssessment, RiskLevel } from '@shared/types';
import { DashboardRecord } from './authority/dashboardData';

const MOCK_USER = { name: 'Admin Officer', role: 'PDRM', initials: 'AO' };

const DAY = 86_400_000;
const now = Date.now();

function previewRecord(
  eventId: string,
  name: string,
  venueName: string,
  status: EventStatus,
  risk: RiskLevel | undefined,
  attendance: number,
  daysUntilEvent: number,
  updatedHoursAgo: number,
): DashboardRecord {
  const event: EventRecord = {
    eventId,
    organizerId: `preview-${eventId}`,
    status,
    currentVersionNumber: 1,
    currentAssessmentId: risk ? `assessment-${eventId}` : undefined,
    draftDocumentPaths: [],
    requiredAuthorities: ['PDRM', 'BOMBA'],
    createdAt: now - (updatedHoursAgo + 24) * 3_600_000,
    updatedAt: now - updatedHoursAgo * 3_600_000,
    submittedAt: now - (updatedHoursAgo + 12) * 3_600_000,
    eventDetails: {
      name,
      type: name.includes('Run') ? 'sports' : name.includes('Festival') ? 'festival' : 'cultural',
      venueName,
      venueAddress: 'Kuala Lumpur, Malaysia',
      venueCapacity: Math.ceil(attendance * 1.25),
      expectedAttendance: attendance,
      environment: 'outdoor',
      coverage: 'partially_covered',
      seating: 'mixed',
      startDatetime: now + daysUntilEvent * DAY,
      endDatetime: now + daysUntilEvent * DAY + 6 * 3_600_000,
      emergencyPlanSummary: 'Multi-agency safety and emergency response plan submitted.',
      organizerName: 'Preview organizer',
      organizerEmail: 'preview@steras.test',
      organizerPhone: '+60 3 0000 0000',
    },
  };
  const finalScore = risk === 'High' ? 82 : risk === 'Medium' ? 58 : 27;
  const assessment = risk ? {
    assessmentId: `assessment-${eventId}`,
    eventId,
    status: 'ready',
    finalRiskLevel: risk,
    finalScore,
  } as RiskAssessment : undefined;
  return { event, assessment };
}

const PREVIEW_RECORDS = [
  previewRecord('merdeka-festival', 'Merdeka Cultural Festival', 'Dataran Merdeka', 'Pending', 'High', 18_000, 21, 2),
  previewRecord('river-lights', 'River of Life Night Market', 'Masjid Jamek Precinct', 'AmendmentRequested', 'Medium', 7_500, 12, 5),
  previewRecord('heritage-run', 'KL Heritage Run 2026', 'Padang Merbok', 'UnderReview', 'Medium', 10_000, 32, 9),
  previewRecord('craft-week', 'Malaysian Craft Week', 'Kompleks Kraf Kuala Lumpur', 'Pending', undefined, 3_200, 45, 12),
  previewRecord('food-festival', 'Flavours of Malaysia Festival', 'Titiwangsa Lake Gardens', 'UnderReview', 'Low', 5_500, 54, 26),
  previewRecord('batik-showcase', 'Batik Design Showcase', 'Kuala Lumpur Convention Centre', 'Approved', 'Low', 2_400, 68, 48),
  previewRecord('city-countdown', 'Kuala Lumpur City Countdown', 'Bukit Bintang', 'Approved', 'High', 24_000, 170, 72),
  previewRecord('community-carnival', 'Community Tourism Carnival', 'Perdana Botanical Gardens', 'Rejected', 'Medium', 6_000, 80, 96),
];

export default function DashboardPreview() {
  return (
    <AuthorityLayout mockUser={MOCK_USER}>
      <AuthorityDashboard previewRecords={PREVIEW_RECORDS} />
    </AuthorityLayout>
  );
}
