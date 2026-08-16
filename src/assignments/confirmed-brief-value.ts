const LOW_INFORMATION_VALUES = new Set([
  'idk',
  'i dont know',
  'dont know',
  'do not know',
  'not sure',
  'unsure',
  'no idea',
  'unknown',
  'na',
  'not applicable',
  'not specified',
  'tbd',
  'to be decided',
  'like what',
  'what do you mean',
]);

function canonical(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/\//g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[?.!,;:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Prevents unanswered or clarification-seeking client text being presented
 * to freelancers as a confirmed requirement. */
export function confirmedBriefValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = canonical(trimmed);
  if (LOW_INFORMATION_VALUES.has(normalized)) return null;
  if (/^(like what|what do you mean)(\s+[a-z0-9]+){0,2}$/.test(normalized)) {
    return null;
  }
  return trimmed;
}
