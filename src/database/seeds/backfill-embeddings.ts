import 'dotenv/config';
import dataSource from '../data-source';
import { FreelancerProfile } from 'src/freelancers/entities/freelancer-profile.entity';
import { FreelancerSkillScore } from 'src/freelancers/entities/freelancer-skill-score.entity';

// One-off / repeatable backfill: generate a profile embedding for every approved
// freelancer that is missing one (e.g. approved before the embedding pipeline
// existed, or whose embedding job failed). Mirrors the production pipeline's
// source-text and model so backfilled embeddings match ones the app generates.

const AI_URL = process.env.AI_SERVICE_URL ?? 'http://localhost:8000';
const EMBEDDING_MODEL = 'nexus-freelancer-profile-v1';
const PROVIDER_MODEL = 'gemini-embedding-001';
const DIMENSIONS = 1024;

async function embed(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${AI_URL}/agents/generate-embedding`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        dimensions: DIMENSIONS,
        model: PROVIDER_MODEL,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { embedding?: number[] };
    return Array.isArray(data.embedding) && data.embedding.length === DIMENSIONS
      ? data.embedding
      : null;
  } catch {
    return null;
  }
}

function profileSummaryText(summary: Record<string, unknown> | null): string | null {
  if (!summary) return null;
  if (typeof summary.profileSummary === 'string') return summary.profileSummary.trim();
  if (typeof summary.summary === 'string') return summary.summary.trim();
  return null;
}

function buildSourceText(
  profile: FreelancerProfile,
  skillScores: FreelancerSkillScore[],
): string {
  const userName = [profile.user?.firstName, profile.user?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const summary = profileSummaryText(profile.summary);
  const skillRatings = skillScores
    .slice(0, 50)
    .map(
      (s) =>
        `${s.skill}: ${s.score}/5${s.confidence ? `, confidence ${s.confidence}` : ''}`,
    )
    .join('\n');

  const sections = [
    userName ? `Freelancer: ${userName}` : null,
    profile.headline ? `Headline: ${profile.headline}` : null,
    profile.bio ? `Bio: ${profile.bio}` : null,
    profile.yearsExperience != null
      ? `Years of experience: ${profile.yearsExperience}`
      : null,
    profile.availabilityHoursPerWeek != null
      ? `Availability: ${profile.availabilityHoursPerWeek} hours per week`
      : null,
    profile.hourlyRate ? `Hourly rate: ${profile.hourlyRate}` : null,
    profile.assessmentScore ? `Assessment score: ${profile.assessmentScore}` : null,
    profile.skills?.length ? `CV skills: ${profile.skills.join(', ')}` : null,
    summary ? `Assessment profile summary: ${summary}` : null,
    skillRatings ? `Assessed skill ratings:\n${skillRatings}` : null,
  ].filter((section): section is string => Boolean(section && section.trim()));

  return sections.join('\n\n').slice(0, 8000);
}

async function main() {
  await dataSource.initialize();
  const profileRepo = dataSource.getRepository(FreelancerProfile);
  const skillScoreRepo = dataSource.getRepository(FreelancerSkillScore);

  const profiles = await profileRepo
    .createQueryBuilder('p')
    .leftJoinAndSelect('p.user', 'u')
    .where('p.verificationStatus = :approved', { approved: 'approved' })
    .andWhere('p.deletedAt IS NULL')
    .andWhere(
      'NOT EXISTS (SELECT 1 FROM freelancer_profile_embeddings e WHERE e.freelancer_profile_id = p.id)',
    )
    .getMany();

  console.log(`Approved freelancers missing an embedding: ${profiles.length}`);
  let done = 0;
  let skipped = 0;

  for (const profile of profiles) {
    const skillScores = await skillScoreRepo.find({
      where: { freelancerProfileId: profile.id },
      order: { score: 'DESC', skill: 'ASC' },
    });
    const sourceText = buildSourceText(profile, skillScores);
    if (!sourceText.trim()) {
      skipped += 1;
      console.log(`  skip ${profile.id} (no profile text to embed)`);
      continue;
    }

    const vector = await embed(sourceText);
    if (!vector) {
      skipped += 1;
      console.log(`  FAILED ${profile.id} (embedding call failed)`);
      continue;
    }

    await dataSource.query(
      `INSERT INTO freelancer_profile_embeddings
         (freelancer_profile_id, embedding_model, source_text, dimensions, embedding)
       VALUES ($1, $2, $3, $4, $5::vector)
       ON CONFLICT (freelancer_profile_id, embedding_model)
       DO UPDATE SET embedding = EXCLUDED.embedding, source_text = EXCLUDED.source_text`,
      [profile.id, EMBEDDING_MODEL, sourceText, DIMENSIONS, `[${vector.join(',')}]`],
    );
    done += 1;
    console.log(`  embedded ${profile.id}`);
  }

  console.log(`\nBackfilled ${done} embedding(s), skipped ${skipped}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
  });
