// Synthetic data for every demo. Nothing here describes a real person, plan,
// employer, provider or claim. Names, IDs, NPIs and phone numbers are invented.

export const TODAY = "2026-09-10";
export const PLAN_YEAR = 2026;

export const systems = {
  MEDICAL_CORE: "Medical benefits & claims core",
  DENTAL_ADMIN: "Dental administration system",
  VISION_PARTNER: "Vision vendor API",
  PBM: "Pharmacy benefit manager",
  SPENDING_ACCOUNTS: "FSA / HSA administrator",
  MEMBERSHIP: "Membership & eligibility",
  GROUP_ADMIN: "Employer group administration",
  BILLING: "Group billing",
  ACCUMULATORS: "Accumulator service",
  UTILIZATION_MGMT: "Utilization management (prior auth)",
  CARE_MGMT: "Care management programs",
  PROVIDER_DIRECTORY: "Provider directory",
  NETWORK_CONTRACTS: "Network contracting",
} as const;

export type SystemId = keyof typeof systems;

export const members = {
  W20419873: {
    memberId: "W20419873",
    name: "Dana Whitfield",
    dob: "1984-03-12",
    relationship: "Subscriber",
    groupId: "G-44812",
    planId: "PPO1500",
    coverageStart: "2024-01-01",
    coverageEnd: null as string | null,
    status: "Active",
    address: { line1: "1420 Linden Ave SE", city: "Cedar Rapids", state: "IA", zip: "52403" },
    phone: "319-555-0187",
    email: "dana.whitfield@example.com",
    pcp: { npi: "1932014487", name: "Dr. Elena Rausch", practice: "Cedar Rapids Family Medicine" },
    idCardLastIssued: "2026-01-04",
  },
  W20419874: {
    memberId: "W20419874",
    name: "Marcus Whitfield",
    dob: "1982-11-02",
    relationship: "Spouse",
    groupId: "G-44812",
    planId: "PPO1500",
    coverageStart: "2024-01-01",
    coverageEnd: null as string | null,
    status: "Active",
    address: { line1: "1420 Linden Ave SE", city: "Cedar Rapids", state: "IA", zip: "52403" },
    phone: "319-555-0187",
    email: "marcus.whitfield@example.com",
    pcp: { npi: "1932014487", name: "Dr. Elena Rausch", practice: "Cedar Rapids Family Medicine" },
    idCardLastIssued: "2026-01-04",
  },
  W20419875: {
    memberId: "W20419875",
    name: "Ava Whitfield",
    dob: "2017-06-21",
    relationship: "Child",
    groupId: "G-44812",
    planId: "PPO1500",
    coverageStart: "2024-01-01",
    coverageEnd: null as string | null,
    status: "Active",
    address: { line1: "1420 Linden Ave SE", city: "Cedar Rapids", state: "IA", zip: "52403" },
    phone: "319-555-0187",
    email: "",
    pcp: { npi: "1710338822", name: "Dr. Noor Haddad", practice: "Kirkwood Pediatrics" },
    idCardLastIssued: "2026-01-04",
  },
};

export const familyIds = ["W20419873", "W20419874", "W20419875"] as const;

export const plans = {
  PPO1500: {
    planId: "PPO1500",
    name: "Prairie PPO 1500",
    type: "PPO",
    network: "Prairie Choice PPO",
    deductible: { individual: 1500, family: 3000 },
    outOfPocketMax: { individual: 5000, family: 10000 },
    coinsurance: 0.2,
    copays: { pcp: 25, specialist: 50, urgentCare: 60, emergency: 250, telehealth: 0 },
    outOfNetwork: { deductible: { individual: 3000, family: 6000 }, coinsurance: 0.4 },
    preventive: "Covered in full in-network",
    priorAuthRequired: ["Advanced imaging (MRI, CT, PET)", "Inpatient admission", "Physical therapy beyond 12 visits per year", "Bariatric surgery", "Specialty drugs"],
  },
  HDHP3000: {
    planId: "HDHP3000",
    name: "Prairie HDHP 3000",
    type: "HDHP (HSA-eligible)",
    network: "Prairie Choice PPO",
    deductible: { individual: 3000, family: 6000 },
    outOfPocketMax: { individual: 6000, family: 12000 },
    coinsurance: 0.1,
    copays: { pcp: 0, specialist: 0, urgentCare: 0, emergency: 0, telehealth: 0 },
    outOfNetwork: { deductible: { individual: 6000, family: 12000 }, coinsurance: 0.4 },
    preventive: "Covered in full in-network",
    priorAuthRequired: ["Advanced imaging (MRI, CT, PET)", "Inpatient admission", "Physical therapy beyond 12 visits per year", "Bariatric surgery", "Specialty drugs"],
  },
};

