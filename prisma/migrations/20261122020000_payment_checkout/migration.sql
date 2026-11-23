BEGIN;

ALTER TYPE "PaymentStatus" ADD VALUE 'REFUND_REQUIRED';
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'CREDIT_CARD');

ALTER TABLE "reservations"
    ADD COLUMN "ticket_token" VARCHAR(512),
    ADD CONSTRAINT "reservations_ticket_confirmed" CHECK (ticket_token IS NULL OR confirmed_at IS NOT NULL);
CREATE UNIQUE INDEX "reservations_ticket_token_key" ON "reservations"("ticket_token");

ALTER TABLE "payments"
    ADD COLUMN "method" "PaymentMethod",
    ADD COLUMN "request_hash" CHAR(64),
    ADD COLUMN "pix_code" TEXT,
    ADD CONSTRAINT "payments_checkout_valid" CHECK (
        (method IS NULL) = (request_hash IS NULL) AND
        (pix_code IS NULL OR (method IS NOT NULL AND method = 'PIX' AND btrim(pix_code) <> ''))
    ),
    DROP CONSTRAINT "payments_settlement_valid";

-- Compare enum labels as text here because REFUND_REQUIRED is new in this transaction.
ALTER TABLE "payments" ADD CONSTRAINT "payments_settlement_valid" CHECK (
    (status::text IN ('SUCCEEDED', 'REFUNDED', 'REFUND_REQUIRED')) = (paid_at IS NOT NULL) AND
    (paid_at IS NULL OR (paid_at >= created_at AND NULLIF(btrim(provider_payment_id), '') IS NOT NULL)) AND
    (status = 'REFUNDED') = (refunded_at IS NOT NULL) AND
    (refunded_at IS NULL OR refunded_at >= paid_at)
);

CREATE UNIQUE INDEX "payments_one_checkout_pending_per_reservation"
    ON "payments"("reservation_id") WHERE status = 'PENDING' AND method IS NOT NULL;

CREATE TABLE "payment_webhook_events" (
    "provider" VARCHAR(40) NOT NULL,
    "event_id" VARCHAR(255) NOT NULL,
    "payment_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("provider", "event_id"),
    CONSTRAINT "payment_webhook_events_payment_id_fkey" FOREIGN KEY ("payment_id")
        REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);
CREATE INDEX "payment_webhook_events_payment_id_idx" ON "payment_webhook_events"("payment_id");

COMMIT;
