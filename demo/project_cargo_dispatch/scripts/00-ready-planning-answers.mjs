import { artifactUrl, readKitJson, writeOutput } from './lib.mjs';

const sets = [
  {
    name: 'architecture',
    file: 'planning/architecture-answers.json',
  },
  {
    name: 'uiux',
    file: 'planning/uiux-answers.json',
  },
];

const titles = {
  api_contract: 'API and event contracts',
  api_data_mapping: 'Architecture and API mapping',
  architecture_diagram: 'Architecture diagram',
  asset_handoff: 'Developer handoff',
  clickable_prototype: 'Clickable prototype',
  data_model: 'Data model',
  deployment_observability: 'Deployment and operations',
  design_source: 'Design source and screen inventory',
  design_system: 'Proportionate design rules',
  implementation_handoff: 'Implementation and integration handoff',
  information_architecture: 'Information architecture',
  integrations: 'External integrations',
  module_boundaries: 'Modules and ownership boundaries',
  non_functional: 'Proportionate non-functional requirements',
  project_feature_coverage: 'Confirmed feature coverage',
  responsive_accessibility: 'Responsive and accessibility rules',
  screen_designs: 'Implementation-ready screen designs',
  screen_states: 'Relevant screen and component states',
  system_context: 'System context and scope',
  technology_stack: 'Technology stack and decisions',
  user_flows: 'Primary user flows',
};

for (const set of sets) {
  const answers = await readKitJson(set.file);
  const sections = Object.entries(answers).map(([key, answer], index) => {
    const title =
      titles[key] ??
      key
        .split('_')
        .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
        .join(' ');
    const urls = (answer.artifacts ?? []).map(artifactUrl);
    return [
      `## ${index + 1}. ${title}`,
      '',
      '### Evidence and implementation details',
      '',
      answer.summary,
      '',
      '### Evidence URLs',
      '',
      urls.length ? urls.join('\n') : '(Optional - leave blank)',
    ].join('\n');
  });
  const output = await writeOutput(
    `${set.name}-ready-form-answers.md`,
    `# CargoLink ${set.name} ready form answers\n\n${sections.join('\n\n')}`,
  );
  console.log(`Wrote ${output}`);
}