export const dentalPlan = {
  planId: "DENT-PLUS",
  name: "Prairie Dental Plus",
  system: "DENTAL_ADMIN" as SystemId,
  coverage: {
    preventive: { covered: 1.0, note: "Two cleanings and exams per year, bitewing x-rays once per year" },
    basic: { covered: 0.8, note: "Fillings, simple extractions, periodontal maintenance" },
    major: { covered: 0.5, note: "Crowns, bridges, dentures, implants; 6-month waiting period waived" },
    orthodontia: { covered: 0.5, lifetimeMax: 1500, note: "Dependent children under 19 only" },
  },
  annualMax: 1500,
  deductible: 50,
};

export const visionPlan = {
  planId: "VIS-STD",
  name: "Prairie Vision",
  system: "VISION_PARTNER" as SystemId,
  examCopay: 10,
  examFrequency: "Once every 12 months",
  framesAllowance: 150,
  framesFrequency: "Once every 24 months",
  lensesCopay: 25,
  contactsAllowance: 130,
  lasikDiscount: "15% off at participating providers",
};

export const pharmacyBenefit = {
  system: "PBM" as SystemId,
  tiers: { 1: { label: "Generic", copay30: 10, copay90: 25 }, 2: { label: "Preferred brand", copay30: 40, copay90: 100 }, 3: { label: "Non-preferred brand", copay30: 75, copay90: 190 }, 4: { label: "Specialty", coinsurance: 0.25, maxPerFill: 250 } },
  mailOrder: "90-day supply at two copays",
  formulary: {
    atorvastatin: { tier: 1, priorAuth: false, alternatives: [] as string[] },
    metformin: { tier: 1, priorAuth: false, alternatives: [] },
    lisinopril: { tier: 1, priorAuth: false, alternatives: [] },
    "ozempic": { tier: 2, priorAuth: true, alternatives: ["metformin"], note: "Prior authorization required; approved for type 2 diabetes diagnosis" },
    "humira": { tier: 4, priorAuth: true, alternatives: ["adalimumab-adaz (biosimilar, tier 4, lower cost share)"] },
    "eliquis": { tier: 2, priorAuth: false, alternatives: [] },
    "albuterol": { tier: 1, priorAuth: false, alternatives: [] },
    "trulicity": { tier: 2, priorAuth: true, alternatives: ["metformin"] },
  },
};

export const spendingAccounts = {
  system: "SPENDING_ACCOUNTS" as SystemId,
  W20419873: { fsa: { election: 1200, balance: 640, planYearEnd: "2026-12-31", gracePeriodEnd: "2027-03-15", card: "Active" }, hsa: null },
};

export const accumulators = {
  W20419873: { deductible: { met: 1120, limit: 1500 }, oop: { met: 1610, limit: 5000 }, dental: { used: 410, annualMax: 1500 }, ptVisits: { used: 14, priorAuthAfter: 12 } },
  W20419874: { deductible: { met: 895, limit: 1500 }, oop: { met: 1045, limit: 5000 }, dental: { used: 0, annualMax: 1500 }, ptVisits: { used: 0, priorAuthAfter: 12 } },
  W20419875: { deductible: { met: 0, limit: 1500 }, oop: { met: 225, limit: 5000 }, dental: { used: 190, annualMax: 1500 }, ptVisits: { used: 0, priorAuthAfter: 12 } },
  family: { deductible: { met: 2015, limit: 3000 }, oop: { met: 2880, limit: 10000 } },
};

