import {
  M1EventCategory,
  M1TemplateSelection,
  M1VenueSetting,
  M1_TEMPLATE_REGISTRY_VERSION,
} from '@shared/types';
import { isValidM1TemplateSelection } from '@shared/m1TemplateContract';
import { m1EvidenceRequirementsFor } from '@shared/m1EvidenceContract';

export interface SupportingDocumentGuidance {
  id: string;
  title: string;
  condition: string;
  requirement: 'always' | 'conditional';
}

export interface M1TemplateDefinition {
  templateId: string;
  version: string;
  title: string;
  kind: 'core' | 'scenario';
  eventCategory?: M1EventCategory;
  venueSetting?: M1VenueSetting;
  sourcePath: string;
  fileName: string;
  previewFileName: string;
  sha256: string;
  pageCount: number;
  supportingDocuments: SupportingDocumentGuidance[];
}

export const M1_EVENT_CATEGORIES: ReadonlyArray<{
  value: M1EventCategory;
  label: string;
  shortLabel: string;
  examples: string[];
  risks: string[];
}> = [
  {
    value: 'entertainment_performance',
    label: 'Entertainment and Performance Event',
    shortLabel: 'Entertainment & performance',
    examples: ['Concert', 'Theatre', 'Live performance', 'Fashion show'],
    risks: ['Crowd congestion', 'Stage safety', 'Sound and electrical systems', 'Security'],
  },
  {
    value: 'sports_recreational',
    label: 'Sports and Recreational Event',
    shortLabel: 'Sports & recreation',
    examples: ['Fun run', 'Marathon', 'Cycling event', 'Tournament'],
    risks: ['Participant injuries', 'Route safety', 'Traffic control', 'Medical support'],
  },
  {
    value: 'cultural_heritage_festival',
    label: 'Cultural, Heritage and Festival Event',
    shortLabel: 'Culture, heritage & festival',
    examples: ['Cultural festival', 'Heritage celebration', 'Festive event', 'Public parade'],
    risks: ['Crowd control', 'Food safety', 'Temporary stalls', 'Fire and cultural sensitivities'],
  },
  {
    value: 'exhibition_convention_promotional',
    label: 'Exhibition, Convention and Promotional Event',
    shortLabel: 'Exhibition & convention',
    examples: ['Tourism expo', 'Trade exhibition', 'Convention', 'Roadshow'],
    risks: ['Venue capacity', 'Booth safety', 'Emergency exits', 'Electrical installations'],
  },
  {
    value: 'carnival_public_celebration',
    label: 'Carnival and Public Celebration',
    shortLabel: 'Carnival & celebration',
    examples: ['Food carnival', 'Tourism carnival', 'Funfair', 'Public countdown'],
    risks: ['Rides', 'Temporary structures', 'Food hygiene', 'Crowd density', 'Fire and security'],
  },
];

export const M1_VENUE_SETTINGS: ReadonlyArray<{
  value: M1VenueSetting;
  label: string;
  examples: string;
  description: string;
}> = [
  {
    value: 'indoor',
    label: 'Indoor',
    examples: 'Hall, convention centre, enclosed stadium',
    description: 'The event remains primarily inside an enclosed building or venue.',
  },
  {
    value: 'outdoor_fixed_site',
    label: 'Outdoor fixed-site',
    examples: 'Park, field, open-air stadium',
    description: 'The event stays at one defined outdoor site for its operating period.',
  },
  {
    value: 'outdoor_route_based',
    label: 'Outdoor route-based',
    examples: 'Fun run, marathon, parade, cycling event',
    description: 'Participants, performers or event units move along a planned route.',
  },
];

const CORE_DOCUMENTS: SupportingDocumentGuidance[] = [
  ['DOC-A01', 'Venue permission letter'],
  ['DOC-A02', 'Site or layout plan'],
  ['DOC-A03', 'Location map and current photographs'],
  ['DOC-B01', 'Organiser identification'],
  ['DOC-B02', 'Organisation registration document'],
  ['DOC-C01', 'Event programme or schedule'],
  ['DOC-C02', 'Supplier and contractor list'],
  ['DOC-D01', 'Safety and operational plan'],
  ['DOC-D02', 'Emergency and evacuation plan'],
].map(([id, title]) => ({ id, title, condition: 'Required for every event application.', requirement: 'always' }));

