BEGIN;

ALTER TYPE "PaymentMethod" ADD VALUE 'DEBIT_CARD';
CREATE TYPE "SettlementOperation" AS ENUM ('PIX', 'DEBIT', 'CREDIT', 'ANTICIPATED_CREDIT');

CREATE TABLE "payment_settlements" (
    "payment_id" UUID NOT NULL,
    "operation" "SettlementOperation" NOT NULL,
    "financial_fee_bps" INTEGER NOT NULL CHECK ("financial_fee_bps" >= 0),
    "convenience_fee_bps" INTEGER NOT NULL CHECK ("convenience_fee_bps" >= 0),
    "processing_fee_bps" INTEGER NOT NULL CHECK ("processing_fee_bps" >= 0),
    "financial_fee_minor" INTEGER NOT NULL CHECK ("financial_fee_minor" >= 0),
    "convenience_fee_minor" INTEGER NOT NULL CHECK ("convenience_fee_minor" >= 0),
    "processing_fee_minor" INTEGER NOT NULL CHECK ("processing_fee_minor" >= 0),
    "net_minor" INTEGER NOT NULL CHECK ("net_minor" >= 0),
    CONSTRAINT "payment_settlements_pkey" PRIMARY KEY ("payment_id"),
    CONSTRAINT "payment_settlements_payment_id_fkey" FOREIGN KEY ("payment_id")
        REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);

-- Existing checkout rows have Pix or regular credit. Older rows without a method remain unclassified.
WITH rates AS (
    SELECT id, amount_minor::bigint AS gross,
        CASE WHEN method = 'PIX' THEN 'PIX' ELSE 'CREDIT' END::"SettlementOperation" AS operation,
        CASE WHEN method = 'PIX' THEN 120 ELSE 299 END AS processing_bps
    FROM payments WHERE method IS NOT NULL
), fees AS (
    SELECT *, (gross * 500 + 5000) / 10000 AS financial,
        (gross * 1500 + 5000) / 10000 AS service,
        (gross * processing_bps + 5000) / 10000 AS processing
    FROM rates
)
INSERT INTO payment_settlements (
    payment_id, operation, financial_fee_bps, convenience_fee_bps, processing_fee_bps,
    financial_fee_minor, convenience_fee_minor, processing_fee_minor, net_minor
)
SELECT id, operation, 500, 1000, processing_bps, financial, service - financial, processing, gross - service - processing
FROM fees;

COMMIT;
