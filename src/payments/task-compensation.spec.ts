import { calculateTaskCompensation } from './task-compensation';

describe('calculateTaskCompensation', () => {
  const originalRates = process.env.CURRENCY_RATES_PER_USD;

  beforeEach(() => {
    process.env.CURRENCY_RATES_PER_USD = 'USD:1,EGP:50,EUR:0.92,GBP:0.79';
  });

  afterAll(() => {
    if (originalRates == null) {
      delete process.env.CURRENCY_RATES_PER_USD;
    } else {
      process.env.CURRENCY_RATES_PER_USD = originalRates;
    }
  });

  it('uses the assignment-time rate snapshot and converts it to the task currency', () => {
    expect(
      calculateTaskCompensation({
        budgetAmount: '3000.00',
        penaltyAmount: '100.00',
        estimatedHours: '5.00',
        hourlyRateSnapshot: '10.00',
        hourlyRateCurrencySnapshot: 'USD',
        payoutCurrency: 'EGP',
      }),
    ).toEqual({
      amount: 2400,
      allocatedAmount: 2900,
      earnedAmount: 2400,
      usedRateSnapshot: true,
    });
  });

  it('caps snapshot earnings at the funded task allocation', () => {
    expect(
      calculateTaskCompensation({
        budgetAmount: 1000,
        penaltyAmount: 0,
        estimatedHours: 10,
        hourlyRateSnapshot: 200,
        hourlyRateCurrencySnapshot: 'EGP',
        payoutCurrency: 'EGP',
      }).amount,
    ).toBe(1000);
  });

  it('uses the remaining allocation for a legacy task without a snapshot', () => {
    expect(
      calculateTaskCompensation({
        budgetAmount: 1000,
        penaltyAmount: 125,
        estimatedHours: 10,
        hourlyRateSnapshot: null,
        hourlyRateCurrencySnapshot: null,
        payoutCurrency: 'EGP',
      }),
    ).toEqual({
      amount: 875,
      allocatedAmount: 875,
      earnedAmount: null,
      usedRateSnapshot: false,
    });
  });
});
