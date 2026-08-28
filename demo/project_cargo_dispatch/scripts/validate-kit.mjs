import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { kitRoot, readKitJson, readKitText } from './lib.mjs';

const requiredFiles = [
  'FLOW.md',
  'client/project.json',
  'client/requirements-message.txt',
  'planning/architecture-submission.md',
  'planning/architecture-answers.json',
  'planning/architecture-diagram.mmd',
  'planning/uiux-submission.md',
  'planning/uiux-answers.json',
  'planning/uiux-prototype.html',
  'implementation/task-01-backend-dispatch.md',
  'implementation/task-02-customer-web.md',
  'implementation/task-03-dispatch-console.md',
  'implementation/task-04-integration-quality.md',
  'scripts/00-ready-planning-answers.mjs',
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
const requiredAnswerKeys = {
  architecture: [
    'system_context',
    'architecture_diagram',
    'technology_stack',
    'module_boundaries',
    'api_contract',
    'data_model',
    'integrations',
    'non_functional',
    'deployment_observability',
    'implementation_handoff',
    'project_feature_coverage',
  ],
  uiux: [
    'design_source',
    'information_architecture',
    'user_flows',
    'screen_designs',
    'clickable_prototype',
    'screen_states',
    'responsive_accessibility',
    'design_system',
    'api_data_mapping',
    'asset_handoff',
    'project_feature_coverage',
  ],
};
for (const [type, keys] of Object.entries(requiredAnswerKeys)) {
  const file =
    type === 'architecture'
      ? 'planning/architecture-answers.json'
      : 'planning/uiux-answers.json';
  const answers = await readKitJson(file);
  for (const key of keys) {
    if (
      typeof answers[key]?.summary !== 'string' ||
      answers[key].summary.length < 80
    ) {
      throw new Error(`${file} needs a substantive answer for ${key}`);
    }
  }
}
if (project.deadlineDays < 28 || project.deadlineDays > 60) {
  throw new Error('Demo deadline must remain small-to-medium (28-60 days).');
}
console.log('CargoLink demo kit is complete and internally consistent.');
