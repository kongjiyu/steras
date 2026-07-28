/**
 * Mock data aligned with PRD §3 Module 1 / Module 2 fields.
 * Once Cloud Functions populate Firestore, swap these for live queries
 * (`useCollection` from react-firebase-hooks). Shape stays the same.
 */

export type ApplicationStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'amend';

export type RiskLevel = 'low' | 'medium' | 'high';

export type EventType =
  | 'Concert'
  | 'Cultural'
  | 'Sport'
  | 'Fair'
  | 'Religious'
  | 'Conference'
  | 'Festival';

export interface Application {
  id: string;
  eventName: string;
  eventType: EventType;
  organizerName: string;
  venueName: string;
  cityState: string;
  startDate: string;        // ISO date
  endDate: string;          // ISO date
  expectedAttendance: number;
  status: ApplicationStatus;
  riskLevel: RiskLevel;
  officialScore: number;    // 0-100 deterministic category-based result
  aiAdvisoryBand?: RiskLevel;
  submittedAt: string;      // ISO
  authorityType?: 'PDRM' | 'Bomba' | 'KKM' | 'DBKL' | 'MOTAC';
}

// Five Malaysian-themed sample events matching the design + PRD §1 narrative (Visit Malaysia 2026).
export const mockApplications: Application[] = [
  {
    id: 'app-001',
    eventName: 'KL Music Festival 2026',
    eventType: 'Concert',
    organizerName: 'LiveNation Malaysia',
    venueName: 'Bukit Jalil National Stadium',
    cityState: 'Bukit Jalil, KL',
    startDate: '2026-03-15',
    endDate: '2026-03-16',
    expectedAttendance: 35000,
    status: 'pending',
    riskLevel: 'high',
    officialScore: 72,
    aiAdvisoryBand: 'high',
    submittedAt: '2026-03-01T09:14:00Z',
    authorityType: 'PDRM',
  },
  {
    id: 'app-002',
    eventName: 'Penang Heritage Run',
    eventType: 'Sport',
    organizerName: 'Penang Running Assoc.',
    venueName: 'Esplanade',
    cityState: 'Georgetown, Penang',
    startDate: '2026-04-20',
    endDate: '2026-04-20',
    expectedAttendance: 5200,
    status: 'under_review',
    riskLevel: 'medium',
    officialScore: 50,
    aiAdvisoryBand: 'medium',
    submittedAt: '2026-03-22T11:02:00Z',
    authorityType: 'PDRM',
  },
  {
    id: 'app-003',
    eventName: 'Johor Food Fiesta',
    eventType: 'Festival',
    organizerName: 'Johor Tourism',
    venueName: 'Danga Bay',
    cityState: 'Danga Bay, Johor',
    startDate: '2026-05-10',
    endDate: '2026-05-12',
    expectedAttendance: 12000,
    status: 'approved',
    riskLevel: 'low',
    officialScore: 28,
    aiAdvisoryBand: 'low',
    submittedAt: '2026-02-12T07:45:00Z',
    authorityType: 'DBKL',
  },
  {
    id: 'app-004',
    eventName: 'Sabah Cultural Night',
    eventType: 'Cultural',
    organizerName: 'Sabah Cultural Board',
    venueName: 'Kota Kinabalu Waterfront',
    cityState: 'Kota Kinabalu, Sabah',
    startDate: '2026-06-05',
    endDate: '2026-06-05',
    expectedAttendance: 8500,
    status: 'pending',
    riskLevel: 'high',
    officialScore: 70,
    aiAdvisoryBand: 'high',
    submittedAt: '2026-04-18T14:30:00Z',
    authorityType: 'Bomba',
  },
  {
    id: 'app-005',
    eventName: 'Perak River Carnival',
    eventType: 'Fair',
    organizerName: 'Perak Tourism',
    venueName: 'Kampar Old Town',
    cityState: 'Ipoh, Perak',
    startDate: '2026-07-18',
    endDate: '2026-07-19',
    expectedAttendance: 6200,
    status: 'rejected',
    riskLevel: 'high',
    officialScore: 75,
    aiAdvisoryBand: 'high',
    submittedAt: '2026-04-02T08:00:00Z',
    authorityType: 'Bomba',
  },
  {
    id: 'app-006',
    eventName: 'Kuching Rainforest World',
    eventType: 'Concert',
    organizerName: 'Sarawak Events',
    venueName: 'Sarawak Cultural Village',
    cityState: 'Kuching, Sarawak',
    startDate: '2026-08-08',
    endDate: '2026-08-10',
    expectedAttendance: 18000,
    status: 'pending',
    riskLevel: 'medium',
    officialScore: 52,
    aiAdvisoryBand: 'medium',
    submittedAt: '2026-05-15T10:20:00Z',
    authorityType: 'PDRM',
  },
  {
    id: 'app-007',
    eventName: 'Malaysia Day Open House',
    eventType: 'Festival',
    organizerName: 'MOTAC',
    venueName: 'Dataran Merdeka',
    cityState: 'KL',
    startDate: '2026-09-16',
    endDate: '2026-09-16',
    expectedAttendance: 25000,
    status: 'pending',
    riskLevel: 'medium',
    officialScore: 54,
    aiAdvisoryBand: 'medium',
    submittedAt: '2026-06-22T09:00:00Z',
    authorityType: 'MOTAC',
  },
  {
    id: 'app-008',
    eventName: 'Langkawi International Maritime',
    eventType: 'Fair',
    organizerName: 'Langkawi Dev. Authority',
    venueName: 'Langkawi Jetty',
    cityState: 'Langkawi, Kedah',
    startDate: '2026-10-12',
    endDate: '2026-10-15',
    expectedAttendance: 9100,
    status: 'amend',
    riskLevel: 'medium',
    officialScore: 45,
    aiAdvisoryBand: 'medium',
    submittedAt: '2026-05-30T16:00:00Z',
    authorityType: 'Bomba',
  },
];

// Aggregate KPI rollups derived from the application list.
export const mockKpis = (apps: Application[]) => {
  const total = apps.length;
  const pending = apps.filter((a) => a.status === 'pending').length;
  const underReview = apps.filter((a) => a.status === 'under_review').length;
  const approved = apps.filter((a) => a.status === 'approved').length;
  const rejected = apps.filter((a) => a.status === 'rejected').length;
  const highRisk = apps.filter((a) => a.riskLevel === 'high').length;
  const mediumRisk = apps.filter((a) => a.riskLevel === 'medium').length;
  const lowRisk = apps.filter((a) => a.riskLevel === 'low').length;

  return {
    total,
    pending,
    underReview,
    approved,
    rejected,
    highRisk,
    mediumRisk,
    lowRisk,
  };
};
