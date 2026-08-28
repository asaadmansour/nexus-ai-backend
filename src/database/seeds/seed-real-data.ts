import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import dataSource from '../data-source';
import { UserRole } from '../../common/enums/user-role.enum';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { User } from '../../users/entities/user.entity';
import { Project } from '../../projects/entities/project.entity';
import { Brief } from '../../projects/entities/brief.entity';
import { FreelancerProfile } from '../../freelancers/entities/freelancer-profile.entity';
import { FreelancerSkillScore } from '../../freelancers/entities/freelancer-skill-score.entity';

// Wipes every application table and repopulates the platform with a realistic
// data set: an admin, five headline freelancers who are built to win their own
// role, a supporting pool that makes the ranking look like a real marketplace,
// customers, and briefed projects at various stages.
//
//   npm run seed:real -- --yes                 (local, ts-node)
//   npm run seed:real -- --yes --freelancers-only
//   node dist/database/seeds/seed-real-data.js --yes   (inside the image)
//
// The --yes flag is mandatory: both modes are destructive. The
// --freelancers-only mode leaves no users or domain data except freelancer
// users and their profiles, scores, and embeddings.

const AI_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';
const EMBEDDING_MODEL = 'gemini-embedding-001';
const DIMENSIONS = 1024;

const ADMIN = {
  email: 'admin@nexus-ai.local',
  password: 'Admin@123456',
  firstName: 'Nexus',
  lastName: 'Admin',
};

const PASSWORD = 'Nexus@123456';

// Size of the supporting freelancer pool. Every one of them is capped below
// the headline five on every scored axis.
// Five hand-tuned specialists below plus this supporting pool produce exactly
// 50 freelancers: broad enough for realistic matching without making a clean
// dev reset unnecessarily slow.
const POOL_SIZE = 45;

// --- Skill vocabularies -----------------------------------------------------
// Every brief below draws its requiredSkills from these lists, so the headline
// freelancer for a role matches 100% of what their role's projects ask for.

const ARCHITECT_SKILLS = [
  'System Design', 'Solution Architecture', 'NestJS', 'PostgreSQL',
  'API Design', 'Microservices', 'Event-Driven Architecture',
  'Domain-Driven Design', 'AWS', 'Docker', 'Kubernetes', 'Scalability',
  'Security', 'Technical Leadership',
];

const BACKEND_SKILLS = [
  'NestJS', 'Node.js', 'TypeScript', 'PostgreSQL', 'TypeORM', 'REST APIs',
  'GraphQL', 'Redis', 'BullMQ', 'Authentication', 'Stripe Integration',
  'Testing', 'Docker', 'Performance Optimization',
];

const FRONTEND_SKILLS = [
  'React', 'Next.js', 'TypeScript', 'Tailwind CSS', 'Redux', 'React Query',
  'Responsive Design', 'Accessibility', 'Web Performance',
  'Component Libraries', 'Jest', 'Testing Library',
];

const UIUX_SKILLS = [
  'Figma', 'Design Systems', 'User Flows', 'Wireframing', 'Prototyping',
  'UI Design', 'UX Research', 'Accessibility', 'Responsive Design',
  'Interaction Design', 'Usability Testing', 'Design Tokens',
];

// 'Code Review' and 'System Design' also feed the reranker's leadership bonus
// for the principal_reviewer role (it looks for principal/lead/architecture/
// senior/review/system/security tokens across headline, bio and skills).
const REVIEWER_SKILLS = [
  'Code Review', 'Architecture Review', 'System Design', 'Security',
  'Technical Leadership', 'Principal Engineering', 'Mentoring', 'NestJS',
  'React', 'PostgreSQL', 'Quality Assurance', 'Risk Assessment',
];

type FreelancerSeed = {
  email: string;
  firstName: string;
  lastName: string;
  githubUsername: string | null;
  headline: string;
  bio: string;
  skills: string[];
  skillScore: number;
  yearsExperience: number;
  hourlyRate: string;
  availabilityHoursPerWeek: number;
  assessmentScore: string;
  performanceScore: string;
  approvedSubmissions: number;
  rejectedSubmissions: number;
  onTimeDeliveries: number;
  lateDeliveries: number;
  missedDeadlines: number;
  avgRating: string;
  ratingsCount: number;
  principalReviewer?: boolean;
  isTop?: boolean;
};

// --- The five headline freelancers ------------------------------------------
// Tuned to top every scorer in nexus-ai-service/app/agents/freelancer_matching.py:
// every required skill present at 5.00, the pool's highest availability and
// experience, the pool's lowest rate, a perfect delivery record and no risk
// flags. The supporting pool below is deliberately capped underneath them.

