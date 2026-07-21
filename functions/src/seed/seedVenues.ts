import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, EventType, Incident, Venue } from '@shared/types';

const app = initializeApp({
  credential: applicationDefault(),
  projectId: process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? 'linkos-496505',
});

const VENUES: Omit<Venue, 'venueId'>[] = [
  { name: 'Axiata Arena', address: 'Bukit Jalil, Kuala Lumpur', capacity: 16_000, location: { lat: 3.057, lng: 101.691 }, riskNotes: 'Indoor arena, multiple exits' },
  { name: 'Dataran Merdeka', address: 'Kuala Lumpur City Centre', capacity: 50_000, location: { lat: 3.148, lng: 101.694 }, riskNotes: 'Open field with limited shade' },
  { name: 'KLCC Park', address: 'KLCC, Kuala Lumpur', capacity: 30_000, location: { lat: 3.157, lng: 101.711 }, riskNotes: 'Urban park near major roads' },
  { name: 'Dataran Putrajaya', address: 'Presint 1, Putrajaya', capacity: 40_000, location: { lat: 2.943, lng: 101.69 }, riskNotes: 'Wide open plaza' },
  { name: 'Penang Esplanade', address: 'George Town, Penang', capacity: 20_000, location: { lat: 5.424, lng: 100.328 }, riskNotes: 'Coastal and weather exposed' },
  { name: 'Persada Johor', address: 'Johor Bahru, Johor', capacity: 15_000, location: { lat: 1.465, lng: 103.756 } },
  { name: 'MAEPS Serdang', address: 'Serdang, Selangor', capacity: 25_000, location: { lat: 2.998, lng: 101.704 }, riskNotes: 'Convention and expo grounds' },
  { name: 'Sunway Lagoon', address: 'Bandar Sunway, Selangor', capacity: 12_000, location: { lat: 3.071, lng: 101.605 } },
  { name: 'National Stadium Bukit Jalil', address: 'Bukit Jalil, Kuala Lumpur', capacity: 87_411, location: { lat: 3.054, lng: 101.692 }, riskNotes: 'Large stadium with controlled access' },
  { name: 'Padang Ipoh', address: 'Ipoh, Perak', capacity: 20_000, location: { lat: 4.595, lng: 101.083 } },
  { name: 'MITEC', address: 'Segambut, Kuala Lumpur', capacity: 20_000, location: { lat: 3.18, lng: 101.665 }, riskNotes: 'Large indoor exhibition venue' },
  { name: 'Kuala Lumpur Convention Centre', address: 'KLCC, Kuala Lumpur', capacity: 8_000, location: { lat: 3.153, lng: 101.713 } },
  { name: 'Setia SPICE Arena', address: 'Bayan Lepas, Penang', capacity: 10_000, location: { lat: 5.329, lng: 100.28 } },
  { name: 'Stadium Darul Makmur', address: 'Kuantan, Pahang', capacity: 40_000, location: { lat: 3.808, lng: 103.324 } },
  { name: 'Stadium Hang Jebat', address: 'Krubong, Melaka', capacity: 40_000, location: { lat: 2.309, lng: 102.239 } },
  { name: 'Sabah International Convention Centre', address: 'Kota Kinabalu, Sabah', capacity: 5_000, location: { lat: 5.99, lng: 116.078 } },
  { name: 'Borneo Convention Centre Kuching', address: 'Kuching, Sarawak', capacity: 5_000, location: { lat: 1.561, lng: 110.401 } },
  { name: 'Stadium Sultan Mizan Zainal Abidin', address: 'Kuala Nerus, Terengganu', capacity: 50_000, location: { lat: 5.383, lng: 103.104 } },
  { name: 'Dataran Bandaraya Johor Bahru', address: 'Johor Bahru, Johor', capacity: 15_000, location: { lat: 1.464, lng: 103.75 }, riskNotes: 'Open civic square' },
  { name: 'Langkawi International Convention Centre', address: 'Langkawi, Kedah', capacity: 3_000, location: { lat: 6.303, lng: 99.722 } },
  { name: 'Stadium Tuanku Abdul Rahman', address: 'Paroi, Negeri Sembilan', capacity: 45_000, location: { lat: 2.716, lng: 101.943 }, riskNotes: 'Large open stadium with regional road access' },
  { name: 'Kompleks Sukan Negara Shah Alam', address: 'Shah Alam, Selangor', capacity: 15_000, location: { lat: 3.082, lng: 101.544 } },
  { name: 'Dewan Jubli Perak', address: 'Kangar, Perlis', capacity: 2_500, location: { lat: 6.441, lng: 100.199 } },
  { name: 'Sultan Muhammad IV Stadium', address: 'Kota Bharu, Kelantan', capacity: 22_000, location: { lat: 6.126, lng: 102.239 }, riskNotes: 'Urban stadium with constrained surrounding roads' },
  { name: 'Labuan International Sea Sports Complex', address: 'Labuan Federal Territory', capacity: 5_000, location: { lat: 5.277, lng: 115.242 }, riskNotes: 'Coastal outdoor venue exposed to marine weather' },
];

const INCIDENT_TYPES = ['medical_emergency', 'crowd_surge', 'weather_evacuation', 'fire_alarm', 'lost_child', 'heat_exhaustion', 'slip_fall'];
const EVENT_TYPES: EventType[] = ['concert', 'festival', 'sports', 'cultural', 'religious', 'exhibition', 'fair', 'conference'];
const SEVERITIES = ['low', 'low', 'low', 'medium', 'medium', 'high'] as const;

function stableVenueId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function generateIncidents(venueId: string, venueName: string, venueIndex: number): Omit<Incident, 'incidentId'>[] {
  const count = (venueIndex * 7 + 3) % 13;
  return Array.from({ length: count }, (_, index) => {
    const incidentType = INCIDENT_TYPES[(venueIndex + index * 3) % INCIDENT_TYPES.length];
    const eventType = EVENT_TYPES[(venueIndex * 2 + index) % EVENT_TYPES.length];
    return {
      venueId,
      eventType,
      incidentType,
      severity: SEVERITIES[(venueIndex + index) % SEVERITIES.length],
      date: Date.UTC(2024 + ((venueIndex + index) % 2), (venueIndex * 3 + index) % 12, 1 + ((index * 5) % 27)),
      description: `${incidentType} during ${eventType} event at ${venueName}`,
    };
  });
}

async function seed(): Promise<void> {
  const db = getFirestore(app);
  for (const [venueIndex, value] of VENUES.entries()) {
    const venueId = stableVenueId(value.name);
    const incidents = generateIncidents(venueId, value.name, venueIndex);
    const venue: Venue = { ...value, venueId, incidentCount: incidents.length };
    await db.collection(COLLECTIONS.VENUES).doc(venueId).set(venue);
    for (const [index, incident] of incidents.entries()) {
      await db.collection(COLLECTIONS.INCIDENTS).doc(`${venueId}-${String(index + 1).padStart(2, '0')}`).set(incident);
    }
    console.log(`[seed] ${venue.name}: ${incidents.length} incidents`);
  }
  console.log(`[seed] Done. ${VENUES.length} stable venues seeded.`);
}

seed().catch((error) => {
  console.error('[seed] failed:', error);
  process.exit(1);
});
