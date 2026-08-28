import {
  env,
  loadKitEnv,
  login,
  readKitJson,
  readKitText,
  request,
} from './lib.mjs';

await loadKitEnv();

const definition = await readKitJson('client/project.json');
const requirements = await readKitText('client/requirements-message.txt');
const customerToken = await login(
  env('CUSTOMER_EMAIL'),
  env('CUSTOMER_PASSWORD'),
);

const projectsResponse = await request('/projects', { token: customerToken });
let project = projectsResponse?.data?.find(
  (item) => item.title === definition.title,
);

if (!project) {
  const deadline = new Date(
    Date.now() + definition.deadlineDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const created = await request('/projects', {
    token: customerToken,
    method: 'POST',
    body: {
      title: definition.title,
      description: definition.description,
      budgetMin: definition.budgetMin,
      budgetMax: definition.budgetMax,
      currency: definition.currency,
      deadline,
      isDeadlineFlexible: definition.isDeadlineFlexible,
    },
  });
  project = created.data;
  console.log(`Created project ${project.id}`);
} else {
  console.log(`Using existing project ${project.id}`);
}

let brief = await request(`/projects/${project.id}/brief`, {
  token: customerToken,
});
if (!brief.isComplete && !brief.data?.isComplete) {
  await request(`/projects/${project.id}/brief/messages`, {
    token: customerToken,
    method: 'POST',
    body: { content: requirements.trim() },
  });
  brief = await request(`/projects/${project.id}/brief`, {
    token: customerToken,
  });
}

const current = brief.data ?? brief;
if (!current.isComplete) {
  throw new Error(
    `Requirements intake is still incomplete. Missing: ${(
      current.missingFields ?? []
    ).join(', ')}`,
  );
}

if ((process.env.DEMO_CONFIRM_BRIEF ?? 'false').toLowerCase() === 'true') {
  await request(`/projects/${project.id}/brief/confirm`, {
    token: customerToken,
    method: 'POST',
  });
  console.log(
    'Confirmed the completed brief and started the real downstream flow.',
  );
} else {
  console.log(
    'Brief is complete but unconfirmed. Review it in the client UI first.',
  );
}

console.log(`DEMO_PROJECT_ID=${project.id}`);