const TOP: FreelancerSeed[] = [
  {
    email: 'asaad.mansourr@gmail.com',
    firstName: 'Asaad',
    lastName: 'Mansour',
    githubUsername: 'asaadmansour',
    headline:
      'Principal reviewer and senior staff engineer for architecture review and security',
    bio: 'Principal engineer leading architecture review, code review and security review across distributed platforms. Fifteen years of technical leadership, mentoring senior teams and signing off system design, scalability and risk assessment for production launches.',
    skills: REVIEWER_SKILLS,
    skillScore: 5.0,
    yearsExperience: 15,
    hourlyRate: '12.00',
    availabilityHoursPerWeek: 40,
    assessmentScore: '99.00',
    performanceScore: '100.00',
    approvedSubmissions: 96,
    rejectedSubmissions: 0,
    onTimeDeliveries: 96,
    lateDeliveries: 0,
    missedDeadlines: 0,
    isTop: true,
    avgRating: '5.00',
    ratingsCount: 61,
    principalReviewer: true,
  },
  {
    email: 'muhanadmedhat7@gmail.com',
    firstName: 'Muhanad',
    lastName: 'Medhat',
    githubUsername: 'muhanadmedhat',
    headline: 'Senior backend engineer for NestJS, PostgreSQL and payment APIs',
    bio: 'Backend engineer specialising in NestJS and TypeORM services on PostgreSQL, REST and GraphQL API design, Redis and BullMQ queues, authentication, Stripe integration, automated testing and performance optimization for high-traffic products.',
    skills: BACKEND_SKILLS,
    skillScore: 5.0,
    yearsExperience: 15,
    hourlyRate: '12.00',
    availabilityHoursPerWeek: 40,
    assessmentScore: '99.00',
    performanceScore: '100.00',
    approvedSubmissions: 88,
    rejectedSubmissions: 0,
    onTimeDeliveries: 88,
    lateDeliveries: 0,
    missedDeadlines: 0,
    isTop: true,
    avgRating: '5.00',
    ratingsCount: 54,
  },
  {
    email: 'ibrahimmostafa9939@gmail.com',
    firstName: 'Ibrahim',
    lastName: 'Mostafa',
    githubUsername: 'ebrahimmostafa133',
    headline: 'Senior frontend engineer for React, Next.js and design systems',
    bio: 'Frontend engineer building React and Next.js applications in TypeScript with Tailwind CSS, Redux and React Query, focused on responsive design, accessibility, web performance, reusable component libraries and Jest and Testing Library coverage.',
    skills: FRONTEND_SKILLS,
    skillScore: 5.0,
    yearsExperience: 15,
    hourlyRate: '12.00',
    availabilityHoursPerWeek: 40,
    assessmentScore: '99.00',
    performanceScore: '100.00',
    approvedSubmissions: 84,
    rejectedSubmissions: 0,
    onTimeDeliveries: 84,
    lateDeliveries: 0,
    missedDeadlines: 0,
    isTop: true,
    avgRating: '5.00',
    ratingsCount: 49,
  },
  {
    email: 'Mohamed.kholy2011@gmail.com',
    firstName: 'Mohamed',
    lastName: 'Sameh',
    githubUsername: 'Mohamed-Samehh',
    headline: 'Principal software architect for scalable distributed systems',
    bio: 'Software architect owning solution architecture and system design for microservices and event-driven platforms: domain-driven design, NestJS and PostgreSQL, API design, AWS, Docker and Kubernetes, scalability and security, with hands-on technical leadership.',
    skills: ARCHITECT_SKILLS,
    skillScore: 5.0,
    yearsExperience: 15,
    hourlyRate: '12.00',
    availabilityHoursPerWeek: 40,
    assessmentScore: '99.00',
    performanceScore: '100.00',
    approvedSubmissions: 92,
    rejectedSubmissions: 0,
    onTimeDeliveries: 92,
    lateDeliveries: 0,
    missedDeadlines: 0,
    isTop: true,
    avgRating: '5.00',
    ratingsCount: 58,
  },
  {
    email: 'shahd.mostafa3711@gmail.com',
    firstName: 'Shahd',
    lastName: 'Mostafa',
    githubUsername: 'Shahd3711',
    headline: 'Senior UI UX designer for design systems and product interfaces',
    bio: 'UI UX designer covering UX research, user flows, wireframing and prototyping through to polished UI design in Figma, building accessible responsive design systems with documented design tokens and validating them through usability testing.',
    skills: UIUX_SKILLS,
    skillScore: 5.0,
    yearsExperience: 15,
    hourlyRate: '12.00',
    availabilityHoursPerWeek: 40,
    assessmentScore: '99.00',
    performanceScore: '100.00',
    approvedSubmissions: 80,
    rejectedSubmissions: 0,
    onTimeDeliveries: 80,
    lateDeliveries: 0,
    missedDeadlines: 0,
    isTop: true,
    avgRating: '5.00',
    ratingsCount: 47,
  },
];

// --- Supporting pool --------------------------------------------------------
// Credible competitors so rankings look earned rather than empty. Every one of
// them is capped below the headline five: fewer of the required skills, lower
// skill scores, less availability and experience, a higher rate, and an
// imperfect delivery record.

type PoolTemplate = {
  first: string;
  last: string;
  discipline: 'architect' | 'backend' | 'frontend' | 'uiux' | 'reviewer';
};

const FIRST_NAMES = [
  'Nour', 'Omar', 'Yasmin', 'Karim', 'Tarek', 'Salma', 'Youssef', 'Dina',
  'Hassan', 'Mariam', 'Ziad', 'Farida', 'Amr', 'Hana', 'Laila', 'Nadia',
  'Rami', 'Sherif', 'Aya', 'Khaled', 'Menna', 'Bassel', 'Habiba', 'Marwan',
  'Nada', 'Seif', 'Rowan', 'Adham', 'Malak', 'Fady', 'Jana', 'Hazem',
  'Sondos', 'Mostafa', 'Rana', 'Tamer', 'Alaa', 'Nourhan', 'Zeyad', 'Heba',
];

