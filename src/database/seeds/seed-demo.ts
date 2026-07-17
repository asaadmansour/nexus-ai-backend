import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import dataSource from '../data-source';
import { UserRole } from 'src/common/enums/user-role.enum';
import { ProjectStatus } from 'src/common/enums/project-status.enum';
import { User } from 'src/users/entities/user.entity';
import { Project } from 'src/projects/entities/project.entity';
import { Brief } from 'src/projects/entities/brief.entity';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerSkillScore } from 'src/freelancers/entities/freelancer-skill-score.entity';

// Demo data so the admin can immediately run planning matching and see ranked
// candidates. Idempotent: re-running upserts by email/title and resets the
// project back to `brief_complete` so matching can be started again.

const CUSTOMER = {
  email: 'customer@nexus-ai.local',
  password: 'Customer@123456',
  firstName: 'Bakery',
  lastName: 'Owner',
};

const FREELANCER_PASSWORD = 'Freelancer@123456';
const PROJECT_TITLE = 'Bakery ecommerce app';

type FreelancerSeed = {
  email: string;
  firstName: string;
  lastName: string;
  headline: string;
  bio: string;
  skills: string[];
  yearsExperience: number;
  hourlyRate: string;
  availabilityHoursPerWeek: number;
  assessmentScore: string;
  skillScores: { skill: string; score: string }[];
};

const FREELANCERS: FreelancerSeed[] = [
  {
    email: 'arch.nour@nexus-ai.local',
    firstName: 'Nour',
    lastName: 'Ahmed',
    headline: 'Backend architect',
    bio: 'Backend engineer specializing in ecommerce catalog, checkout, and inventory systems.',
    skills: ['NestJS', 'PostgreSQL', 'System Design', 'API Design'],
    yearsExperience: 6,
    hourlyRate: '25.00',
    availabilityHoursPerWeek: 25,
    assessmentScore: '92.00',
    skillScores: [
      { skill: 'NestJS', score: '4.80' },
      { skill: 'PostgreSQL', score: '4.60' },
      { skill: 'System Design', score: '4.70' },
      { skill: 'API Design', score: '4.40' },
    ],
  },
  {
    email: 'arch.omar@nexus-ai.local',
    firstName: 'Omar',
    lastName: 'Khaled',
    headline: 'Senior systems architect',
    bio: 'Senior architect for scalable ecommerce and fintech platforms.',
    skills: ['System Design', 'PostgreSQL', 'NestJS', 'Security'],
    yearsExperience: 8,
    hourlyRate: '32.00',
    availabilityHoursPerWeek: 18,
    assessmentScore: '88.00',
    skillScores: [
      { skill: 'System Design', score: '4.90' },
      { skill: 'PostgreSQL', score: '4.70' },
      { skill: 'NestJS', score: '4.30' },
      { skill: 'Security', score: '4.50' },
    ],
  },
  {
    email: 'ux.mariam@nexus-ai.local',
    firstName: 'Mariam',
    lastName: 'Ali',
    headline: 'Product designer',
    bio: 'Product designer with strong ecommerce catalog and checkout UX experience.',
    skills: ['Figma', 'Design Systems', 'User Flows', 'Ecommerce UX', 'Accessibility'],
    yearsExperience: 5,
    hourlyRate: '22.00',
    availabilityHoursPerWeek: 30,
    assessmentScore: '90.00',
    skillScores: [
      { skill: 'Figma', score: '4.90' },
      { skill: 'Design Systems', score: '4.60' },
      { skill: 'User Flows', score: '4.50' },
      { skill: 'Ecommerce UX', score: '4.40' },
    ],
  },
  {
    email: 'ux.hana@nexus-ai.local',
    firstName: 'Hana',
    lastName: 'Youssef',
    headline: 'UI/UX designer',
    bio: 'UI/UX designer focused on ecommerce storefronts and mobile checkout flows.',
    skills: ['Figma', 'User Flows', 'Ecommerce UX', 'Accessibility'],
    yearsExperience: 4,
    hourlyRate: '20.00',
    availabilityHoursPerWeek: 28,
    assessmentScore: '84.00',
    skillScores: [
      { skill: 'Figma', score: '4.50' },
      { skill: 'User Flows', score: '4.30' },
      { skill: 'Ecommerce UX', score: '4.20' },
    ],
  },
];

const AI_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';
const EMBEDDING_MODEL = 'gemini-embedding-001';

// Generate a profile embedding via the AI service so the dense (semantic) arm of
// matching contributes. Best-effort: returns null if the AI service is down.
async function embed(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${AI_URL}/agents/generate-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, dimensions: 1024 }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: number[] };
    return Array.isArray(data.embedding) && data.embedding.length
      ? data.embedding
      : null;
  } catch {
    return null;
  }
}

async function upsertUser(
  repo: Repository<User>,
  data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: UserRole;
  },
): Promise<User> {
  const hashedPassword = await bcrypt.hash(data.password, 10);
  const existing = await repo.findOne({
    where: { email: data.email },
    withDeleted: true,
  });
  if (existing) {
    existing.firstName = data.firstName;
    existing.lastName = data.lastName;
    existing.role = data.role;
    existing.isEmailVerified = true;
    existing.isIdVerified = true;
    existing.hashedPassword = hashedPassword;
    existing.deletedAt = null;
    return repo.save(existing);
  }
  return repo.save(
    repo.create({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      isEmailVerified: true,
      isIdVerified: true,
      hashedPassword,
    }),
  );
}

