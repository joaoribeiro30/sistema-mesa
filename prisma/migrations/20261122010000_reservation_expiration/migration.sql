BEGIN;

-- Preserve existing rows, the column default, and the partial unique index.
ALTER TYPE "ReservationStatus" RENAME VALUE 'HELD' TO 'PENDING_PAYMENT';

-- Apply the new limit to pending legacy reservations without extending their deadlines.
UPDATE "reservations"
SET "expires_at" = "created_at" + INTERVAL '10 minutes',
    "updated_at" = statement_timestamp()
WHERE "status" = 'PENDING_PAYMENT'
  AND "expires_at" > "created_at" + INTERVAL '10 minutes';

COMMIT;