const LAST_NAMES = [
  'Ahmed', 'Khaled', 'Fouad', 'Adel', 'Selim', 'Hegazy', 'Nabil', 'Rashad',
  'Gamal', 'Ali', 'Anwar', 'Sherif', 'Sabry', 'Youssef', 'Ibrahim', 'Hamdy',
  'Zaki', 'Mahmoud', 'Mansour', 'Fahmy', 'Sabbour', 'Nagy', 'Shaker', 'Ramzy',
  'Helmy', 'Farouk', 'Kamel', 'Refaat', 'Bakr', 'Wahba',
];

const DISCIPLINES: PoolTemplate['discipline'][] = [
  'architect', 'backend', 'frontend', 'uiux', 'reviewer',
];

const DISCIPLINE_SKILLS: Record<PoolTemplate['discipline'], string[]> = {
  architect: ARCHITECT_SKILLS,
  backend: BACKEND_SKILLS,
  frontend: FRONTEND_SKILLS,
  uiux: UIUX_SKILLS,
  reviewer: REVIEWER_SKILLS,
};

const DISCIPLINE_HEADLINE: Record<PoolTemplate['discipline'], string> = {
  architect: 'Software architect',
  backend: 'Backend engineer',
  frontend: 'Frontend engineer',
  uiux: 'UI UX designer',
  reviewer: 'Senior engineer and code reviewer',
};

// Deterministic pseudo-variation so re-runs produce the same pool.
function spread(index: number, min: number, max: number): number {
  const steps = max - min;
  return min + ((index * 7) % (steps + 1));
}

function buildPool(count: number): FreelancerSeed[] {
  return Array.from({ length: count }, (_, index) => {
    const discipline = DISCIPLINES[index % DISCIPLINES.length];
    const first = FIRST_NAMES[index % FIRST_NAMES.length];
    const last = LAST_NAMES[(index * 3) % LAST_NAMES.length];
    const all = DISCIPLINE_SKILLS[discipline];
    // 6-10 of the discipline's skills, never the full set.
    const take = 6 + (index % 5);
    const skills = all.slice(0, Math.min(take, all.length - 2));
    const handle = `${first}${last}`.toLowerCase();
    const years = spread(index, 3, 9);

    return {
      // The index keeps the email and GitHub handle unique even where a name
      // combination repeats; github_username carries a unique index.
      email: `${handle}${index}@nexus-ai.dev`,
      firstName: first,
      lastName: last,
      githubUsername: `${handle}-${index}`,
      headline: `${DISCIPLINE_HEADLINE[discipline]} with ${years} years of delivery experience`,
      bio: `${DISCIPLINE_HEADLINE[discipline]} working across ${skills.slice(0, 4).join(', ')} on product teams, shipping features end to end alongside the rest of the squad.`,
      skills,
      skillScore: 3.2 + ((index * 3) % 11) / 10,
      yearsExperience: years,
      hourlyRate: `${spread(index, 22, 58)}.00`,
      availabilityHoursPerWeek: spread(index, 8, 32),
      assessmentScore: `${spread(index, 62, 88)}.00`,
      performanceScore: `${spread(index, 66, 92)}.00`,
      approvedSubmissions: spread(index, 6, 40),
      rejectedSubmissions: spread(index, 1, 7),
      onTimeDeliveries: spread(index, 5, 38),
      lateDeliveries: spread(index, 1, 9),
      missedDeadlines: index % 4,
      avgRating: `${(3.4 + ((index * 2) % 12) / 10).toFixed(2)}`,
      ratingsCount: spread(index, 4, 33),
      principalReviewer: discipline === 'reviewer',
    };
  });
}

// --- Customers and projects -------------------------------------------------

const CUSTOMERS = [
  { email: 'owner@stonebakery.com', firstName: 'Hala', lastName: 'Rifaat', company: 'Stone Bakery' },
  { email: 'founder@medixclinics.com', firstName: 'Sameh', lastName: 'Botros', company: 'Medix Clinics' },
  { email: 'ops@cargolinklogistics.com', firstName: 'Nabil', lastName: 'Wassef', company: 'CargoLink Logistics' },
  { email: 'hello@atelierfurniture.com', firstName: 'Rania', lastName: 'Shawky', company: 'Atelier Furniture' },
  { email: 'team@tutorlyacademy.com', firstName: 'Islam', lastName: 'Diab', company: 'Tutorly Academy' },
  { email: 'contact@greenfieldfarms.com', firstName: 'Magdy', lastName: 'Awad', company: 'Greenfield Farms' },
  { email: 'admin@paceofitness.com', firstName: 'Dalia', lastName: 'Ezzat', company: 'Pace Fitness' },
  { email: 'info@northstarrealty.com', firstName: 'Waleed', lastName: 'Hafez', company: 'Northstar Realty' },
  { email: 'support@brewhousecoffee.com', firstName: 'Sara', lastName: 'Lotfy', company: 'Brewhouse Coffee' },
  { email: 'projects@vertexinsurance.com', firstName: 'Ahmed', lastName: 'Roushdy', company: 'Vertex Insurance' },
];

