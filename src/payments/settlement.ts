import type { PaymentMethod, SettlementOperation } from '../generated/prisma/enums.js';

const financialFeeBps = 500;
const convenienceFeeBps = 1000;
const processingRates: Record<SettlementOperation, number> = {
  PIX: 120,
  DEBIT: 120,
  CREDIT: 299,
  ANTICIPATED_CREDIT: 499,
};

export function calculateSettlement(amountMinor: number, method: PaymentMethod, creditAdvance: boolean) {
  const operation: SettlementOperation = method === 'PIX' ? 'PIX'
    : method === 'DEBIT_CARD' ? 'DEBIT'
    : creditAdvance ? 'ANTICIPATED_CREDIT' : 'CREDIT';
  const processingFeeBps = processingRates[operation];
  const gross = BigInt(amountMinor);
  const fee = (bps: number) => Number((gross * BigInt(bps) + 5_000n) / 10_000n);
  const serviceFeeMinor = fee(financialFeeBps + convenienceFeeBps);
  const financialFeeMinor = fee(financialFeeBps);
  const processingFeeMinor = fee(processingFeeBps);

  return {
    operation, financialFeeBps, convenienceFeeBps, processingFeeBps, financialFeeMinor, processingFeeMinor,
    convenienceFeeMinor: serviceFeeMinor - financialFeeMinor,
    netMinor: amountMinor - serviceFeeMinor - processingFeeMinor,
  };
}
