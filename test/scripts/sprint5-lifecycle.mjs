const base = process.env.API_BASE ?? 'http://127.0.0.1:3301/api';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { token, method = 'GET', body, expected } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (expected !== undefined) {
    assert(response.status === expected, `${method} ${path}: expected ${expected}, got ${response.status}: ${text}`);
  } else {
    assert(response.ok, `${method} ${path}: ${response.status}: ${text}`);
  }
  return { status: response.status, payload };
}

async function login(email, password) {
  const { payload } = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  assert(typeof payload.accessToken === 'string', `No access token for ${email}`);
  return payload.accessToken;
}

async function waitFor(label, probe, accept, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await probe();
    if (accept(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out; last value: ${JSON.stringify(last)}`);
}

function evidenceFor(requirements, artifactUrl) {
  return Object.fromEntries(
    requirements.map((requirement) => [
      requirement.key,
      {
        summary: `Release verification evidence for ${requirement.title}: the submitted contract defines the required behavior, ownership, error cases, and implementation handoff.`,
        urls: requirement.requiresUrl ? [artifactUrl] : [],
      },
    ]),
  );
}

const health = await request('/health');
assert(health.payload.status === 'ok', 'Backend readiness is not healthy');

const [admin, architect, designer] = await Promise.all([
  login('admin@nexus-ai.local', 'Admin@123456'),
  login('arch.nour@nexus-ai.local', 'Freelancer@123456'),
  login('ux.mariam@nexus-ai.local', 'Freelancer@123456'),
]);

const projects = (await request('/admin/projects?limit=100', { token: admin })).payload.data;
const project = projects.find((item) => item.title === 'Bakery ecommerce app');
assert(project, 'Seed project not found');

const freelancers = (await request('/admin/freelancers?limit=100', { token: admin })).payload.data;
const architectProfile = freelancers.find((item) => (item.user?.email ?? item.email) === 'arch.nour@nexus-ai.local');
const designerProfile = freelancers.find((item) => (item.user?.email ?? item.email) === 'ux.mariam@nexus-ai.local');
assert(architectProfile && designerProfile, 'Seed freelancer profiles not found');

const architectureAssignment = (await request(`/projects/${project.id}/role-assignments`, {
  token: admin,
  method: 'POST',
  body: {
    phase: 'planning',
    roleKey: 'architect',
    freelancerProfileId: architectProfile.id,
    decisionReason: 'Sprint 5 release verification',
  },
})).payload.data;
await request(`/projects/${project.id}/role-assignments`, {
  token: admin,
  method: 'POST',
  body: {
    phase: 'planning',
    roleKey: 'ui_ux',
    freelancerProfileId: architectProfile.id,
    decisionReason: 'Independence invariant verification',
  },
  expected: 409,
});

const designAssignment = (await request(`/projects/${project.id}/role-assignments`, {
  token: admin,
  method: 'POST',
  body: {
    phase: 'planning',
    roleKey: 'ui_ux',
    freelancerProfileId: designerProfile.id,
    decisionReason: 'Sprint 5 release verification',
  },
})).payload.data;

for (const [assignment, token] of [[architectureAssignment, architect], [designAssignment, designer]]) {
  await request(`/project-role-assignments/${assignment.id}/status`, {
    token,
    method: 'PATCH',
    body: { status: 'accepted' },
  });
  await request(`/project-role-assignments/${assignment.id}/status`, {
    token,
    method: 'PATCH',
    body: { status: 'in_progress' },
  });
}

await request(`/projects/${project.id}/planning-requirements/architecture`, {
  token: designer,
  expected: 403,
});

const architectureRequirements = (await request(
  `/projects/${project.id}/planning-requirements/architecture`,
  { token: architect },
)).payload.data;
const designRequirements = (await request(
  `/projects/${project.id}/planning-requirements/ui_ux`,
  { token: designer },
)).payload.data;
assert(architectureRequirements.requirements.length >= 11, 'Architecture requirement contract is incomplete');
assert(designRequirements.requirements.length >= 11, 'UI/UX requirement contract is incomplete');
assert(designRequirements.architectureApproved === false, 'UI/UX unexpectedly reports an approved architecture');

const artifactUrl = 'https://example.com/nexus-sprint-5-release-artifact';
const designSubmission = (await request(`/projects/${project.id}/planning-submissions`, {
  token: designer,
  method: 'POST',
  body: {
    assignmentId: designAssignment.id,
    submissionType: 'ui_ux',
    status: 'submitted',
    title: 'Bakery UI/UX implementation handoff',
    summary: 'Responsive flows, wireframes, design system, states, and API mappings.',
    content: { requirementEvidence: evidenceFor(designRequirements.requirements, artifactUrl) },
    fileUrls: { designSource: artifactUrl },
  },
})).payload.data;
assert(designSubmission.evaluationDispatch.status === 'pending_architecture', 'UI/UX must wait for architecture approval');

await request(`/planning-submissions/${designSubmission.id}/review`, {
  token: admin,
  method: 'PATCH',
  body: { status: 'approved' },
  expected: 409,
});

const architectureSubmission = (await request(`/projects/${project.id}/planning-submissions`, {
  token: architect,
  method: 'POST',
  body: {
    assignmentId: architectureAssignment.id,
    submissionType: 'architecture',
    status: 'submitted',
    title: 'Bakery architecture and API contract',
    summary: 'System boundaries, endpoint contracts, schema, security, deployment, and integration handoff.',
    content: { requirementEvidence: evidenceFor(architectureRequirements.requirements, artifactUrl) },
    fileUrls: { architectureDocument: artifactUrl },
  },
})).payload.data;
assert(architectureSubmission.evaluationDispatch.status === 'queued', 'Architecture evaluation was not queued');

const evaluatedArchitecture = await waitFor(
  'architecture evaluation',
  async () => (await request(`/planning-submissions/${architectureSubmission.id}`, { token: admin })).payload.data,
  (item) => item.evaluationStatus === 'completed',
);
assert(evaluatedArchitecture.evaluationRecommendation === 'approve', 'Architecture evaluation did not recommend approval');
assert(evaluatedArchitecture.evaluationResult.checks.every((check) => check.status === 'met'), 'Architecture has unmet AI checks');
assert(evaluatedArchitecture.evaluationAuditBundle?.summaryMarkdown, 'Architecture audit summary was not persisted');
assert(evaluatedArchitecture.evaluationAuditBundle?.verdictSha256, 'Architecture verdict hash was not persisted');

const architectureReview = (await request(`/planning-submissions/${architectureSubmission.id}/review`, {
  token: admin,
  method: 'PATCH',
  body: { status: 'approved', adminNotes: 'Release flow approval.' },
})).payload.data;
assert(architectureReview.uiuxEvaluationJob.status === 'queued', 'Architecture approval did not queue waiting UI/UX evaluation');
assert(architectureReview.planGenerationUnlocked === false, 'Plan unlocked before UI/UX approval');

const evaluatedDesign = await waitFor(
  'UI/UX evaluation',
  async () => (await request(`/planning-submissions/${designSubmission.id}`, { token: admin })).payload.data,
  (item) => item.evaluationStatus === 'completed',
);
assert(evaluatedDesign.evaluationRecommendation === 'approve', 'UI/UX evaluation did not recommend approval');
assert(evaluatedDesign.evaluationResult.checks.every((check) => check.status === 'met'), 'UI/UX has unmet AI checks');
assert(evaluatedDesign.evaluationAuditBundle?.artifactManifestHash, 'UI/UX artifact audit was not persisted');

const designReview = (await request(`/planning-submissions/${designSubmission.id}/review`, {
  token: admin,
  method: 'PATCH',
  body: { status: 'approved', adminNotes: 'Release flow approval.' },
})).payload.data;
assert(designReview.planGenerationUnlocked === true, 'Both approvals did not unlock plan generation');
assert(designReview.planGenerationJob.queued === true, 'Automatic plan generation was not queued');

const generatedPlan = await waitFor(
  'automatic project plan generation',
  async () => {
    const response = await request(`/projects/${project.id}/plans?isCurrent=true`, { token: admin });
    return response.payload.data[0];
  },
  (item) => item?.status === 'generated',
);

const planReview = (await request(`/project-plans/${generatedPlan.id}/review`, {
  token: admin,
  method: 'PATCH',
  body: { status: 'approved', materialize: true, adminNotes: 'Verified release plan.' },
})).payload.data;
const materialization = planReview.materialization;
assert(materialization.milestoneCount > 0, 'No milestones were materialized');
assert(materialization.taskCount > 0, 'No tasks were materialized');

const milestones = (await request(`/projects/${project.id}/milestones`, { token: admin })).payload.data;
const tasks = (await request(`/projects/${project.id}/tasks?limit=100`, { token: admin })).payload;
const runs = (await request(`/projects/${project.id}/matching/runs?targetType=task&limit=100`, { token: admin })).payload;
const finalProject = (await request('/admin/projects?limit=100', { token: admin })).payload.data.find((item) => item.id === project.id);
assert(milestones.length === materialization.milestoneCount, 'Milestone read model disagrees with materialization');
assert(tasks.total === materialization.taskCount, 'Task read model disagrees with materialization');
assert(runs.total === materialization.taskCount, 'Implementation matching did not start once per task');
assert(finalProject.status === 'matching', `Unexpected final project status: ${finalProject.status}`);

console.log(JSON.stringify({
  status: 'passed',
  projectId: project.id,
  architectureSubmissionId: architectureSubmission.id,
  uiuxSubmissionId: designSubmission.id,
  planId: generatedPlan.id,
  milestoneCount: materialization.milestoneCount,
  taskCount: materialization.taskCount,
  matchingRunCount: runs.total,
  finalProjectStatus: finalProject.status,
}, null, 2));