export const accumulatorHistory = [
  { date: "2026-02-03", memberId: "W20419873", claimId: "CLM-26-000912", deductible: 142, oop: 142, description: "Office visit, Cedar Rapids Family Medicine" },
  { date: "2026-03-18", memberId: "W20419874", claimId: "CLM-26-001855", deductible: 895, oop: 895, description: "Outpatient endoscopy, St. Brigid Medical Center" },
  { date: "2026-05-09", memberId: "W20419873", claimId: "CLM-26-003104", deductible: 198, oop: 198, description: "Lab panel, Corridor Diagnostics" },
  { date: "2026-06-22", memberId: "W20419875", claimId: "CLM-26-003990", deductible: 0, oop: 225, description: "Urgent care copay + strep test, Corridor Urgent Care" },
  { date: "2026-07-14", memberId: "W20419873", claimId: "CLM-26-004481", deductible: 780, oop: 860, description: "MRI right knee, Cedar Rapids Orthopedics" },
  { date: "2026-08-02", memberId: "W20419873", claimId: "CLM-26-005102", deductible: 0, oop: 25, description: "Office visit copay, Cedar Rapids Family Medicine" },
  { date: "2026-08-04", memberId: "W20419874", claimId: "CLM-26-005180", deductible: 0, oop: 150, description: "Specialist copays x3, Cedar Rapids Orthopedics" },
  { date: "2026-08-19", memberId: "W20419873", claimId: "CLM-26-005500", deductible: 0, oop: 385, description: "Physical therapy visits 9–12 (copay + coinsurance), Iowa River Physical Therapy" },
];

export const claims = [
  { claimId: "CLM-26-004481", memberId: "W20419873", patient: "Dana Whitfield", serviceDate: "2026-07-14", receivedDate: "2026-07-21", processedDate: "2026-07-29", provider: "Cedar Rapids Orthopedics", providerNpi: "1477261900", inNetwork: true, type: "Professional", lines: [{ cpt: "73721", description: "MRI lower extremity joint without contrast", billed: 2400, allowed: 1180, deductible: 780, coinsurance: 80, copay: 0, planPaid: 320, memberResponsibility: 860 }], status: "Processed", priorAuth: "PA-26-1183", eobAvailable: true, notes: "Applied to deductible. Provider may bill member $860." },
  { claimId: "CLM-26-005102", memberId: "W20419873", patient: "Dana Whitfield", serviceDate: "2026-08-02", receivedDate: "2026-08-05", processedDate: "2026-08-09", provider: "Cedar Rapids Family Medicine", providerNpi: "1932014487", inNetwork: true, type: "Professional", lines: [{ cpt: "99213", description: "Office visit, established patient, low complexity", billed: 210, allowed: 142, deductible: 0, coinsurance: 0, copay: 25, planPaid: 117, memberResponsibility: 25 }], status: "Processed", priorAuth: null, eobAvailable: true, notes: "" },
  { claimId: "CLM-26-005377", memberId: "W20419874", patient: "Marcus Whitfield", serviceDate: "2026-08-11", receivedDate: "2026-08-16", processedDate: null, provider: "St. Brigid Medical Center Cedar Rapids", providerNpi: "1265498801", inNetwork: true, type: "Facility", lines: [{ cpt: "99284", description: "Emergency department visit, moderate complexity", billed: 3850, allowed: 2610, deductible: null, coinsurance: null, copay: 250, planPaid: null, memberResponsibility: null }], status: "Pending", pendingReason: "Awaiting itemized bill from facility (requested 2026-08-28)", priorAuth: null, eobAvailable: false, notes: "Emergency copay applies; coinsurance calculated on final adjudication." },
  { claimId: "CLM-26-005500", memberId: "W20419873", patient: "Dana Whitfield", serviceDate: "2026-08-19", receivedDate: "2026-08-22", processedDate: "2026-08-27", provider: "Iowa River Physical Therapy", providerNpi: "1598820033", inNetwork: true, type: "Professional", lines: [{ cpt: "97110", description: "Therapeutic exercise (visits 9-12, 4 units)", billed: 640, allowed: 425, deductible: 0, coinsurance: 85, copay: 200, planPaid: 140, memberResponsibility: 285 }], status: "Processed", priorAuth: null, eobAvailable: true, notes: "Visits 9–12 of the 12-visit threshold." },
  { claimId: "CLM-26-005590", memberId: "W20419875", patient: "Ava Whitfield", serviceDate: "2026-08-19", receivedDate: "2026-08-21", processedDate: "2026-08-25", provider: "Kirkwood Pediatrics", providerNpi: "1710338822", inNetwork: true, type: "Professional", lines: [{ cpt: "99393", description: "Preventive visit, age 5–11", billed: 240, allowed: 165, deductible: 0, coinsurance: 0, copay: 0, planPaid: 165, memberResponsibility: 0 }], status: "Processed", priorAuth: null, eobAvailable: true, notes: "Preventive; covered in full." },
  { claimId: "CLM-26-005712", memberId: "W20419873", patient: "Dana Whitfield", serviceDate: "2026-08-25", receivedDate: "2026-08-28", processedDate: "2026-09-03", provider: "Iowa River Physical Therapy", providerNpi: "1598820033", inNetwork: true, type: "Professional", lines: [{ cpt: "97110", description: "Therapeutic exercise (visits 13-14, 2 units)", billed: 320, allowed: 0, deductible: 0, coinsurance: 0, copay: 0, planPaid: 0, memberResponsibility: 320 }], status: "Denied", denialCode: "197", denialReason: "Precertification / authorization absent. Physical therapy visits beyond 12 per plan year require prior authorization.", appealDeadline: "2026-11-02", priorAuth: null, eobAvailable: true, notes: "Provider can submit a retroactive authorization request with clinical notes; if approved, claim will be reprocessed." },
  { claimId: "CLM-26-005801", memberId: "W20419873", patient: "Dana Whitfield", serviceDate: "2026-09-01", receivedDate: "2026-09-01", processedDate: "2026-09-01", provider: "Lindale Pharmacy", providerNpi: "1023344556", inNetwork: true, type: "Pharmacy", lines: [{ cpt: "NDC 00071-0156-23", description: "Atorvastatin 20 mg, 90-day supply", billed: 48, allowed: 31, deductible: 0, coinsurance: 0, copay: 25, planPaid: 6, memberResponsibility: 25 }], status: "Processed", priorAuth: null, eobAvailable: true, notes: "Tier 1 generic, 90-day mail-order copay." },
];

