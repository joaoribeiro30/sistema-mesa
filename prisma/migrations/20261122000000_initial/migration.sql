BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'CONFIRMED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AccountTokenKind" AS ENUM ('VERIFY_EMAIL', 'RESET_PASSWORD');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255),
    "email_verified_at" TIMESTAMPTZ(3),
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "session_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "google_identities" (
    "subject" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "google_identities_pkey" PRIMARY KEY ("subject")
);

-- CreateTable
CREATE TABLE "account_tokens" (
    "token_hash" CHAR(64) NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" "AccountTokenKind" NOT NULL,
    "session_version" INTEGER NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_tokens_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "oauth_attempts" (
    "state_hash" CHAR(64) NOT NULL,
    "browser_hash" CHAR(64) NOT NULL,
    "nonce" VARCHAR(128) NOT NULL,
    "code_verifier" VARCHAR(128) NOT NULL,
    "link_user_id" UUID,
    "link_session_version" INTEGER,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "oauth_attempts_pkey" PRIMARY KEY ("state_hash")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(120) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "venue" VARCHAR(160) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "sectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sector_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "price_minor" INTEGER NOT NULL,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "idempotency_key" UUID NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "guest_count" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reservation_id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "provider_payment_id" VARCHAR(255),
    "idempotency_key" UUID NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paid_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "google_identities_user_id_key" ON "google_identities"("user_id");

-- CreateIndex
CREATE INDEX "account_tokens_user_id_kind_idx" ON "account_tokens"("user_id", "kind");

-- CreateIndex
CREATE INDEX "account_tokens_expires_at_idx" ON "account_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_attempts_expires_at_idx" ON "oauth_attempts"("expires_at");

-- CreateIndex
CREATE INDEX "oauth_attempts_link_user_id_idx" ON "oauth_attempts"("link_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_status_starts_at_idx" ON "events"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "events_id_currency_key" ON "events"("id", "currency");

-- CreateIndex
CREATE UNIQUE INDEX "sectors_id_event_id_key" ON "sectors"("id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "sectors_event_id_name_key" ON "sectors"("event_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tables_id_event_id_key" ON "tables"("id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "tables_sector_id_label_key" ON "tables"("sector_id", "label");

-- CreateIndex
CREATE INDEX "reservations_user_id_created_at_idx" ON "reservations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "reservations_table_id_event_id_idx" ON "reservations"("table_id", "event_id");

-- CreateIndex
CREATE INDEX "reservations_event_id_status_idx" ON "reservations"("event_id", "status");

-- CreateIndex
CREATE INDEX "reservations_status_expires_at_idx" ON "reservations"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_user_id_idempotency_key_key" ON "reservations"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_id_amount_minor_currency_key" ON "reservations"("id", "amount_minor", "currency");

-- CreateIndex
CREATE INDEX "payments_reservation_id_created_at_idx" ON "payments"("reservation_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_id_key" ON "payments"("provider", "provider_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_idempotency_key_key" ON "payments"("provider", "idempotency_key");

-- AddForeignKey
ALTER TABLE "google_identities" ADD CONSTRAINT "google_identities_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "oauth_attempts" ADD CONSTRAINT "oauth_attempts_link_user_id_fkey" FOREIGN KEY ("link_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "sectors" ADD CONSTRAINT "sectors_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_sector_id_event_id_fkey" FOREIGN KEY ("sector_id", "event_id") REFERENCES "sectors"("id", "event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_id_event_id_fkey" FOREIGN KEY ("table_id", "event_id") REFERENCES "tables"("id", "event_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_event_id_currency_fkey" FOREIGN KEY ("event_id", "currency") REFERENCES "events"("id", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_amount_minor_currency_fkey" FOREIGN KEY ("reservation_id", "amount_minor", "currency") REFERENCES "reservations"("id", "amount_minor", "currency") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Domain constraints represented in SQL so they apply to every database writer.
ALTER TABLE "users"
    ADD CONSTRAINT "users_email_normalized" CHECK (email = lower(btrim(email)) AND email <> ''),
    ADD CONSTRAINT "users_name_nonempty" CHECK (btrim(name) <> ''),
    ADD CONSTRAINT "users_session_version_valid" CHECK (session_version >= 0);

ALTER TABLE "account_tokens"
    ADD CONSTRAINT "account_tokens_validity" CHECK (expires_at > created_at AND (used_at IS NULL OR used_at < expires_at)),
    ADD CONSTRAINT "account_tokens_version_valid" CHECK (session_version >= 0);

ALTER TABLE "oauth_attempts"
    ADD CONSTRAINT "oauth_attempts_link_valid" CHECK (
        (link_user_id IS NULL AND link_session_version IS NULL) OR
        (link_user_id IS NOT NULL AND link_session_version IS NOT NULL AND link_session_version >= 0)
    );

ALTER TABLE "events"
    ADD CONSTRAINT "events_valid_schedule" CHECK (ends_at > starts_at),
    ADD CONSTRAINT "events_valid_currency" CHECK (currency ~ '^[A-Z]{3}$'),
    ADD CONSTRAINT "events_slug_valid" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

ALTER TABLE "sectors" ADD CONSTRAINT "sectors_name_nonempty" CHECK (btrim(name) <> '');

ALTER TABLE "tables"
    ADD CONSTRAINT "tables_label_nonempty" CHECK (btrim(label) <> ''),
    ADD CONSTRAINT "tables_capacity_positive" CHECK (capacity > 0),
    ADD CONSTRAINT "tables_price_nonnegative" CHECK (price_minor >= 0);

ALTER TABLE "reservations"
    ADD CONSTRAINT "reservations_guests_within_capacity" CHECK (guest_count BETWEEN 1 AND capacity),
    ADD CONSTRAINT "reservations_amount_nonnegative" CHECK (amount_minor >= 0),
    ADD CONSTRAINT "reservations_expiry_after_creation" CHECK (expires_at > created_at),
    ADD CONSTRAINT "reservations_confirmed_at_valid" CHECK (
        (status <> 'CONFIRMED' OR confirmed_at IS NOT NULL) AND
        (confirmed_at IS NULL OR (status IN ('CONFIRMED', 'CANCELLED') AND confirmed_at >= created_at AND confirmed_at < expires_at))
    ),
    ADD CONSTRAINT "reservations_cancelled_at_valid" CHECK (
        (status = 'CANCELLED') = (cancelled_at IS NOT NULL) AND
        (cancelled_at IS NULL OR cancelled_at >= COALESCE(confirmed_at, created_at))
    );

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_provider_nonempty" CHECK (btrim(provider) <> ''),
    ADD CONSTRAINT "payments_settlement_valid" CHECK (
        (status IN ('SUCCEEDED', 'REFUNDED')) = (paid_at IS NOT NULL) AND
        (paid_at IS NULL OR (paid_at >= created_at AND NULLIF(btrim(provider_payment_id), '') IS NOT NULL)) AND
        (status = 'REFUNDED') = (refunded_at IS NOT NULL) AND
        (refunded_at IS NULL OR refunded_at >= paid_at)
    );

CREATE UNIQUE INDEX "reservations_one_active_per_table"
    ON "reservations"("table_id") WHERE status IN ('HELD', 'CONFIRMED');

CREATE UNIQUE INDEX "payments_one_settlement_per_reservation"
    ON "payments"("reservation_id") WHERE status IN ('SUCCEEDED', 'REFUNDED');

COMMIT;