function conditionalDocuments(prefix: string, items: Array<[string, string]>): SupportingDocumentGuidance[] {
  return items.map(([title, condition], index) => ({
    id: `${prefix}-DOC-${String(index + 1).padStart(2, '0')}`,
    title,
    condition,
    requirement: 'conditional',
  }));
}

export const M1_CORE_TEMPLATE: M1TemplateDefinition = {
  templateId: 'STERAS-CORE',
  version: '1.0',
  title: 'Core Event Application Template',
  kind: 'core',
  sourcePath: 'core/Core Event Application Template.docx',
  fileName: 'Core Event Application Template.docx',
  previewFileName: 'Core Event Application Template.pdf',
  sha256: '6c88b1bd7e4f8a97256c4c0a4f5043cd30639f20035691e35424eacafbbd2913',
  pageCount: 9,
  supportingDocuments: CORE_DOCUMENTS,
};

export const M1_SCENARIO_TEMPLATES: readonly M1TemplateDefinition[] = [
  scenario('STERAS-T01-ENT-IN-v2.0', '2.0', 'entertainment_performance', 'indoor', 'Entertainment and Performance Event - Indoor', 'entertainment-performance/Entertainment and Performance Event - Indoor.docx', '9eaaf66ac0bbbdb6f4aae05f3e4dfca12103567608790a4c7c0494ebc9f705c1', 9, conditionalDocuments('T01', [
    ['Foreign performer evidence', 'When foreign performers participate and applicable approval is required.'],
    ['Pyrotechnics or special-effects evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Indoor capacity and fire-safety evidence', 'For large or high-crowd indoor events, or when requested by an authority.'],
    ['Temporary structure evidence', 'When temporary stages, platforms or structures are used.'],
    ['Food and beverage vendor evidence', 'When food or beverage vendors are involved.'],
    ['Alcohol sale or service approval', 'When alcohol will be sold or served.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
    ['Ticketing evidence', 'When the Core application identifies the event as ticketed.'],
  ])),
  scenario('STERAS-T02-ENT-OF-v1.0', '1.0', 'entertainment_performance', 'outdoor_fixed_site', 'Entertainment and Performance Event - Outdoor Fixed-Site', 'entertainment-performance/Entertainment and Performance Event - Outdoor Fixed-Site.docx', 'ae990b31f2a60df25d8efd8e465dcc90ede85d2f11bfb5e64306d7f106e707f7', 8, conditionalDocuments('T02', [
    ['Foreign performer evidence', 'When foreign performers participate and applicable approval is required.'],
    ['Temporary structure evidence', 'When canopies, stages or temporary structures are used.'],
    ['Pyrotechnics or special-effects evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Food and beverage vendor evidence', 'When food or beverage vendors are involved.'],
    ['Alcohol sale or service approval', 'When alcohol will be sold or served.'],
    ['Road closure or traffic evidence', 'When a public road or route is affected.'],
    ['Government land or park permission', 'When government land, a park or protected site is used.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
    ['Ticketing evidence', 'When the Core application identifies the event as ticketed.'],
  ])),
  scenario('STERAS-T03-ENT-OR-v1.0', '1.0', 'entertainment_performance', 'outdoor_route_based', 'Entertainment and Performance Event - Outdoor Route-Based', 'entertainment-performance/Entertainment and Performance Event - Outdoor Route-Based.docx', '4a33b8ad4ca3efd816dc4406b26bfdb815fcbf991f99c3d538e75a3619a2fd92', 8, conditionalDocuments('T03', [
    ['Route-based event evidence', 'Always required for this route-based scenario.'],
    ['Public road or road-closure evidence', 'When public roads are used or closed.'],
    ['Foreign performer evidence', 'When foreign performers participate.'],
    ['Temporary or mobile structure evidence', 'When floats, route stops or start/finish areas use temporary structures.'],
    ['Pyrotechnics or special-effects evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['Ticketing evidence', 'When the event is ticketed.'],
    ['Government or public-site permission', 'When government land, parks or public sites are used.'],
    ['High-risk or large-scale evidence', 'When classified high-risk/large-scale or requested by an authority.'],
    ['Other authority evidence', 'When a reviewing Malaysian authority requests additional technical evidence.'],
  ])),
  scenario('STERAS-T04-SPT-IN-v1.0', '1.0', 'sports_recreational', 'indoor', 'Sports and Recreational Event - Indoor', 'sports-recreational/Sports and Recreational Event - Indoor.docx', '6f4d3556426ac44878117d056b4961f7abb1148448704c096ad7f68b321c4556', 7, conditionalDocuments('T04', [
    ['Indoor capacity and fire-safety evidence', 'For large or high-crowd indoor events, or when requested by an authority.'],
    ['Temporary structure evidence', 'When temporary structures are used.'],
    ['Water-based activity evidence', 'When a water-based activity is included.'],
    ['Food and beverage vendor evidence', 'When food or beverage vendors are involved.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T05-SPT-OF-v1.0', '1.0', 'sports_recreational', 'outdoor_fixed_site', 'Sports and Recreational Event - Outdoor Fixed-Site', 'sports-recreational/Sports and Recreational Event - Outdoor Fixed-Site.docx', '7724c3f33a296daab1e1d8c4b80a7e6c5b888412c5b5fc17cac2fbd7ea9b29f3', 7, conditionalDocuments('T05', [
    ['Temporary structure evidence', 'When temporary structures are used.'],
    ['Site or access authority evidence', 'When road restrictions, government land, parks or protected sites are involved.'],
    ['Water-based activity evidence', 'When a water-based activity is included.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T06-SPT-OR-v1.0', '1.0', 'sports_recreational', 'outdoor_route_based', 'Sports and Recreational Event - Outdoor Route-Based', 'sports-recreational/Sports and Recreational Event - Outdoor Route-Based.docx', 'f323e68da5ec871e8d946673e9f95f95eebd1020755e92c7490151cc3d72125d', 7, conditionalDocuments('T06', [
    ['Route, checkpoint and traffic evidence', 'Always required for this route-based scenario.'],
    ['Participant tracking and route medical evidence', 'Required to demonstrate route accountability and distributed medical support.'],
    ['Temporary structure or public-site evidence', 'When temporary structures or public/government sites are used.'],
    ['High-risk or specialised route evidence', 'When classified high-risk, specialised or requested by an authority.'],
  ])),
  scenario('STERAS-T07-CUL-IN-v1.0', '1.0', 'cultural_heritage_festival', 'indoor', 'Cultural, Heritage and Festival Event - Indoor', 'cultural-heritage-festival/Cultural, Heritage and Festival Event - Indoor.docx', '28b0a89369428af725f20b1b7f490a087f84a3ae21b689c3dd41ee1f502ca73e', 6, conditionalDocuments('T07', [
    ['Food and beverage vendor evidence', 'When food or beverage vendors are involved.'],
    ['Temporary structure evidence', 'When temporary structures are used.'],
    ['Foreign performer or cultural-group evidence', 'When applicable foreign participants require approval.'],
    ['Pyrotechnics or special-effect evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Indoor capacity and fire-safety evidence', 'For large or high-crowd indoor events, or when requested by an authority.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T08-CUL-OF-v1.0', '1.0', 'cultural_heritage_festival', 'outdoor_fixed_site', 'Cultural, Heritage and Festival Event - Outdoor Fixed-Site', 'cultural-heritage-festival/Cultural, Heritage and Festival Event - Outdoor Fixed-Site.docx', '2b955b4c53da28b51d7a27dd4801027eeb464d7020f0451afca475e096edc9a5', 7, conditionalDocuments('T08', [
    ['Food and beverage vendor evidence', 'When food or beverage vendors are involved.'],
    ['Temporary structure evidence', 'When temporary structures are used.'],
    ['Foreign performer or cultural-group evidence', 'When applicable foreign participants require approval.'],
    ['Pyrotechnics or special-effect evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Road or traffic evidence', 'When public roads or traffic are affected.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['Government, park or protected-site permission', 'When public, heritage or protected land is used.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T09-CUL-OR-v1.0', '1.0', 'cultural_heritage_festival', 'outdoor_route_based', 'Cultural, Heritage and Festival Event - Outdoor Route-Based', 'cultural-heritage-festival/Cultural, Heritage and Festival Event - Outdoor Route-Based.docx', '6a0094771b5bb02742b1ca2bcaff48c17d71420e46710cee6305e0e023d79aba', 7, conditionalDocuments('T09', [
    ['Route, checkpoint and traffic evidence', 'Always required for this route-based scenario.'],
    ['Float or procession-vehicle evidence', 'When floats or procession vehicles are used.'],
    ['Foreign performer or cultural-group evidence', 'When applicable foreign participants require approval.'],
    ['Pyrotechnics or special-effect evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Temporary structure evidence', 'When temporary structures are used.'],
    ['Government, park, heritage or protected-site permission', 'When public, heritage or protected land is used.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T10-EXP-IN-v1.0', '1.0', 'exhibition_convention_promotional', 'indoor', 'Exhibition, Convention and Promotional Event - Indoor', 'exhibition-convention-promotional/Exhibition, Convention and Promotional Event - Indoor.docx', '58f6009ed330f09d9d3069414a784d388b69ad13a9bc1317020506b86420c8c5', 8, conditionalDocuments('T10', [
    ['Temporary structure or booth evidence', 'When custom, large or non-standard booths and structures are used.'],
    ['Indoor capacity and fire-safety evidence', 'For large or high-crowd indoor events, or when requested by an authority.'],
    ['Food and beverage vendor evidence', 'When food or beverage vendors are involved.'],
    ['Ticketing evidence', 'When the Core application identifies the event as ticketed.'],
    ['Alcohol sale or service evidence', 'When alcohol will be sold or served.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T11-EXP-OF-v1.0', '1.0', 'exhibition_convention_promotional', 'outdoor_fixed_site', 'Exhibition, Convention and Promotional Event - Outdoor Fixed-Site', 'exhibition-convention-promotional/Exhibition, Convention and Promotional Event - Outdoor Fixed-Site.docx', '9ab3b627808796f407e9d0495f92ac909eba6626de83527977c003397ade1c2d', 8, conditionalDocuments('T11', [
    ['Temporary structure or booth evidence', 'When tents, canopies, custom or non-standard structures are used.'],
    ['Road or traffic evidence', 'When a public road, parking lane or vehicle-access area is restricted.'],
    ['Food and beverage vendor evidence', 'When food or beverage vendors are involved.'],
    ['Pyrotechnics or special-effects evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['Public or government-site permission', 'When public, government or protected land is used.'],
    ['Ticketing evidence', 'When the Core application identifies the event as ticketed.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T12-EXP-OR-v1.0', '1.0', 'exhibition_convention_promotional', 'outdoor_route_based', 'Exhibition, Convention and Promotional Event - Outdoor Route-Based', 'exhibition-convention-promotional/Exhibition, Convention and Promotional Event - Outdoor Route-Based.docx', 'd6d7630e054873dc44378a46f351293b2f52b8d95f61d501689a08a1654f8f89', 8, conditionalDocuments('T12', [
    ['Route, stop and traffic evidence', 'Always required for this route-based scenario.'],
    ['Mobile-unit or vehicle evidence', 'When exhibition vehicles, trailers or mobile stages are used.'],
    ['Temporary structure evidence', 'When deployable structures requiring approval are used.'],
    ['Food and beverage vendor evidence', 'When food or beverage vendors are involved.'],
    ['Pyrotechnics or special-effects evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Public, government or protected-site permission', 'When public or protected route stops are used.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['Ticketing evidence', 'When any route stop or viewing zone is ticketed.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T13-CAR-IN-v1.0', '1.0', 'carnival_public_celebration', 'indoor', 'Carnival and Public Celebration - Indoor', 'carnival-public-celebration/Carnival and Public Celebration - Indoor.docx', 'f0701d5291874162ef24afbf670edb5e8d91c8267e693e102d2e49298845a7a0', 7, conditionalDocuments('T13', [
    ['Amusement ride evidence', 'When amusement rides or attractions are included.'],
    ['Food and beverage vendor evidence', 'When food vendors or on-site preparation are involved.'],
    ['Temporary structure evidence', 'When temporary structures are used.'],
    ['Pyrotechnics or special-effect evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Indoor capacity and fire-safety evidence', 'For large or high-crowd indoor events, or when requested by an authority.'],
    ['Ticketing or entertainment-duty evidence', 'When the event or specific attractions are ticketed.'],
    ['Alcohol sale evidence', 'When alcohol will be sold.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T14-CAR-OF-v1.0', '1.0', 'carnival_public_celebration', 'outdoor_fixed_site', 'Carnival and Public Celebration - Outdoor Fixed-Site', 'carnival-public-celebration/Carnival and Public Celebration - Outdoor Fixed-Site.docx', '5e0f61161ea56892cb42f4b959dc98bbc8d84ea7d21d218a1a885fdcb29bbbe3', 8, conditionalDocuments('T14', [
    ['Amusement ride evidence', 'When amusement rides or attractions are included.'],
    ['Food and beverage vendor evidence', 'When food vendors or on-site preparation are involved.'],
    ['Temporary structure evidence', 'When temporary structures are used.'],
    ['Pyrotechnics or special-effect evidence', 'When fireworks, pyrotechnics or flame effects are used.'],
    ['Traffic or road-control evidence', 'When public-road or traffic-management controls are needed.'],
    ['Public-site permission evidence', 'When public, government or protected land is used.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['Alcohol sale evidence', 'When alcohol will be sold.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
  scenario('STERAS-T15-CAR-OR-v1.0', '1.0', 'carnival_public_celebration', 'outdoor_route_based', 'Carnival and Public Celebration - Outdoor Route-Based', 'carnival-public-celebration/Carnival and Public Celebration - Outdoor Route-Based.docx', '85ce394c424bba4d2c9ecf920ae27123b9a5b0224da446d709263f069b3dbd18', 8, conditionalDocuments('T15', [
    ['Route, checkpoint and traffic evidence', 'Always required for this route-based scenario.'],
    ['Float or carnival-vehicle evidence', 'When floats, trailers or other major moving units are used.'],
    ['Amusement or mobile-attraction evidence', 'When mobile attractions or amusement equipment are included.'],
    ['Food and beverage vendor evidence', 'When food or beverage vendors are involved.'],
    ['Temporary structure evidence', 'When temporary structures are used.'],
    ['Fireworks or pyrotechnics evidence', 'When fireworks or pyrotechnics are used.'],
    ['Government, park or protected-site permission', 'When public or protected sites are used.'],
    ['Drone operation evidence', 'When a drone operation is planned.'],
    ['High-risk or large-scale event evidence', 'When classified high-risk/large-scale or requested by an authority.'],
  ])),
];

export function scenarioTemplateFor(eventCategory: M1EventCategory, venueSetting: M1VenueSetting): M1TemplateDefinition {
  const result = M1_SCENARIO_TEMPLATES.find((template) => template.eventCategory === eventCategory && template.venueSetting === venueSetting);
  if (!result) throw new Error('The selected category and venue setting do not have a registered template.');
  return result;
}

export function templateDownloadUrl(template: M1TemplateDefinition): string {
  return `/templates/m1/downloads/${encodeURIComponent(template.fileName)}`;
}

export function templatePreviewUrl(template: M1TemplateDefinition): string {
  return `/templates/m1/previews/${encodeURIComponent(template.previewFileName)}`;
}

export function createTemplateSelection(eventCategory: M1EventCategory, venueSetting: M1VenueSetting, selectedAt = Date.now()): M1TemplateSelection {
  const scenario = scenarioTemplateFor(eventCategory, venueSetting);
  return {
    eventCategory,
    venueSetting,
    coreTemplateId: 'STERAS-CORE',
    scenarioTemplateId: scenario.templateId,
    templateRegistryVersion: M1_TEMPLATE_REGISTRY_VERSION,
    selectedAt,
  };
}

export function isValidTemplateSelection(value: unknown): value is M1TemplateSelection {
  return isValidM1TemplateSelection(value);
}

function scenario(
  templateId: string,
  version: string,
  eventCategory: M1EventCategory,
  venueSetting: M1VenueSetting,
  title: string,
  sourcePath: string,
  sha256: string,
  pageCount: number,
  supportingDocuments: SupportingDocumentGuidance[],
): M1TemplateDefinition {
  const fileName = sourcePath.split('/').at(-1) ?? `${title}.docx`;
  const canonicalRequirements = new Map(
    m1EvidenceRequirementsFor(templateId)
      .filter((definition) => definition.source === 'scenario')
      .map((definition) => [definition.id, definition]),
  );
  return {
    templateId,
    version,
    title,
    kind: 'scenario',
    eventCategory,
    venueSetting,
    sourcePath,
    fileName,
    previewFileName: fileName.replace(/\.docx$/i, '.pdf'),
    sha256,
    pageCount,
    supportingDocuments: supportingDocuments.map((document) => ({
      ...document,
      requirement: canonicalRequirements.get(document.id)?.requirement ?? document.requirement,
    })),
  };
}