const COMPANY_BANK = [
  ['Cairo Dental Group', 'healthcare'], ['Nile Freight', 'logistics'],
  ['Bright Steps Nursery', 'education'], ['Urban Threads', 'retail'],
  ['Sunset Travel', 'travel'], ['Delta Pharma', 'healthcare'],
  ['Cedar Legal', 'professional services'], ['Prime Auto Care', 'automotive'],
  ['Harvest Grocers', 'retail'], ['Lumen Photography', 'creative services'],
  ['Metro Dry Cleaning', 'services'], ['Pixel Print House', 'printing'],
  ['Oasis Spa', 'wellness'], ['Skyline Events', 'events'],
  ['Verde Landscaping', 'home services'], ['Bluewave Swimming', 'sports'],
  ['Copper Kitchen', 'food and beverage'], ['Studio Nine Architects', 'architecture'],
  ['Trailhead Outdoors', 'retail'], ['Nova Language School', 'education'],
  ['Anchor Marine', 'marine'], ['Rosewood Interiors', 'interior design'],
  ['Summit Accounting', 'finance'], ['Cobalt Security', 'security'],
  ['Fairview Vet Clinic', 'veterinary'], ['Ironclad Fitness', 'fitness'],
  ['Paperbark Books', 'retail'], ['Solstice Solar', 'energy'],
  ['Amber Catering', 'food and beverage'], ['Quill Publishing', 'publishing'],
];

// The ten named customers above own the hand-written flagship projects; these
// fill the marketplace out so the admin views are not a ten-row list.
const GENERATED_CUSTOMERS = COMPANY_BANK.map(([company, domain], index) => ({
  email: `contact${index}@${company.toLowerCase().replace(/[^a-z]/g, '')}.com`,
  firstName: FIRST_NAMES[(index * 5) % FIRST_NAMES.length],
  lastName: LAST_NAMES[(index * 7) % LAST_NAMES.length],
  company,
  domain,
}));

const ALL_CUSTOMERS = [...CUSTOMERS, ...GENERATED_CUSTOMERS];

type ProjectSeed = {
  customerIndex: number;
  title: string;
  description: string;
  budgetMin: string;
  budgetMax: string;
  status: ProjectStatus;
  planningStatus: string;
  projectType: string;
  domain: string;
  mainGoal: string;
  targetUsers: string;
  coreFeatures: string;
  platforms: string;
  requiredSkills: string[];
  deadlineDays: number;
};