async function seedDemo() {
  await dataSource.initialize();

  const userRepo = dataSource.getRepository(User);
  const projectRepo = dataSource.getRepository(Project);
  const briefRepo = dataSource.getRepository(Brief);
  const profileRepo = dataSource.getRepository(FreelancerProfile);
  const skillScoreRepo = dataSource.getRepository(FreelancerSkillScore);

  // 1. Customer
  const customer = await upsertUser(userRepo, {
    ...CUSTOMER,
    role: UserRole.CUSTOMER,
  });

  // 2. Project (reset to brief_complete so matching can be started again)
  let project = await projectRepo.findOne({
    where: { customerId: customer.id, title: PROJECT_TITLE },
  });
  const projectData = {
    customerId: customer.id,
    title: PROJECT_TITLE,
    description:
      'Sell bakery products online with a catalog, cart, checkout, and an inventory dashboard.',
    budgetMin: '5000.00',
    budgetMax: '12000.00',
    currency: 'EGP',
    deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    isDeadlineFlexible: false,
    status: ProjectStatus.BRIEF_COMPLETE,
    planningStatus: 'not_started',
  };
  project = project
    ? await projectRepo.save(Object.assign(project, projectData))
    : await projectRepo.save(projectRepo.create(projectData));

  // 3. Completed brief
  let brief = await briefRepo.findOne({ where: { projectId: project.id } });
  const briefData = {
    projectId: project.id,
    isComplete: true,
    completedAt: new Date(),
    completionPercentage: 100,
    missingFields: [],
    summary:
      'Bakery ecommerce with catalog, cart, checkout, and an inventory dashboard.',
    briefText:
      'Customer wants a bakery ecommerce website and mobile app with a product catalog, shopping cart, checkout with online payment, and an inventory dashboard for stock and sales.',
    projectType: 'ecommerce',
    domain: 'bakery',
    mainGoal: 'Sell online and track stock and sales.',
    targetUsers: 'Existing bakery customers of all ages.',
    coreFeatures: 'catalog, cart, checkout, inventory dashboard',
    platforms: 'web, mobile',
    requiredSkills:
      'NestJS, PostgreSQL, System Design, Figma, Design Systems, Ecommerce UX',
  };
  brief = brief
    ? await briefRepo.save(Object.assign(brief, briefData))
    : await briefRepo.save(briefRepo.create(briefData));

  // 4. Approved freelancers + skill scores + profile embeddings
  let embeddedCount = 0;
  for (const seed of FREELANCERS) {
    const user = await upsertUser(userRepo, {
      email: seed.email,
      password: FREELANCER_PASSWORD,
      firstName: seed.firstName,
      lastName: seed.lastName,
      role: UserRole.FREELANCER,
    });

    let profile = await profileRepo.findOne({ where: { userId: user.id } });
    const profileData = {
      userId: user.id,
      headline: seed.headline,
      bio: seed.bio,
      skills: seed.skills,
      yearsExperience: seed.yearsExperience,
      hourlyRate: seed.hourlyRate,
      availabilityHoursPerWeek: seed.availabilityHoursPerWeek,
      isAvailable: true,
      verificationStatus: 'approved',
      approvedAt: new Date(),
      assessmentScore: seed.assessmentScore,
    };
    profile = profile
      ? await profileRepo.save(Object.assign(profile, profileData))
      : await profileRepo.save(profileRepo.create(profileData));

    await skillScoreRepo.delete({ freelancerProfileId: profile.id });
    await skillScoreRepo.save(
      seed.skillScores.map((entry) =>
        skillScoreRepo.create({
          freelancerProfileId: profile!.id,
          userId: user.id,
          skill: entry.skill,
          score: entry.score,
          confidence: '0.90',
          source: 'seed',
        }),
      ),
    );

    // Profile embedding for the dense arm (semantic relevance to the brief).
    const sourceText = `${seed.headline}\n${seed.bio}\nSkills: ${seed.skills.join(', ')}`;
    const vector = await embed(sourceText);
    if (vector) {
      await dataSource.query(
        `INSERT INTO freelancer_profile_embeddings
           (freelancer_profile_id, embedding_model, source_text, dimensions, embedding)
         VALUES ($1, $2, $3, $4, $5::vector)
         ON CONFLICT (freelancer_profile_id, embedding_model)
         DO UPDATE SET embedding = EXCLUDED.embedding, source_text = EXCLUDED.source_text`,
        [profile.id, EMBEDDING_MODEL, sourceText, 1024, `[${vector.join(',')}]`],
      );
      embeddedCount += 1;
    }
  }

  const apiBase = process.env.API_BASE ?? 'http://localhost:3000/api';
  console.log('\nDemo data seeded.');
  console.log(`  Customer:    ${CUSTOMER.email} / ${CUSTOMER.password}`);
  console.log(`  Freelancers: ${FREELANCERS.map((f) => f.email).join(', ')}`);
  console.log(`               (password: ${FREELANCER_PASSWORD})`);
  console.log(`  Embeddings:  ${embeddedCount}/${FREELANCERS.length} generated (dense arm)`);
  console.log(`  Project:     "${PROJECT_TITLE}" — status brief_complete`);
  console.log(`  Project ID:  ${project.id}`);
  console.log('\nStart matching (copy–paste this whole block into a terminal):\n');
  console.log(
    `TOKEN=$(curl -s -X POST ${apiBase}/auth/login -H 'Content-Type: application/json' ` +
      `-d '{"email":"admin@nexus-ai.local","password":"Admin@123456"}' ` +
      `| sed -n 's/.*"accessToken":"\\([^"]*\\)".*/\\1/p') && \\\n` +
      `echo "token length: \${#TOKEN}" && \\\n` +
      `curl -s -X POST ${apiBase}/projects/${project.id}/matching/planning-roles ` +
      `-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' ` +
      `-d '{"roles":["architect","ui_ux"]}'; echo`,
  );
  console.log(
    '\nThen refresh http://localhost:3001/dashboard/admin/matching — the runs will be there.\n',
  );
}

seedDemo()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });
