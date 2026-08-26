export const PRICEABLE_BRIEF_FIELDS = [
  'mainGoal',
  'targetUsers',
  'coreFeatures',
  'platforms',
  'solutionType',
  'scopeDetails',
  'integrations',
  'adminNeeds',
  'deliverables',
] as const;

export type PriceableBriefField = (typeof PRICEABLE_BRIEF_FIELDS)[number];

const UNCERTAIN_ANSWERS = new Set([
  'idk',
  'i do not know',
  "i don't know",
  'i dont know',
  'not sure',
  'not sure yet',
  'notsure',
  'unknown',
  'whatever',
  'anything',
  'you choose',
  'you decide',
  'no idea',
  'not decided',
  'no preference',
  'no preferences',
  'tbd',
]);

const QUESTION_PREFIX =
  /^(?:what|which|why|how|who|when|where|can\s+you|could\s+you|should\s+i|do\s+i|does\s+it|explain|tell\s+me\s+about|like\s+what)\b/i;

export function getBriefScopeGaps(
  fields: Record<string, unknown> | null | undefined,
): PriceableBriefField[] {
  const values = fields ?? {};
  return PRICEABLE_BRIEF_FIELDS.filter(
    (field) => !isBriefScopeFieldComplete(field, values[field]),
  );
}

export function isBriefScopeFieldComplete(
  field: PriceableBriefField,
  value: unknown,
): boolean {
  const items = normalizedItems(value);
  if (
    items.length === 0 ||
    items.every(field === 'mainGoal' ? isUncertainText : isNonAnswerText)
  ) {
    return false;
  }

  switch (field) {
    case 'mainGoal':
      return items.some(
        (item) =>
          item.length >= 8 &&
          !item.includes('?') &&
          /\b(?:sell|buy|book|manage|track|show|display|explain|describe|collect|inform|market|promote|reduce|automate|help|allow|enable|connect|order|reserve|schedule|learn|contact|generate|receive|share|find|compare|request|provide|present|grow|increase|improve|showcase|advertise|streamline|digitize|engage|support|serve)\b/i.test(
            item,
          ),
      );
    case 'targetUsers':
      return items.some(
        (item) =>
          !/^(?:user|users|people|everyone|anyone|all|general public|not sure)$/i.test(
            item,
          ),
      );
    case 'coreFeatures':
      return items.some(
        (item) =>
          !/^(?:app|website|mobile website|mobile app|platform|system|basic features?|standard features?|everything|something simple)$/i.test(
            item,
          ),
      );
    case 'platforms':
      return items.some((item) =>
        /\b(?:website|web app|web|ios|android|mobile app|native app|desktop|tablet|responsive)\b/i.test(
          item,
        ),
      );
    case 'solutionType':
      return items.some((item) =>
        /\b(?:landing page|single[- ]page|marketing website|multi[- ]page|responsive website|website|web app|mobile app|native app|ios|android|desktop app|portal|dashboard)\b/i.test(
          item,
        ),
      );
    case 'scopeDetails':
      return (
        (items.length >= 2 && items.every((item) => !isNonAnswerText(item))) ||
        items.some(hasConcreteScopeDetail)
      );
    case 'integrations':
      return items.some(
        (item) =>
          isExplicitNone(item) ||
          /\b(?:payment|stripe|paypal|paymob|map|google|email|sms|whatsapp|social login|analytics|api|webhook|crm|erp|existing system|calendar|shipping|delivery|storage)\b/i.test(
            item,
          ),
      );
    case 'adminNeeds':
      return items.some(
        (item) =>
          isExplicitNone(item) ||
          /\b(?:admin|dashboard|back office|manage|moderate|report|content|orders?|users?|inventory|bookings?)\b/i.test(
            item,
          ),
      );
    case 'deliverables':
      return items.some((item) =>
        /\b(?:working|website|web app|mobile app|ios|android|source code|repository|design|figma|prototype|deployment|live link|documentation|handover|setup)\b/i.test(
          item,
        ),
      );
  }
}

export function isRequirementsGuidanceRequest(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const normalized = normalize(value);
  if (!normalized) return false;
  if (isNonAnswerText(normalized)) return true;
  return (
    normalized.includes('?') ||
    QUESTION_PREFIX.test(normalized) ||
    /\b(?:what do (?:you|u) suggest|recommend|suggest|help me (?:choose|decide)|what do you mean|i don'?t understand|not familiar with|can you explain|could you explain|please explain)\b/i.test(
      normalized,
    )
  );
}

export function isUncertainAnswer(value: unknown): boolean {
  const items = normalizedItems(value);
  return items.length > 0 && items.every(isUncertainText);
}

export function removeNonAnswerItems(value: unknown): unknown {
  if (Array.isArray(value)) {
    const filtered = value.filter(
      (item) => typeof item !== 'string' || !isNonAnswerText(normalize(item)),
    );
    return filtered.length > 0 ? filtered : null;
  }
  if (typeof value === 'string' && isNonAnswerText(normalize(value))) {
    return null;
  }
  return value;
}

function normalizedItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizedItems(item));
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [String(value)];
  }
  if (typeof value !== 'string') return [];
  return value
    .split(/,|;|\n/gi)
    .map(normalize)
    .filter(Boolean);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isNonAnswerText(value: string): boolean {
  return (
    !value ||
    isUncertainText(value) ||
    value.includes('?') ||
    QUESTION_PREFIX.test(value)
  );
}

function isUncertainText(value: string): boolean {
  return !value || UNCERTAIN_ANSWERS.has(value);
}

function isExplicitNone(value: string): boolean {
  return /^(?:none|no|not needed|n\/?a|no integrations?|no admin(?: dashboard| area)?)$/i.test(
    value,
  );
}

function hasConcreteScopeDetail(value: string): boolean {
  if (value.length < 8 || isNonAnswerText(value)) return false;
  if (
    /\b(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|single|several|few)\s+(?:page|pages|screen|screens|section|sections|step|steps)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  const concreteMarkers = value.match(
    /\b(?:home|about|contact|pricing|signup|sign up|login|browse|search|catalog|product|cart|checkout|booking|profile|dashboard|order|track|upload|form|content|gallery|faq|journey|workflow)\b/gi,
  );
  return (concreteMarkers?.length ?? 0) >= 2;
}
