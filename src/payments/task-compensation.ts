import { convertAmount } from 'src/common/currency/currency';

type MoneyValue = number | string | null | undefined;

export interface TaskCompensationInput {
  budgetAmount: MoneyValue;
  penaltyAmount: MoneyValue;
  estimatedHours: MoneyValue;
  hourlyRateSnapshot: MoneyValue;
  hourlyRateCurrencySnapshot: string | null | undefined;
  payoutCurrency: string | null | undefined;
}

export interface TaskCompensationResult {
  amount: number;
  allocatedAmount: number;
  earnedAmount: number | null;
  usedRateSnapshot: boolean;
}

const finiteNumber = (value: MoneyValue): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const roundMoney = (value: number) => Math.round(value * 100) / 100;

/**
 * Calculates an implementation payout from the contract snapshot captured at
 * assignment. The task allocation remains a hard cap and deadline penalties
 * reduce both the allocation and the earned amount.
 *
 * Legacy tasks without a usable snapshot fall back to their remaining
 * allocation; they never consult the freelancer's mutable profile.
 */
export function calculateTaskCompensation(
  input: TaskCompensationInput,
): TaskCompensationResult {
  const budget = finiteNumber(input.budgetAmount) ?? 0;
  const penalty = Math.max(finiteNumber(input.penaltyAmount) ?? 0, 0);
  const allocatedAmount = Math.max(roundMoney(budget - penalty), 0);
  const rate = finiteNumber(input.hourlyRateSnapshot);
  const hours = finiteNumber(input.estimatedHours);

  const convertedRate =
    rate != null &&
    rate > 0 &&
    hours != null &&
    hours > 0 &&
    input.hourlyRateCurrencySnapshot &&
    input.payoutCurrency
      ? convertAmount(
          rate,
          input.hourlyRateCurrencySnapshot,
          input.payoutCurrency,
        )
      : null;

  const earnedAmount =
    convertedRate != null &&
    Number.isFinite(convertedRate) &&
    convertedRate > 0 &&
    hours != null
      ? Math.max(roundMoney(convertedRate * hours - penalty), 0)
      : null;

  return {
    amount:
      earnedAmount == null
        ? allocatedAmount
        : Math.min(earnedAmount, allocatedAmount),
    allocatedAmount,
    earnedAmount,
    usedRateSnapshot: earnedAmount != null,
  };
}