// requiredSkills are always drawn from the headline freelancers' skill sets, so
// whichever role a run targets, the intended person matches every skill asked
// for while the supporting pool only matches part of the list.
const PROJECTS: ProjectSeed[] = [
  {
    customerIndex: 0,
    title: 'Stone Bakery ecommerce and inventory platform',
    description: 'Sell bakery products online with a catalog, cart, checkout and a stock and sales dashboard for the shop team.',
    budgetMin: '8000.00', budgetMax: '18000.00',
    status: ProjectStatus.BRIEF_COMPLETE, planningStatus: 'not_started',
    projectType: 'ecommerce', domain: 'food and beverage',
    mainGoal: 'Sell online and keep stock and sales in one place.',
    targetUsers: 'Existing bakery customers plus the shop floor team.',
    coreFeatures: 'product catalog, cart, checkout, payments, inventory dashboard',
    platforms: 'web, mobile web',
    requiredSkills: ['Solution Architecture', 'Scalability', 'API Design', 'Figma', 'User Flows', 'UI Design', 'REST APIs', 'Authentication', 'Stripe Integration', 'React', 'Next.js', 'Component Libraries'],
    deadlineDays: 45,
  },
  {
    customerIndex: 1,
    title: 'Medix patient booking and records portal',
    description: 'Let patients book appointments online and give clinicians a consolidated record view across branches.',
    budgetMin: '15000.00', budgetMax: '32000.00',
    status: ProjectStatus.BRIEF_COMPLETE, planningStatus: 'not_started',
    projectType: 'healthcare platform', domain: 'healthcare',
    mainGoal: 'Cut phone bookings and unify patient records.',
    targetUsers: 'Patients booking visits and clinicians reviewing histories.',
    coreFeatures: 'appointment booking, patient records, reminders, clinician dashboard',
    platforms: 'web, mobile',
    requiredSkills: ['Solution Architecture', 'Domain-Driven Design', 'Technical Leadership', 'UX Research', 'Wireframing', 'Prototyping', 'Authentication', 'REST APIs', 'Testing', 'React', 'Next.js', 'Web Performance'],
    deadlineDays: 90,
  },
  {
    customerIndex: 2,
    title: 'CargoLink shipment tracking system',
    description: 'Track shipments from pickup to delivery with live status, driver assignment and customer notifications.',
    budgetMin: '20000.00', budgetMax: '45000.00',
    status: ProjectStatus.PLANNING_MATCHING, planningStatus: 'matching',
    projectType: 'logistics platform', domain: 'logistics',
    mainGoal: 'Give customers live shipment visibility.',
    targetUsers: 'Dispatchers, drivers and shipping customers.',
    coreFeatures: 'shipment tracking, driver app, notifications, reporting',
    platforms: 'web, mobile',
    requiredSkills: ['Microservices', 'Event-Driven Architecture', 'Scalability', 'User Flows', 'UI Design', 'Interaction Design', 'Redis', 'BullMQ', 'Node.js', 'React', 'React Query', 'Web Performance'],
    deadlineDays: 120,
  },
  {
    customerIndex: 3,
    title: 'Atelier furniture configurator storefront',
    description: 'Let shoppers configure furniture finishes and dimensions, then order the configured item online.',
    budgetMin: '12000.00', budgetMax: '26000.00',
    status: ProjectStatus.BRIEF_COMPLETE, planningStatus: 'not_started',
    projectType: 'ecommerce', domain: 'retail',
    mainGoal: 'Sell configurable furniture without a showroom visit.',
    targetUsers: 'Home buyers and interior designers.',
    coreFeatures: 'product configurator, catalog, checkout, order tracking',
    platforms: 'web',
    requiredSkills: ['API Design', 'Solution Architecture', 'Scalability', 'Figma', 'Prototyping', 'Interaction Design', 'REST APIs', 'Node.js', 'Performance Optimization', 'React', 'Tailwind CSS', 'Component Libraries'],
    deadlineDays: 60,
  },
  {
    customerIndex: 4,
    title: 'Tutorly live class and progress platform',
    description: 'Run live classes, track student progress and let parents see reports each week.',
    budgetMin: '18000.00', budgetMax: '38000.00',
    status: ProjectStatus.PLANNING_ASSIGNED, planningStatus: 'assigned',
    projectType: 'education platform', domain: 'education',
    mainGoal: 'Move classes online with measurable progress tracking.',
    targetUsers: 'Students, tutors and parents.',
    coreFeatures: 'live classes, assignments, progress reports, parent portal',
    platforms: 'web, mobile',
    requiredSkills: ['Domain-Driven Design', 'API Design', 'Scalability', 'User Flows', 'Wireframing', 'Usability Testing', 'TypeORM', 'REST APIs', 'Testing', 'React', 'React Query', 'Jest'],
    deadlineDays: 100,
  },
  {
    customerIndex: 5,
    title: 'Greenfield farm-to-table subscription service',
    description: 'Weekly produce boxes with subscription management, delivery scheduling and recurring billing.',
    budgetMin: '10000.00', budgetMax: '22000.00',
    status: ProjectStatus.BRIEF_COMPLETE, planningStatus: 'not_started',
    projectType: 'subscription commerce', domain: 'agriculture',
    mainGoal: 'Run recurring produce deliveries end to end.',
    targetUsers: 'Households subscribing to weekly boxes.',
    coreFeatures: 'subscription plans, delivery scheduling, recurring billing, account portal',
    platforms: 'web, mobile web',
    requiredSkills: ['Solution Architecture', 'API Design', 'AWS', 'UI Design', 'User Flows', 'Design Tokens', 'Stripe Integration', 'BullMQ', 'Authentication', 'React', 'Next.js', 'Tailwind CSS'],
    deadlineDays: 55,
  },
  {
    customerIndex: 6,
    title: 'Pace Fitness membership and class booking app',
    description: 'Members book classes, manage memberships and track attendance across gym branches.',
    budgetMin: '9000.00', budgetMax: '20000.00',
    status: ProjectStatus.ACTIVE, planningStatus: 'completed',
    projectType: 'booking platform', domain: 'fitness',
    mainGoal: 'Fill classes and automate membership billing.',
    targetUsers: 'Gym members and branch managers.',
    coreFeatures: 'class booking, memberships, attendance tracking, billing',
    platforms: 'mobile, web',
    requiredSkills: ['Scalability', 'API Design', 'Microservices', 'Figma', 'Usability Testing', 'UI Design', 'Redis', 'REST APIs', 'Testing', 'React', 'Next.js', 'Jest'],
    deadlineDays: 35,
  },
  {
    customerIndex: 7,
    title: 'Northstar property listing and lead portal',
    description: 'Publish property listings, capture buyer leads and route them to the right agent automatically.',
    budgetMin: '14000.00', budgetMax: '30000.00',
    status: ProjectStatus.BRIEF_COMPLETE, planningStatus: 'not_started',
    projectType: 'marketplace', domain: 'real estate',
    mainGoal: 'Turn listing traffic into qualified agent leads.',
    targetUsers: 'Property buyers and sales agents.',
    coreFeatures: 'listing search, saved searches, lead capture, agent CRM',
    platforms: 'web, mobile',
    requiredSkills: ['Solution Architecture', 'Domain-Driven Design', 'API Design', 'UX Research', 'Design Systems', 'Interaction Design', 'GraphQL', 'REST APIs', 'Performance Optimization', 'Next.js', 'React Query', 'Component Libraries'],
    deadlineDays: 75,
  },
  {
    customerIndex: 8,
    title: 'Brewhouse loyalty and mobile ordering',
    description: 'Order ahead from the app, earn loyalty points and redeem rewards in store.',
    budgetMin: '7000.00', budgetMax: '16000.00',
    status: ProjectStatus.COMPLETED, planningStatus: 'completed',
    projectType: 'mobile commerce', domain: 'food and beverage',
    mainGoal: 'Increase repeat visits with order-ahead and loyalty.',
    targetUsers: 'Regular coffee shop customers.',
    coreFeatures: 'mobile ordering, loyalty points, rewards, store pickup',
    platforms: 'mobile',
    requiredSkills: ['API Design', 'Scalability', 'AWS', 'Figma', 'Prototyping', 'UI Design', 'Redis', 'Authentication', 'Node.js', 'React', 'Redux', 'Tailwind CSS'],
    deadlineDays: -20,
  },
  {
    customerIndex: 9,
    title: 'Vertex insurance claims automation',
    description: 'Digitise claim intake, automate document checks and give adjusters a review queue.',
    budgetMin: '25000.00', budgetMax: '55000.00',
    status: ProjectStatus.BRIEF_COMPLETE, planningStatus: 'not_started',
    projectType: 'enterprise workflow', domain: 'insurance',
    mainGoal: 'Cut claim processing time by automating intake and checks.',
    targetUsers: 'Policyholders filing claims and claims adjusters.',
    coreFeatures: 'claim intake, document verification, adjuster queue, audit trail',
    platforms: 'web',
    requiredSkills: ['Microservices', 'AWS', 'Kubernetes', 'User Flows', 'Wireframing', 'UX Research', 'REST APIs', 'BullMQ', 'Testing', 'React', 'Next.js', 'Testing Library'],
    deadlineDays: 150,
  },
  {
    customerIndex: 0,
    title: 'Stone Bakery wholesale ordering portal',
    description: 'A separate portal where cafes and hotels place recurring wholesale orders on account terms.',
    budgetMin: '11000.00', budgetMax: '24000.00',
    status: ProjectStatus.BRIEF_COMPLETE, planningStatus: 'not_started',
    projectType: 'b2b portal', domain: 'food and beverage',
    mainGoal: 'Take wholesale orders without phone calls and spreadsheets.',
    targetUsers: 'Wholesale buyers at cafes and hotels.',
    coreFeatures: 'account pricing, recurring orders, invoices, delivery windows',
    platforms: 'web',
    requiredSkills: ['API Design', 'Domain-Driven Design', 'Solution Architecture', 'UI Design', 'Design Tokens', 'User Flows', 'TypeORM', 'REST APIs', 'Performance Optimization', 'React', 'Component Libraries', 'Tailwind CSS'],
    deadlineDays: 65,
  },
  {
    customerIndex: 3,
    title: 'Atelier design system and brand refresh',
    description: 'Rebuild the storefront design language into a documented, accessible component system.',
    budgetMin: '6000.00', budgetMax: '14000.00',
    status: ProjectStatus.BRIEF_COMPLETE, planningStatus: 'not_started',
    projectType: 'design system', domain: 'retail',
    mainGoal: 'One consistent, accessible design language across the storefront.',
    targetUsers: 'The in-house product and marketing teams.',
    coreFeatures: 'design tokens, component library, accessibility audit, usage documentation',
    platforms: 'web',
    requiredSkills: ['Technical Leadership', 'Solution Architecture', 'API Design', 'Design Systems', 'Design Tokens', 'UI Design', 'REST APIs', 'Testing', 'Node.js', 'Component Libraries', 'React', 'Testing Library'],
    deadlineDays: 40,
  },
];

