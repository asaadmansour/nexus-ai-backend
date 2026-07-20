import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import dataSource from '../data-source';
import { UserRole } from 'src/common/enums/user-role.enum';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerSkillScore } from 'src/freelancers/entities/freelancer-skill-score.entity';
import { User } from 'src/users/entities/user.entity';

const EMAIL = 'uiux.topmatch@nexus-ai.local';
const PASSWORD = 'Freelancer@123456';
const AI_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';
const EMBEDDING_MODEL = 'nexus-freelancer-profile-v1';
const PROVIDER_MODEL = 'gemini-embedding-001';
const DIMENSIONS = 1024;

const skillScores = [
  ['Figma', '5.00'],
  ['Design Systems', '5.00'],
  ['User Flows', '5.00'],
  ['Wireframing', '4.95'],
  ['Prototyping', '4.95'],
  ['UI Design', '4.95'],
  ['UX Research', '4.90'],
  ['Accessibility', '4.90'],
  ['Ecommerce UX', '5.00'],
  ['Responsive Design', '4.95'],
] as const;

const profileSeed = {
  firstName: 'Lina',
  lastName: 'Nassar',
  headline: 'Senior UI/UX designer for ecommerce checkout and design systems',
  bio: 'Senior UI/UX designer focused on ecommerce storefronts, bakery and retail catalog experiences, cart and checkout flows, mobile-first responsive design, accessibility, and developer-ready Figma design systems.',
  skills: [
    'Figma',
    'Design Systems',
    'User Flows',
    'Wireframing',
    'Prototyping',
    'UI Design',
    'UX Research',
    'Accessibility',
    'Ecommerce UX',
    'Responsive Design',
    'Checkout UX',
    'Product Catalog UX',
    'Mobile App Design',
  ],
  yearsExperience: 9,
  hourlyRate: '14.00',
  availabilityHoursPerWeek: 40,
  assessmentScore: '98.00',
};