export const priorAuths = [
  { authId: "PA-26-1183", memberId: "W20419873", service: "MRI right knee (CPT 73721)", requestedBy: "Dr. Samuel Okafor, Cedar Rapids Orthopedics", requestedDate: "2026-07-08", decision: "Approved", decisionDate: "2026-07-10", validFrom: "2026-07-10", validThrough: "2026-10-08", units: 1 },
  { authId: "PA-26-1402", memberId: "W20419874", service: "Sleep study (CPT 95810)", requestedBy: "Dr. Elena Rausch, Cedar Rapids Family Medicine", requestedDate: "2026-09-04", decision: "Pending clinical review", decisionDate: null, validFrom: null, validThrough: null, units: 1, expectedDecision: "2026-09-12" },
];

export const carePrograms = [
  { programId: "MSK", name: "Back & joint care program", description: "Virtual physical therapy and coaching for back, knee and shoulder pain. Unlimited visits at no cost share; a licensed PT builds a plan and checks in weekly.", eligibility: "Members with a musculoskeletal claim or PT visits in the last 12 months", costShare: 0, enrollment: "Open" },
  { programId: "DIAB", name: "Diabetes management", description: "Connected glucose meter, unlimited test strips, and a health coach.", eligibility: "Members with a type 1 or type 2 diabetes diagnosis", costShare: 0, enrollment: "Open" },
  { programId: "MAT", name: "Maternity support", description: "Nurse outreach through pregnancy and 12 weeks postpartum; breast pump benefit.", eligibility: "Members with a confirmed pregnancy", costShare: 0, enrollment: "Open" },
  { programId: "TOB", name: "Tobacco cessation", description: "Coaching plus covered nicotine replacement and prescription therapy.", eligibility: "All members 18+", costShare: 0, enrollment: "Open" },
  { programId: "BH", name: "Behavioral health navigation", description: "A care navigator finds an in-network therapist with availability within 7 days and handles the first booking.", eligibility: "All members", costShare: "Standard specialist cost share applies to therapy visits", enrollment: "Open" },
];