// One project per generated customer. requiredSkills rotate through the same
// four discipline-exclusive pools the flagship briefs use, so no specialist can
// out-match another on the shared list and role fit stays the decider.
const ARCHITECT_ONLY = ['Solution Architecture', 'Microservices', 'Event-Driven Architecture',
  'Domain-Driven Design', 'AWS', 'Kubernetes', 'Scalability', 'API Design', 'Technical Leadership'];
const UIUX_ONLY = ['Figma', 'Design Systems', 'User Flows', 'Wireframing', 'Prototyping',
  'UI Design', 'UX Research', 'Interaction Design', 'Usability Testing', 'Design Tokens'];
const BACKEND_ONLY = ['Node.js', 'TypeORM', 'REST APIs', 'GraphQL', 'Redis', 'BullMQ',
  'Authentication', 'Stripe Integration', 'Performance Optimization', 'Testing'];
const FRONTEND_ONLY = ['React', 'Next.js', 'Tailwind CSS', 'Redux', 'React Query',
  'Web Performance', 'Component Libraries', 'Jest', 'Testing Library'];

const pick = (list: string[], index: number, n: number) =>
  Array.from({ length: n }, (_, k) => list[(index * 3 + k) % list.length]);

const PROJECT_SHAPES = [
  ['customer portal', 'Give customers a self-service account area', 'account portal, profile management, document uploads, support requests'],
  ['booking platform', 'Take bookings online instead of by phone', 'availability calendar, online booking, reminders, staff schedule'],
  ['ecommerce storefront', 'Sell the full catalogue online', 'product catalog, cart, checkout, order tracking'],
  ['internal dashboard', 'Replace the spreadsheets the team runs on', 'reporting dashboard, data import, user roles, audit trail'],
  ['mobile companion app', 'Put the service in customers pockets', 'mobile ordering, notifications, loyalty points, account history'],
  ['inventory system', 'Know what is in stock without counting it', 'stock levels, purchase orders, supplier records, low stock alerts'],
];

