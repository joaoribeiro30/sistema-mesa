import type { Prisma } from '../generated/prisma/client.js';
import type { SettlementOperation } from '../generated/prisma/enums.js';

type SettlementTotals = {
  grossMinor: string;
  financialFeeMinor: string;
  convenienceFeeMinor: string;
  processingFeeMinor: string;
  netMinor: string;
  paymentCount: number;
};
type SettlementGroup = SettlementTotals & { operation: SettlementOperation | null; isTotal: boolean };

export async function eventSettlementTotals(tx: Prisma.TransactionClient, eventId: string) {
  const [total, ...groups] = await tx.$queryRaw<[SettlementGroup, ...SettlementGroup[]]>`
    SELECT settlement.operation, grouping(settlement.operation) = 1 AS "isTotal",
      count(*)::integer AS "paymentCount",
      coalesce(sum(payment.amount_minor), 0)::text AS "grossMinor",
      coalesce(sum(settlement.financial_fee_minor), 0)::text AS "financialFeeMinor",
      coalesce(sum(settlement.convenience_fee_minor), 0)::text AS "convenienceFeeMinor",
      coalesce(sum(settlement.processing_fee_minor), 0)::text AS "processingFeeMinor",
      coalesce(sum(settlement.net_minor), 0)::text AS "netMinor"
    FROM payments AS payment
    JOIN reservations AS reservation ON reservation.id = payment.reservation_id
    LEFT JOIN payment_settlements AS settlement ON settlement.payment_id = payment.id
    WHERE reservation.event_id = ${eventId}::uuid AND reservation.status = 'CONFIRMED' AND payment.status = 'SUCCEEDED'
    GROUP BY GROUPING SETS ((), (settlement.operation))
    ORDER BY "isTotal" DESC, settlement.operation
  `;
  const { isTotal: _total, operation: _operation, ...totals } = total;
  const unclassified = groups.find(({ operation }) => operation === null);
  return {
    totals,
    unclassifiedGrossMinor: unclassified?.grossMinor ?? '0',
    unclassifiedPaymentCount: unclassified?.paymentCount ?? 0,
    byOperation: groups.flatMap(({ isTotal, operation, ...amounts }) => operation === null ? [] : [{ operation, ...amounts }]),
  };
}

const timeZone = 'America/Sao_Paulo';
const localDate = new Intl.DateTimeFormat('pt-BR', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });

// Use UTC midnight only to do calendar arithmetic after extracting the local date.
function calendarDate(instant: Date) {
  const { year, month, day } = Object.fromEntries(localDate.formatToParts(instant).map(({ type, value }) => [type, value]));
  return new Date(`${year!.padStart(4, '0')}-${month}-${day}T00:00:00Z`);
}

export function eventSettlementSchedule(createdAt: Date, endsAt: Date) {
  const final = calendarDate(endsAt);
  let businessDays = 0;
  while (businessDays < 2) {
    final.setUTCDate(final.getUTCDate() + 1);
    const weekday = final.getUTCDay();
    if (weekday >= 1 && weekday <= 5) businessDays++;
  }

  const weeklyDates: string[] = [];
  for (const date = calendarDate(createdAt); date < final; date.setUTCDate(date.getUTCDate() + 1)) {
    if (date.getUTCDay() === 2 || date.getUTCDay() === 6) weeklyDates.push(date.toISOString().split('T')[0]!);
  }
  return { timeZone, weeklyDates, finalDate: final.toISOString().split('T')[0]! };
}