export const programEnrollments: { memberId: string; programId: string; enrolledDate: string; status: string }[] = [];

export const nurseLine = { phone: "1-800-555-0142", hours: "24 hours a day, 7 days a week", note: "Registered nurses; not for emergencies. Call 911 for an emergency." };

export interface Provider { npi: string; name: string; specialty: string; practice: string; address: string; phone: string; networks: string[]; tier: number | null; acceptingNewPatients: boolean; languages: string[]; gender: "F" | "M" | null; telehealth: boolean; distanceMiles: number; qualityRating: number; nextAvailable: string | null }

export const providers: Provider[] = [
  { npi: "1932014487", name: "Dr. Elena Rausch", specialty: "Family Medicine", practice: "Cedar Rapids Family Medicine", address: "2900 First Ave NE, Cedar Rapids, IA 52402", phone: "319-555-0101", networks: ["Prairie Choice PPO"], tier: 1, acceptingNewPatients: true, languages: ["English", "Spanish"], gender: "F", telehealth: true, distanceMiles: 2.1, qualityRating: 4.8, nextAvailable: "2026-09-15" },
  { npi: "1477261900", name: "Dr. Samuel Okafor", specialty: "Orthopedic Surgery", practice: "Cedar Rapids Orthopedics", address: "1010 Blairs Ferry Rd NE, Cedar Rapids, IA 52402", phone: "319-555-0133", networks: ["Prairie Choice PPO"], tier: 1, acceptingNewPatients: true, languages: ["English"], gender: "M", telehealth: false, distanceMiles: 4.6, qualityRating: 4.7, nextAvailable: "2026-09-29" },
  { npi: "1598820033", name: "Iowa River Physical Therapy", specialty: "Physical Therapy", practice: "Iowa River Physical Therapy", address: "455 Hwy 1 W, Iowa City, IA 52246", phone: "319-555-0160", networks: ["Prairie Choice PPO"], tier: 1, acceptingNewPatients: true, languages: ["English"], gender: null, telehealth: true, distanceMiles: 27.4, qualityRating: 4.9, nextAvailable: "2026-09-12" },
  { npi: "1841177204", name: "Prairie Ridge Physical Therapy", specialty: "Physical Therapy", practice: "Prairie Ridge Physical Therapy", address: "3300 Edgewood Rd SW, Cedar Rapids, IA 52404", phone: "319-555-0171", networks: [], tier: null, acceptingNewPatients: true, languages: ["English"], gender: null, telehealth: false, distanceMiles: 5.8, qualityRating: 4.5, nextAvailable: "2026-09-11" },
  { npi: "1366720518", name: "Dr. Hana Lindqvist", specialty: "Dermatology", practice: "Corridor Dermatology", address: "1900 Edgewood Rd NE, Cedar Rapids, IA 52402", phone: "319-555-0144", networks: ["Prairie Choice PPO"], tier: 1, acceptingNewPatients: false, languages: ["English", "Swedish"], gender: "F", telehealth: true, distanceMiles: 3.9, qualityRating: 4.6, nextAvailable: "2026-12-02" },
  { npi: "1902557781", name: "Dr. Priyanka Nair", specialty: "Dermatology", practice: "Des Moines Dermatology Associates", address: "1215 Pleasant St, Des Moines, IA 50309", phone: "515-555-0119", networks: ["Prairie Choice PPO"], tier: 2, acceptingNewPatients: true, languages: ["English", "Hindi"], gender: "F", telehealth: true, distanceMiles: 128, qualityRating: 4.7, nextAvailable: "2026-09-18" },
  { npi: "1265498801", name: "St. Brigid Medical Center Cedar Rapids", specialty: "Hospital", practice: "St. Brigid Medical Center", address: "701 10th St SE, Cedar Rapids, IA 52403", phone: "319-555-0190", networks: ["Prairie Choice PPO"], tier: 1, acceptingNewPatients: true, languages: ["English", "Spanish", "French"], gender: null, telehealth: false, distanceMiles: 1.4, qualityRating: 4.4, nextAvailable: null },
  { npi: "1730991455", name: "Corridor Urgent Care", specialty: "Urgent Care", practice: "Corridor Urgent Care", address: "1230 7th Ave, Marion, IA 52302", phone: "319-555-0155", networks: ["Prairie Choice PPO"], tier: 1, acceptingNewPatients: true, languages: ["English"], gender: null, telehealth: false, distanceMiles: 6.2, qualityRating: 4.3, nextAvailable: "Walk in" },
  { npi: "1710338822", name: "Dr. Noor Haddad", specialty: "Pediatrics", practice: "Kirkwood Pediatrics", address: "6301 Kirkwood Blvd SW, Cedar Rapids, IA 52404", phone: "319-555-0128", networks: ["Prairie Choice PPO"], tier: 1, acceptingNewPatients: true, languages: ["English", "Arabic"], gender: "F", telehealth: true, distanceMiles: 7.0, qualityRating: 4.9, nextAvailable: "2026-09-16" },
  { npi: "1558210099", name: "Dr. Priya Raman, DDS", specialty: "General Dentistry", practice: "Lindale Dental", address: "4444 First Ave NE, Cedar Rapids, IA 52402", phone: "319-555-0166", networks: ["Prairie Dental Network"], tier: 1, acceptingNewPatients: true, languages: ["English", "Tamil"], gender: "F", telehealth: false, distanceMiles: 3.3, qualityRating: 4.8, nextAvailable: "2026-09-22" },
  { npi: "1677420310", name: "Clear Sight Vision Center", specialty: "Optometry", practice: "Clear Sight Vision Center", address: "2500 Williams Blvd SW, Cedar Rapids, IA 52404", phone: "319-555-0177", networks: ["Prairie Vision Network"], tier: 1, acceptingNewPatients: true, languages: ["English"], gender: null, telehealth: false, distanceMiles: 5.1, qualityRating: 4.6, nextAvailable: "2026-09-14" },
  { npi: "1487733920", name: "Dr. Tomasz Wierzbicki", specialty: "Cardiology", practice: "Heartland Cardiology", address: "800 Blairs Ferry Rd NE, Cedar Rapids, IA 52402", phone: "319-555-0182", networks: ["Prairie Choice PPO"], tier: 1, acceptingNewPatients: true, languages: ["English", "Polish"], gender: "M", telehealth: true, distanceMiles: 4.4, qualityRating: 4.7, nextAvailable: "2026-10-06" },
  { npi: "1620094471", name: "Dr. Leah Brandt", specialty: "Psychiatry", practice: "Cedar Valley Behavioral Health", address: "1700 1st Ave SE, Cedar Rapids, IA 52402", phone: "319-555-0138", networks: ["Prairie Choice PPO"], tier: 1, acceptingNewPatients: true, languages: ["English"], gender: "F", telehealth: true, distanceMiles: 1.9, qualityRating: 4.5, nextAvailable: "2026-09-19" },
];