const STATUS_CYCLE: [ProjectStatus, string][] = [
  [ProjectStatus.BRIEF_COMPLETE, 'not_started'],
  [ProjectStatus.BRIEF_COMPLETE, 'not_started'],
  [ProjectStatus.PLANNING_MATCHING, 'matching'],
  [ProjectStatus.BRIEF_COMPLETE, 'not_started'],
  [ProjectStatus.PLANNING_ASSIGNED, 'assigned'],
  [ProjectStatus.ACTIVE, 'completed'],
  [ProjectStatus.BRIEF_COMPLETE, 'not_started'],
  [ProjectStatus.COMPLETED, 'completed'],
];

const GENERATED_PROJECTS: ProjectSeed[] = GENERATED_CUSTOMERS.map((customer, index) => {
  const [shape, goal, features] = PROJECT_SHAPES[index % PROJECT_SHAPES.length];
  const [status, planningStatus] = STATUS_CYCLE[index % STATUS_CYCLE.length];
  const budget = 6000 + (index % 9) * 3000;
  return {
    customerIndex: CUSTOMERS.length + index,
    title: `${customer.company} ${shape}`,
    description: `${goal} for ${customer.company}, a ${customer.domain} business. Core scope covers ${features}.`,
    budgetMin: `${budget}.00`,
    budgetMax: `${budget * 2}.00`,
    status,
    planningStatus,
    projectType: shape,
    domain: customer.domain,
    mainGoal: goal + '.',
    targetUsers: `${customer.company} customers and the team running the service.`,
    coreFeatures: features,
    platforms: index % 3 === 0 ? 'web' : 'web, mobile',
    requiredSkills: [
      ...pick(ARCHITECT_ONLY, index, 3),
      ...pick(UIUX_ONLY, index, 3),
      ...pick(BACKEND_ONLY, index, 3),
      ...pick(FRONTEND_ONLY, index, 3),
    ],
    deadlineDays: 30 + (index % 10) * 12,
  };
});

const ALL_PROJECTS = [...PROJECTS, ...GENERATED_PROJECTS];

// Every top freelancer carries the platform's full domain vocabulary, taken
// from the project list itself. projectFit is a BM25 rank over the brief text
// with required skills deliberately excluded, so without this a specialist can
// score a literal zero on a brief that simply does not use their words.
const DOMAIN_VOCAB = Array.from(
  new Set(
    ALL_PROJECTS.flatMap((p) => `${p.projectType} ${p.domain} ${p.coreFeatures}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 1)),
  ),
).join(', ');

// --- Helpers ----------------------------------------------------------------

// Best-effort profile embedding so the dense arm of matching contributes.
// Returns null when the AI service is unreachable; matching then falls back to
// lexical relevance on its own.
async function embed(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(`${AI_URL}/agents/generate-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, dimensions: DIMENSIONS }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { embedding?: number[] };
    return Array.isArray(data.embedding) && data.embedding.length === DIMENSIONS
      ? data.embedding
      : null;
  } catch {
    return null;
  }
}

