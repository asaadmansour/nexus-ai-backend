import {
  artifactUrl,
  env,
  hasFlag,
  loadKitEnv,
  login,
  readKitText,
  request,
  resolveProjectId,
  writeOutput,
} from './lib.mjs';

await loadKitEnv();
const projectId = await resolveProjectId();
const shouldSubmit = hasFlag('--submit');

const roles = [
  {
    roleKey: 'architect',
    type: 'architecture',
    email: env('ARCHITECT_EMAIL'),
    password: env('ARCHITECT_PASSWORD'),
    title: 'QuickClinic architecture and API contract',
    document: 'planning/architecture-submission.md',
  },
  {
    roleKey: 'ui_ux',
    type: 'ui_ux',
    email: env('UIUX_EMAIL'),
    password: env('UIUX_PASSWORD'),
    title: 'QuickClinic UI/UX implementation handoff',
    document: 'planning/uiux-submission.md',
  },
];

for (const role of roles) {
  const token = await login(role.email, role.password);
  let detail;
  try {
    detail = await request(`/freelancer/projects/${projectId}/assignment`, {
      token,
    });
  } catch (error) {
    throw new Error(
      `${role.roleKey} is not assigned yet. Complete principal review, planning funding, and the ${role.roleKey} invitation first. ${error.message}`,
    );
  }
  const assignment = detail.data.assignments.find(
    (item) => item.roleKey === role.roleKey,
  );
  if (!assignment)
    throw new Error(`No active ${role.roleKey} assignment found.`);

  const contract = await request(
    `/projects/${projectId}/planning-requirements/${role.type}`,
    { token },
  );
  const markdown = await readKitText(role.document);
  const handoffUrl = artifactUrl(role.document);
  const requirementEvidence = Object.fromEntries(
    contract.data.requirements.map((requirement) => [
      requirement.key,
      {
        summary: `${requirement.title} is addressed in the QuickClinic handoff with project-specific decisions, states, ownership, and verification evidence.`,
        urls: requirement.requiresUrl ? [handoffUrl] : [],
      },
    ]),
  );
  const payload = {
    assignmentId: assignment.id,
    submissionType: role.type,
    status: 'submitted',
    title: role.title,
    summary: markdown.slice(0, 1900),
    content: {
      documentMarkdown: markdown,
      requirementEvidence,
      demoProject: 'project_clinic_booking',
    },
    fileUrls: { handoff: handoffUrl },
  };
  const outputPath = await writeOutput(`${role.type}-submission.json`, payload);
  console.log(`Wrote ${outputPath}`);

  if (shouldSubmit) {
    const created = await request(
      `/projects/${projectId}/planning-submissions`,
      {
        token,
        method: 'POST',
        body: payload,
      },
    );
    console.log(`Submitted ${role.type}: ${created.data.id}`);
  }
}
