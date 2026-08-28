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
  'implementation/task-01-backend-dispatch.md',
  'implementation/task-02-customer-web.md',
  'implementation/task-03-dispatch-console.md',
  'implementation/task-04-integration-quality.md',
];

// The role decides the workstream first, because both web workstreams are
// staffed by the same frontend role and only the title separates them.
function workstreamFor(task) {
  const role = (task.roleKey ?? '').toLowerCase();
  const title = (task.title ?? '').toLowerCase();
  const depot = /dispatch|depot|console|board|run|driver|manager|staff|admin/;
  if (/backend|api|data/.test(role)) return workstreams[0];
  if (/qa|test|devops|release|integration/.test(role)) return workstreams[3];
  if (/frontend|ui|web/.test(role))
    return depot.test(title) ? workstreams[2] : workstreams[1];
  if (/backend|api|database|outbox/.test(title)) return workstreams[0];
  if (depot.test(title)) return workstreams[2];
  if (/customer|booking|tracking|shipment|web/.test(title))
    return workstreams[1];
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
    'No configured freelancer has an assigned CargoLink task yet. Approve/materialize the Scrum plan, complete implementation matching, and accept task invitations first.',
  );
}
