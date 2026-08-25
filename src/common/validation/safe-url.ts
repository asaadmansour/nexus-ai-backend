/**
 * Evidence URLs are submitted by freelancers and rendered as clickable links in
 * the reviewer, customer and admin views (`evidence-list.tsx` passes them
 * straight into `<a href=...>`). A `javascript:` URL was accepted and stored
 * verbatim, so anyone clicking that link would run the submitter's script in
 * their own session. See ISSUES.md #29.
 *
 * Only schemes that are safe to put behind a link are allowed.
 */
export const ALLOWED_URL_SCHEMES = ['http:', 'https:'];

export function isSafeUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    return ALLOWED_URL_SCHEMES.includes(new URL(trimmed).protocol);
  } catch {
    return false;
  }
}

/**
 * Walks a submitted URL payload and returns every value that is not a safe
 * absolute URL, so the caller can reject with a message naming the offenders.
 * Handles the nested shapes actually used (`{screenshots: [...], attachments:
 * [...]}`) as well as flat `{key: url}` maps.
 */
export function collectUnsafeUrls(
  payload: unknown,
  path = 'fileUrls',
  found: string[] = [],
): string[] {
  if (payload == null) return found;

  if (typeof payload === 'string') {
    if (!isSafeUrl(payload)) found.push(`${path}: "${payload.slice(0, 80)}"`);
    return found;
  }

  if (Array.isArray(payload)) {
    payload.forEach((entry, index) =>
      collectUnsafeUrls(entry, `${path}[${index}]`, found),
    );
    return found;
  }

  if (typeof payload === 'object') {
    for (const [key, value] of Object.entries(
      payload as Record<string, unknown>,
    )) {
      collectUnsafeUrls(value, `${path}.${key}`, found);
    }
    return found;
  }

  found.push(`${path}: not a URL`);
  return found;
}