async function embed(text: string): Promise<number[] | null> {
  try {
    const response = await fetch(`${AI_URL}/agents/generate-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        dimensions: DIMENSIONS,
        model: PROVIDER_MODEL,
      }),
    });

    if (!response.ok) {
      console.warn(
        `Embedding request failed: ${response.status} ${await response.text()}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      embedding?: unknown;
      model?: string;
      dimensions?: number;
    };
    if (
      !Array.isArray(data.embedding) ||
      data.embedding.length !== DIMENSIONS
    ) {
      console.warn('Embedding response did not contain a 1024-d vector.');
      return null;
    }

    const vector = data.embedding.map((value) => Number(value));
    return vector.every((value) => Number.isFinite(value)) ? vector : null;
  } catch (error) {
    console.warn(
      `Embedding request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

async function upsertUser() {
  const users = dataSource.getRepository(User);
  const hashedPassword = await bcrypt.hash(PASSWORD, 10);
  const existing = await users.findOne({
    where: { email: EMAIL },
    withDeleted: true,
  });

  if (existing) {
    existing.firstName = profileSeed.firstName;
    existing.lastName = profileSeed.lastName;
    existing.role = UserRole.FREELANCER;
    existing.isEmailVerified = true;
    existing.isIdVerified = true;
    existing.hashedPassword = hashedPassword;
    existing.deletedAt = null;
    return users.save(existing);
  }

  return users.save(
    users.create({
      firstName: profileSeed.firstName,
      lastName: profileSeed.lastName,
      email: EMAIL,
      role: UserRole.FREELANCER,
      isEmailVerified: true,
      isIdVerified: true,
      hashedPassword,
    }),
  );
}

function buildSourceText(profile: FreelancerProfile) {
  const skillRatings = skillScores
    .map(([skill, score]) => `${skill}: ${score}/5, confidence 0.98`)
    .join('\n');

  return [
    `Freelancer: ${profileSeed.firstName} ${profileSeed.lastName}`,
    `Headline: ${profile.headline}`,
    `Bio: ${profile.bio}`,
    `Years of experience: ${profile.yearsExperience}`,
    `Availability: ${profile.availabilityHoursPerWeek} hours per week`,
    `Hourly rate: ${profile.hourlyRate}`,
    `Assessment score: ${profile.assessmentScore}`,
    `CV skills: ${profileSeed.skills.join(', ')}`,
    'Assessment profile summary: Lina is a top UI/UX planning candidate for ecommerce, bakery, retail, catalog, cart, checkout, payment, mobile app, responsive web, and admin-dashboard design work. She produces user flows, wireframes, prototypes, accessibility notes, and developer-ready Figma design systems for Scrum planning.',
    `Assessed skill ratings:\n${skillRatings}`,
  ].join('\n\n');
}

async function seedUiuxTopMatch() {
  await dataSource.initialize();

  const profileRepo = dataSource.getRepository(FreelancerProfile);
  const skillScoreRepo = dataSource.getRepository(FreelancerSkillScore);

  const user = await upsertUser();
  let profile = await profileRepo.findOne({ where: { userId: user.id } });
  const profileData = {
    userId: user.id,
    cvUrl: 'https://res.cloudinary.com/demo/raw/upload/uiux-top-match-cv.pdf',
    cvExtractionStatus: 'completed',
    cvExtractedAt: new Date(),
    assessmentGenerationStatus: 'ready',
    assessmentGeneratedAt: new Date(),
    headline: profileSeed.headline,
    bio: profileSeed.bio,
    skills: profileSeed.skills,
    yearsExperience: profileSeed.yearsExperience,
    hourlyRate: profileSeed.hourlyRate,
    availabilityHoursPerWeek: profileSeed.availabilityHoursPerWeek,
    summary: {
      profileSummary:
        'Top UI/UX ecommerce planner with excellent evidence across Figma, design systems, user flows, accessibility, mobile-first checkout, product catalog UX, and developer handoff.',
      source: 'seed',
    },
    isAvailable: true,
    verificationStatus: 'approved',
    approvedAt: new Date(),
    rejectedAt: null,
    rejectionReason: null,
    assessmentScore: profileSeed.assessmentScore,
    assessmentSubmittedAt: new Date(),
  };

  profile = profile
    ? await profileRepo.save(Object.assign(profile, profileData))
    : await profileRepo.save(profileRepo.create(profileData));

  await skillScoreRepo.delete({ freelancerProfileId: profile.id });
  await skillScoreRepo.save(
    skillScores.map(([skill, score]) =>
      skillScoreRepo.create({
        freelancerProfileId: profile.id,
        userId: user.id,
        skill,
        score,
        confidence: '0.98',
        evidence: `${profileSeed.firstName} scored ${score}/5 in ${skill} and has ecommerce planning evidence.`,
        source: 'seed',
      }),
    ),
  );

  const sourceText = buildSourceText(profile);
  const vector = await embed(sourceText);
  if (vector) {
    await dataSource.query(
      `INSERT INTO freelancer_profile_embeddings
         (freelancer_profile_id, embedding_model, source_text, dimensions, embedding, metadata)
       VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)
       ON CONFLICT (freelancer_profile_id, embedding_model)
       DO UPDATE SET
         embedding = EXCLUDED.embedding,
         source_text = EXCLUDED.source_text,
         dimensions = EXCLUDED.dimensions,
         metadata = EXCLUDED.metadata`,
      [
        profile.id,
        EMBEDDING_MODEL,
        sourceText,
        DIMENSIONS,
        `[${vector.join(',')}]`,
        JSON.stringify({
          source: 'seed-uiux-top-match',
          providerModel: PROVIDER_MODEL,
          reason: 'demo_top_uiux_match',
        }),
      ],
    );
  }

  const embeddingCount = await dataSource.query<{ count: string }[]>(
    `SELECT COUNT(*)::int AS count
     FROM freelancer_profile_embeddings
     WHERE freelancer_profile_id = $1`,
    [profile.id],
  );

  console.log('Seeded top UI/UX freelancer.');
  console.log(`  Email:      ${EMAIL}`);
  console.log(`  Password:   ${PASSWORD}`);
  console.log(`  Profile ID: ${profile.id}`);
  console.log(`  Status:     ${profile.verificationStatus}`);
  console.log(`  Skills:     ${skillScores.length} high UI/UX scores`);
  console.log(`  Embeddings: ${embeddingCount[0]?.count ?? 0}`);
}

seedUiuxTopMatch()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  });