export const contracts = [
  { npi: "1932014487", contractId: "CT-PPO-2211", effective: "2023-01-01", termination: null, feeSchedule: "Prairie PPO Professional 2026", status: "Active" },
  { npi: "1366720518", contractId: "CT-PPO-2304", effective: "2023-06-01", termination: "2026-12-31", feeSchedule: "Prairie PPO Professional 2026", status: "Terminating", note: "Provider gave notice; members will receive 90-day continuity-of-care letters on 2026-10-01." },
  { npi: "1841177204", contractId: null, effective: null, termination: null, feeSchedule: null, status: "Not contracted", note: "Recruitment outreach opened 2026-05-12; no response." },
];

export const group = {
  groupId: "G-44812",
  name: "Cedar Rapids Machine Works",
  industry: "Precision machining",
  address: "5100 Rockwell Dr NE, Cedar Rapids, IA 52402",
  admin: { name: "Renee Castillo", title: "HR Director", email: "renee.castillo@example.com", phone: "319-555-0110" },
  broker: { name: "Hawkeye Benefits Group", contact: "Tom Ostrander" },
  effectiveDate: "2022-01-01",
  renewalDate: "2027-01-01",
  contractPeriod: "2026-01-01 to 2026-12-31",
  eligibleEmployees: 214,
  enrolledSubscribers: 183,
  totalCoveredLives: 397,
  waitingPeriod: "First of the month after 30 days",
  openEnrollment: { start: "2026-11-01", end: "2026-11-15" },
  plans: [
    { planId: "PPO1500", name: "Prairie PPO 1500", subscribers: 121, coveredLives: 268, employerContribution: "80% employee / 60% dependents" },
    { planId: "HDHP3000", name: "Prairie HDHP 3000", subscribers: 62, coveredLives: 129, employerContribution: "90% employee / 65% dependents, plus $750 HSA seed" },
  ],
  ancillary: ["Prairie Dental Plus", "Prairie Vision"],
  renewal: { status: "Proposal delivered 2026-08-28", proposedRateChange: 0.068, priorYearChange: 0.041, drivers: ["Large-claim experience (two claims over $150k)", "Specialty pharmacy trend +14%", "Medical trend 5.9%"], alternatives: ["Move PPO deductible to $2,000: +3.9%", "Add narrow-network tier option: +4.6%", "Keep benefits as-is: +6.8%"], decisionDue: "2026-10-15" },
  invoices: [
    { invoiceId: "INV-2026-07", period: "July 2026", amount: 186880, due: "2026-07-15", paid: "2026-07-13", status: "Paid" },
    { invoiceId: "INV-2026-08", period: "August 2026", amount: 187420, due: "2026-08-15", paid: "2026-08-14", status: "Paid" },
    { invoiceId: "INV-2026-09", period: "September 2026", amount: 189105, due: "2026-09-15", paid: null, status: "Open" },
  ],
  pending: { newHiresAwaitingEnrollment: [{ name: "J. Petrakis", hireDate: "2026-08-18", eligible: "2026-10-01" }, { name: "M. Ellison", hireDate: "2026-08-25", eligible: "2026-10-01" }, { name: "S. Okonkwo", hireDate: "2026-09-02", eligible: "2026-11-01" }], cobraParticipants: 2, terminationsThisMonth: 1 },
  enrollmentByMonth: [{ month: "2026-04", subscribers: 179 }, { month: "2026-05", subscribers: 180 }, { month: "2026-06", subscribers: 181 }, { month: "2026-07", subscribers: 182 }, { month: "2026-08", subscribers: 183 }, { month: "2026-09", subscribers: 183 }],
};

