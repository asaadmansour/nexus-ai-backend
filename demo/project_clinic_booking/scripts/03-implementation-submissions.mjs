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
const accounts = env('IMPLEMENTATION_ACCOUNTS')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const separator = entry.indexOf(':');
    if (separator < 1)
      throw new Error(`Invalid implementation account: ${entry}`);
    return {
      email: entry.slice(0, separator),
      password: entry.slice(separator + 1),
    };
  });

const workstreams = [
  'implementation/task-01-backend-scheduling.md',
  'implementation/task-02-patient-web.md',
  'implementation/task-03-staff-dashboard.md',
  'implementation/task-04-integration-quality.md',
];

function workstreamFor(task) {
  const text = `${task.roleKey ?? ''} ${task.title ?? ''}`.toLowerCase();
  if (/backend|api|database|availability|appointment/.test(text))
    return workstreams[0];
  if (/patient|frontend|web|booking/.test(text)) return workstreams[1];
  if (/staff|admin|dashboard|queue|manager/.test(text)) return workstreams[2];
  return workstreams[3];
}

let taskCount = 0;
for (const account of accounts) {
  const token = await login(account.email, account.password);
  const response = await request('/freelancer/tasks?limit=100', { token });
  const tasks = response.data.filter((task) => task.projectId === projectId);
  for (const task of tasks) {
    taskCount += 1;
    const document = workstreamFor(task);
    const markdown = await readKitText(document);
    const payload = {
      taskId: task.id,
      ...(task.milestoneId ? { milestoneId: task.milestoneId } : {}),
      submissionType: 'text',
      title: `${task.title} implementation evidence`,
      summary: markdown.slice(0, 1900),
      content: {
        taskContract: task,
        evidenceChecklist: markdown,
        note: 'Replace demo URLs with the real commit, CI run, and pull request before final review.',
      },
      fileUrls: { demoWorkstream: artifactUrl(document) },
      status: 'submitted',
    };
    const safeName = `${account.email}-${task.id}`.replace(
      /[^a-zA-Z0-9.-]/g,
      '_',
    );
    const outputPath = await writeOutput(`${safeName}.json`, payload);
    console.log(`Wrote ${outputPath}`);
    if (shouldSubmit) {
      const created = await request(`/projects/${projectId}/submissions`, {
        token,
        method: 'POST',
        body: payload,
      });
      console.log(`Submitted task ${task.id}: ${created.data.id}`);
    }
  }
}

if (!taskCount) {
  throw new Error(
    'No configured freelancer has an assigned QuickClinic task yet. Approve/materialize the Scrum plan, complete implementation matching, and accept task invitations first.',
  );
}
