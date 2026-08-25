/**
 * Currency conversion for rate and budget comparisons.
 *
 * Freelancer rates and project budgets are held in different currencies, and
 * before this existed the two were compared as bare numbers — an EGP budget
 * against a USD rate. See ISSUES.md #9.
 *
 * Rates are expressed per one unit of BASE_CURRENCY and are configuration, not
 * constants: a stale hardcoded exchange rate is exactly what produced the 18.6x
 * mispricing in #18. Set CURRENCY_RATES_PER_USD to override, e.g.
 * "USD:1,EGP:48.5,EUR:0.92".
 */
export const BASE_CURRENCY = 'USD';

const DEFAULT_RATES_PER_BASE: Record<string, number> = {
  USD: 1,
  EGP: 48.5,
  EUR: 0.92,
  GBP: 0.79,
};

export function ratesPerBase(): Record<string, number> {
  const raw = (process.env.CURRENCY_RATES_PER_USD ?? '').trim();
  if (!raw) return { ...DEFAULT_RATES_PER_BASE };

  const rates = { ...DEFAULT_RATES_PER_BASE };
  for (const entry of raw.split(',')) {
    const [code, value] = entry.split(':');
    const parsed = Number(value);
    if (code && Number.isFinite(parsed) && parsed > 0) {
      rates[code.trim().toUpperCase()] = parsed;
    }
  }
  return rates;
}

export function normalizeCurrency(currency?: string | null): string {
  const code = (currency ?? '').trim().toUpperCase();
  return code || BASE_CURRENCY;
}

/** Returns null when either currency has no configured rate — never guesses. */
export function convertAmount(
  amount: number,
  from?: string | null,
  to?: string | null,
): number | null {
  const source = normalizeCurrency(from);
  const target = normalizeCurrency(to);
  if (source === target) return amount;

  const rates = ratesPerBase();
  const fromRate = rates[source];
  const toRate = rates[target];
  if (!fromRate || !toRate) return null;

  return (amount / fromRate) * toRate;
}

/**
 * SQL fragment converting a per-hour rate column into `targetCurrency`, so the
 * comparison happens in one unit. Returns the fragment plus the parameters it
 * needs. Currencies with no configured rate are excluded, which makes those
 * rows fail the comparison rather than pass it on a wrong unit.
 */
export function rateInCurrencySql(
  rateColumn: string,
  currencyColumn: string,
  targetCurrency: string,
  paramPrefix = 'fx',
): { sql: string; params: Record<string, number> } {
  const rates = ratesPerBase();
  const target = normalizeCurrency(targetCurrency);
  const targetRate = rates[target];
  const params: Record<string, number> = {};

  if (!targetRate) {
    return { sql: rateColumn, params };
  }

  const branches: string[] = [];
  for (const [code, rate] of Object.entries(rates)) {
    const key = `${paramPrefix}_${code.toLowerCase()}`;
    params[key] = targetRate / rate;
    branches.push(`WHEN '${code}' THEN ${rateColumn} * :${key}`);
  }

  return {
    sql: `(CASE ${currencyColumn} ${branches.join(' ')} ELSE NULL END)`,
    params,
  };
}
