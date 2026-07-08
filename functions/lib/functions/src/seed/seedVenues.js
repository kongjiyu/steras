"use strict";
/**
 * Seed script for synthetic venues + incidents dataset.
 *
 * Usage:
 *   cd functions && npm run build
 *   node lib/seed/seedVenues.js
 *
 * Or invoke via Firebase emulator:
 *   firebase emulators:start
 *
 * The dataset is the "synthetic historical incident data" the PRD §6 calls for.
 * Generated based on realistic distributions for a Malaysian tourism context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const firebase_admin_1 = require("firebase-admin");
const app_1 = require("firebase-admin/app");
const types_1 = require("@shared/types");
(0, app_1.initializeApp)();
const VENUES = [
    { name: 'Axiata Arena', address: 'Bukit Jalil, KL', capacity: 16000, location: { lat: 3.057, lng: 101.691 }, riskNotes: 'Indoor arena, multiple exits' },
    { name: 'Merdeka Square', address: 'KL City Centre', capacity: 50000, location: { lat: 3.148, lng: 101.694 }, riskNotes: 'Open field, no shade' },
    { name: 'KLCC Park', address: 'KLCC, KL', capacity: 30000, location: { lat: 3.157, lng: 101.711 }, riskNotes: 'Urban park, near hospital' },
    { name: 'Putrajaya Square', address: 'Presint 1, Putrajaya', capacity: 40000, location: { lat: 2.943, lng: 101.690 }, riskNotes: 'Wide open plaza' },
    { name: 'Penang Esplanade', address: 'Georgetown, Penang', capacity: 20000, location: { lat: 5.424, lng: 100.328 }, riskNotes: 'Coastal, weather-exposed' },
    { name: 'Johor Bahru Persada', address: 'Johor Bahru', capacity: 15000, location: { lat: 1.465, lng: 103.756 } },
    { name: 'MAEPS Serdang', address: 'Serdang, Selangor', capacity: 25000, location: { lat: 2.998, lng: 101.704 }, riskNotes: 'Convention + expo space' },
    { name: 'Sunway Lagoon', address: 'Subang Jaya', capacity: 12000, location: { lat: 3.071, lng: 101.605 } },
    { name: 'Stadium Bukit Jalil', address: 'Bukit Jalil, KL', capacity: 87411, location: { lat: 3.054, lng: 101.692 }, riskNotes: 'Stadium, controlled access' },
    { name: 'Padang Ipoh', address: 'Ipoh, Perak', capacity: 20000, location: { lat: 4.595, lng: 101.083 } },
    // Add more venues up to 20-30 per PRD §6.
];
const INCIDENT_TYPES = ['medical_emergency', 'crowd_surge', 'weather_evacuation', 'fire_alarm', 'lost_child', 'fainting', 'heat_exhaustion', 'slip_fall'];
const EVENT_TYPES = ['concert', 'festival', 'sports', 'cultural', 'religious', 'exhibition', 'fair', 'conference'];
function generateIncidents(venueId, venueName, count) {
    const incidents = [];
    const now = Date.now();
    for (let i = 0; i < count; i++) {
        const daysAgo = Math.floor(Math.random() * 365 * 2); // last 2 years
        const type = INCIDENT_TYPES[Math.floor(Math.random() * INCIDENT_TYPES.length)];
        const et = EVENT_TYPES[Math.floor(Math.random() * EVENT_TYPES.length)];
        const sev = ['low', 'low', 'low', 'medium', 'medium', 'high'][Math.floor(Math.random() * 6)];
        incidents.push({
            venueId, // using name as id for synthetic; production uses real venueId
            eventType: et,
            incidentType: type,
            severity: sev,
            date: now - daysAgo * 86400_000,
            description: `${type} during ${et} event at ${venueName}`,
        });
    }
    return incidents;
}
async function seed() {
    const db = (0, firebase_admin_1.firestore)();
    // 1. Seed venues.
    for (const v of VENUES) {
        const ref = db.collection(types_1.COLLECTIONS.VENUES).doc();
        const venue = { ...v, venueId: ref.id };
        await ref.set(venue);
        // eslint-disable-next-line no-console
        console.log(`[seed] Venue: ${venue.name} (${venue.venueId})`);
        // 2. Seed synthetic incidents for this venue (0-12 per venue, biased by type).
        const baseIncidents = Math.floor(Math.random() * 13); // 0-12
        const incidents = generateIncidents(venue.name, venue.name, baseIncidents);
        for (const inc of incidents) {
            await db.collection(types_1.COLLECTIONS.INCIDENTS).add(inc);
        }
        // eslint-disable-next-line no-console
        console.log(`[seed]   → ${incidents.length} incidents`);
    }
    // eslint-disable-next-line no-console
    console.log(`[seed] Done. ${VENUES.length} venues seeded.`);
}
seed().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[seed] failed:', err);
    process.exit(1);
});
//# sourceMappingURL=seedVenues.js.map