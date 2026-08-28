import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const kitRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function loadKitEnv() {
  try {
    const source = await readFile(resolve(kitRoot, '.env'), 'utf8');
    for (const line of source.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const separator = trimmed.indexOf('=');
      if (separator < 1) continue;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed
        .slice(separator + 1)
        .trim()
        .replace(/^(['"])(.*)\1$/, '$2');
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function env(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!value) throw new Error(`Missing ${name}. Add it to ${kitRoot}/.env.`);
  return value;
}

export function apiBase() {
  return env('API_BASE', 'http://127.0.0.1:3301/api').replace(/\/$/, '');
}

export async function request(path, options = {}) {
  const response = await fetch(`${apiBase()}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined
        ? {}
        : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const raw = await response.text();
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    payload = raw;
  }
  if (!response.ok) {
    const message =
      payload?.message ?? payload?.error ?? raw ?? 'Unknown API error';
    throw new Error(
      `${options.method ?? 'GET'} ${path} returned ${response.status}: ${
        Array.isArray(message) ? message.join(', ') : message
      }`,
    );
  }
  return payload;
}

export async function login(email, password) {
  const payload = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (!payload?.accessToken)
    throw new Error(`Login returned no token for ${email}`);
  return payload.accessToken;
}

export async function readKitText(relativePath) {
  return readFile(resolve(kitRoot, relativePath), 'utf8');
}

export async function readKitJson(relativePath) {
  return JSON.parse(await readKitText(relativePath));
}

export async function writeOutput(fileName, value) {
  const output = resolve(kitRoot, 'output');
  await mkdir(output, { recursive: true });
  const path = resolve(output, fileName);
  const content =
    typeof value === 'string'
      ? `${value.trimEnd()}\n`
      : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, content);
  return path;
}

export async function resolveProjectId() {
  if (process.env.DEMO_PROJECT_ID?.trim())
    return process.env.DEMO_PROJECT_ID.trim();
  const project = await readKitJson('client/project.json');
  const token = await login(env('ADMIN_EMAIL'), env('ADMIN_PASSWORD'));
  const response = await request('/admin/projects?limit=100', { token });
  const match = response?.data?.find((item) => item.title === project.title);
  if (!match?.id) {
    throw new Error(
      `Project "${project.title}" was not found. Run npm run demo:cargo:intake first.`,
    );
  }
  return match.id;
}

export function artifactUrl(relativePath) {
  return `https://raw.githubusercontent.com/asaadmansour/nexus-ai-backend/dev/demo/project_cargo_dispatch/${relativePath}`;
}

export function hasFlag(flag) {
  return process.argv.slice(2).includes(flag);
}