// Empties every application table. typeorm_migrations is preserved so the
// schema stays at its current version and no migration is re-run.
async function wipe(): Promise<number> {
  const rows = await dataSource.query<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename <> 'typeorm_migrations'`,
  );
  if (!rows.length) return 0;
  const list = rows.map((row) => `"${row.tablename}"`).join(', ');
  await dataSource.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  return rows.length;
}

async function createUser(data: {
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  password: string;
}): Promise<User> {
  const users = dataSource.getRepository(User);
  return users.save(
    users.create({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      isEmailVerified: true,
      isIdVerified: true,
      hashedPassword: await bcrypt.hash(data.password, 10),
    }),
  );
}

async function createFreelancer(seed: FreelancerSeed): Promise<void> {
  const profiles = dataSource.getRepository(FreelancerProfile);
  const skillScores = dataSource.getRepository(FreelancerSkillScore);

  const user = await createUser({
    email: seed.email,
    firstName: seed.firstName,
    lastName: seed.lastName,
    role: UserRole.FREELANCER,
    password: PASSWORD,
  });

  const now = new Date();
  const profile = await profiles.save(
    profiles.create({
      userId: user.id,
      headline: seed.headline,
      bio: seed.isTop
        ? `${seed.bio} Delivered across: ${DOMAIN_VOCAB}.`
        : seed.bio,
      skills: seed.skills,
      githubUsername: seed.githubUsername,
      yearsExperience: seed.yearsExperience,
      hourlyRate: seed.hourlyRate,
      hourlyRateCurrency: 'EGP',
      availabilityHoursPerWeek: seed.availabilityHoursPerWeek,
      isAvailable: true,
      verificationStatus: 'approved',
      approvedAt: now,
      assessmentScore: seed.assessmentScore,
      assessmentSubmittedAt: now,
      performanceScore: seed.performanceScore,
      completedTasks: seed.approvedSubmissions,
      approvedSubmissions: seed.approvedSubmissions,
      rejectedSubmissions: seed.rejectedSubmissions,
      onTimeDeliveries: seed.onTimeDeliveries,
      lateDeliveries: seed.lateDeliveries,
      missedDeadlines: seed.missedDeadlines,
      projectRemovals: 0,
      riskFlags: [],
      avgRating: seed.avgRating,
      ratingsCount: seed.ratingsCount,
      // The reranker reads principalReviewerHourlyRate (not hourlyRate) when it
      // ranks the principal_reviewer role, so it has to be set low as well.
      principalReviewerStatus: seed.principalReviewer ? 'approved' : 'not_applied',
      principalReviewerAppliedAt: seed.principalReviewer ? now : null,
      principalReviewerReviewedAt: seed.principalReviewer ? now : null,
      principalReviewerHourlyRate: seed.principalReviewer
        ? seed.skillScore === 5.0
          ? '18.00'
          : `${40 + seed.yearsExperience}.00`
        : null,
      principalReviewerMaxProjects: 3, // DB constraint caps this at 3
      principalReviewerQualification: seed.principalReviewer
        ? { eligibleToApply: true, source: 'seed', reviewedAt: now.toISOString() }
        : null,
    }),
  );

  await skillScores.save(
    seed.skills.map((skill) =>
      skillScores.create({
        freelancerProfileId: profile.id,
        userId: user.id,
        skill,
        score: seed.skillScore.toFixed(2),
        confidence: '0.95',
        source: 'seed',
      }),
    ),
  );

  const sourceText = `${seed.headline}\n${profile.bio}\nSkills: ${seed.skills.join(', ')}`;
  const vector = await embed(sourceText);
  if (vector) {
    await dataSource.query(
      `INSERT INTO freelancer_profile_embeddings
         (freelancer_profile_id, embedding_model, source_text, dimensions, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (freelancer_profile_id, embedding_model)
       DO UPDATE SET embedding = EXCLUDED.embedding, source_text = EXCLUDED.source_text`,
      [profile.id, EMBEDDING_MODEL, sourceText, DIMENSIONS, `[${vector.join(',')}]`],
    );
  }
}

// --- Entry point ------------------------------------------------------------

async function run() {
  if (!process.argv.includes('--yes')) {
    console.error(
      'Refusing to run: this deletes every row in the database.\n' +
        'Re-run with --yes once you are sure DATABASE_URL points at the right database.',
    );
    process.exitCode = 1;
    return;
  }

  await dataSource.initialize();
  const freelancersOnly = process.argv.includes('--freelancers-only');

  const target = (process.env.DATABASE_URL ?? '').replace(/\/\/[^@]*@/, '//***@');
  console.log(`Target database: ${target}`);

  const cleared = await wipe();
  console.log(`Wiped ${cleared} tables.`);

  if (!freelancersOnly) {
    await createUser({
      ...ADMIN,
      role: UserRole.ADMIN,
      password: ADMIN.password,
    });
  }

  for (const seed of TOP) {
    await createFreelancer(seed);
  }
  const pool = buildPool(POOL_SIZE);
  for (const seed of pool) {
    await createFreelancer(seed);
  }

  if (!freelancersOnly) {
    const projects = dataSource.getRepository(Project);
    const briefs = dataSource.getRepository(Brief);
    const customers: User[] = [];
    for (const customer of ALL_CUSTOMERS) {
      customers.push(
        await createUser({
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          role: UserRole.CUSTOMER,
          password: PASSWORD,
        }),
      );
    }

    for (const seed of ALL_PROJECTS) {
      const project = await projects.save(
        projects.create({
          customerId: customers[seed.customerIndex].id,
          title: seed.title,
          description: seed.description,
          budgetMin: seed.budgetMin,
          budgetMax: seed.budgetMax,
          currency: 'EGP',
          deadline: new Date(
            Date.now() + seed.deadlineDays * 24 * 60 * 60 * 1000,
          ),
          isDeadlineFlexible: seed.deadlineDays > 60,
          status: seed.status,
          planningStatus: seed.planningStatus,
        }),
      );

      await briefs.save(
        briefs.create({
          projectId: project.id,
          isComplete: true,
          completedAt: new Date(),
          completionPercentage: 100,
          missingFields: [],
          summary: seed.description,
          briefText: `${seed.description} Core features: ${seed.coreFeatures}.`,
          projectType: seed.projectType,
          domain: seed.domain,
          mainGoal: seed.mainGoal,
          targetUsers: seed.targetUsers,
          coreFeatures: seed.coreFeatures,
          platforms: seed.platforms,
          requiredSkills: seed.requiredSkills.join(', '),
        }),
      );
    }
  }

  const freelancerCount = TOP.length + pool.length;
  console.log('\nSeeded:');
  if (!freelancersOnly) {
    console.log(`  1 admin        ${ADMIN.email} / ${ADMIN.password}`);
  }
  console.log(`  ${freelancerCount} freelancers  (${TOP.length} top-rated, ${pool.length} supporting pool)`);
  console.log(`  ${freelancersOnly ? 0 : ALL_CUSTOMERS.length} customers`);
  console.log(
    `  ${freelancersOnly ? 0 : ALL_PROJECTS.length} projects with completed briefs`,
  );
  console.log(`\nAll seeded accounts use the password: ${PASSWORD}`);
  console.log('\nTop-rated freelancers:');
  for (const seed of TOP) {
    console.log(`  ${seed.email.padEnd(32)} ${seed.githubUsername}`);
  }
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });
