import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { kitRoot, readKitJson, readKitText } from './lib.mjs';

const requiredFiles = [
  'FLOW.md',
  'client/project.json',
  'client/requirements-message.txt',
  'planning/architecture-submission.md',
  'planning/uiux-submission.md',
  'implementation/task-01-backend-scheduling.md',
  'implementation/task-02-patient-web.md',
  'implementation/task-03-staff-dashboard.md',
  'implementation/task-04-integration-quality.md',
];

for (const file of requiredFiles) await access(resolve(kitRoot, file));
const project = await readKitJson('client/project.json');
const requirements = await readKitText('client/requirements-message.txt');
const requiredLabels = [
  'Main goal:',
  'Target users:',
  'Core features:',
  'Platforms:',
  'Solution type:',
  'Scope details:',
  'Integrations:',
  'Admin needs:',
  'Deliverables:',
  'Suggested team size: 4',
];
for (const label of requiredLabels) {
  if (!requirements.includes(label)) throw new Error(`Missing ${label}`);
}
if (project.deadlineDays < 28 || project.deadlineDays > 60) {
  throw new Error('Demo deadline must remain small-to-medium (28-60 days).');
}
console.log('QuickClinic demo kit is complete and internally consistent.');