/** Simple estimator used by the accumulations and benefits agents. */
export function estimateCostShare(memberId: string, allowedAmount: number, serviceType: "specialist" | "pcp" | "urgentCare" | "emergency" | "other") {
  const plan = plans.PPO1500;
  const acc = accumulators[memberId as keyof typeof accumulators] as (typeof accumulators)["W20419873"] | undefined;
  if (!acc) return { error: `No accumulators for ${memberId}` };
  if (serviceType !== "other") {
    const copay = plan.copays[serviceType];
    return { serviceType, allowedAmount, memberPays: copay, planPays: Math.max(0, allowedAmount - copay), basis: `Flat ${serviceType} copay of $${copay}; deductible does not apply.` };
  }
  const dedRemaining = Math.max(0, Math.min(acc.deductible.limit - acc.deductible.met, accumulators.family.deductible.limit - accumulators.family.deductible.met));
  const towardDeductible = Math.min(allowedAmount, dedRemaining);
  const afterDeductible = allowedAmount - towardDeductible;
  const coinsurance = Math.round(afterDeductible * plan.coinsurance);
  const oopRemaining = acc.oop.limit - acc.oop.met;
  const memberPays = Math.min(towardDeductible + coinsurance, oopRemaining);
  return { serviceType, allowedAmount, deductibleRemainingBefore: dedRemaining, appliedToDeductible: towardDeductible, coinsurance, memberPays, planPays: allowedAmount - memberPays, outOfPocketMetBefore: acc.oop.met, outOfPocketMetAfter: acc.oop.met + memberPays, outOfPocketLimit: acc.oop.limit, basis: `Remaining deductible first, then ${plan.coinsurance * 100}% coinsurance, capped by the out-of-pocket maximum.` };
}

export interface MemberAccumulators { deductible: { met: number; limit: number }; oop: { met: number; limit: number }; dental: { used: number; annualMax: number }; ptVisits: { used: number; priorAuthAfter: number } }
export function memberAccumulators(id: string): MemberAccumulators {
  return accumulators[id as "W20419873"];
}
