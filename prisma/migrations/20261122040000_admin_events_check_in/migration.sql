BEGIN;

ALTER TYPE "EventStatus" RENAME VALUE 'CANCELLED' TO 'CLOSED';
CREATE TYPE "EventDisplayMode" AS ENUM ('MAP', 'LIST', 'BOTH');
CREATE TYPE "EventImageKind" AS ENUM ('COVER', 'BANNER', 'FLOOR_PLAN');
CREATE TYPE "TableChangeKind" AS ENUM ('LOCKED', 'RELEASED', 'SOLD');

ALTER TABLE "events"
    ADD COLUMN "city" VARCHAR(120),
    ADD COLUMN "category" VARCHAR(120),
    ADD COLUMN "cover_image_url" VARCHAR(2048),
    ADD COLUMN "banner_image_url" VARCHAR(2048),
    ADD COLUMN "floor_plan_image_url" VARCHAR(2048),
    ADD COLUMN "display_mode" "EventDisplayMode" NOT NULL DEFAULT 'BOTH';

ALTER TABLE "sectors"
    ADD COLUMN "description" TEXT,
    ADD COLUMN "base_price_minor" INTEGER NOT NULL DEFAULT 0 CHECK ("base_price_minor" >= 0);

ALTER TABLE "tables"
    ADD COLUMN "x" DOUBLE PRECISION,
    ADD COLUMN "y" DOUBLE PRECISION,
    ADD CONSTRAINT "tables_layout_coordinates_valid" CHECK (
        (x IS NULL AND y IS NULL) OR (x IS NOT NULL AND y IS NOT NULL AND x BETWEEN 0 AND 100 AND y BETWEEN 0 AND 100)
    );
CREATE INDEX "tables_event_id_is_enabled_price_minor_idx" ON "tables"("event_id", "is_enabled", "price_minor");

ALTER TABLE "reservations"
    ADD COLUMN "checked_in_at" TIMESTAMPTZ(3),
    ADD COLUMN "checked_in_by_id" UUID,
    ADD CONSTRAINT "reservations_checked_in_by_id_fkey" FOREIGN KEY ("checked_in_by_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    ADD CONSTRAINT "reservations_check_in_valid" CHECK (
        (checked_in_at IS NULL AND checked_in_by_id IS NULL) OR
        (checked_in_at IS NOT NULL AND checked_in_by_id IS NOT NULL AND confirmed_at IS NOT NULL AND checked_in_at >= confirmed_at)
    );
CREATE INDEX "reservations_checked_in_by_id_idx" ON "reservations"("checked_in_by_id");
CREATE INDEX "reservations_event_id_created_at_id_idx" ON "reservations"("event_id", "created_at", "id");

CREATE TABLE "event_images" (
    "event_id" UUID NOT NULL,
    "kind" "EventImageKind" NOT NULL,
    "media_type" VARCHAR(16) NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp')),
    "content" BYTEA NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 2097152),
    CONSTRAINT "event_images_pkey" PRIMARY KEY ("event_id", "kind"),
    CONSTRAINT "event_images_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE TABLE "event_streams" (
    "event_id" UUID NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT "event_streams_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "event_streams_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE RESTRICT
);

CREATE TABLE "event_table_changes" (
    "event_id" UUID NOT NULL,
    "version" BIGINT NOT NULL,
    "table_id" UUID NOT NULL,
    "kind" "TableChangeKind" NOT NULL,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_table_changes_pkey" PRIMARY KEY ("event_id", "version"),
    CONSTRAINT "event_table_changes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event_streams"("event_id")
        ON DELETE CASCADE ON UPDATE RESTRICT
);

-- A per-event row lock serializes cursor assignment with commit across API instances.
CREATE FUNCTION record_table_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    change_kind "TableChangeKind";
    next_version bigint;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = OLD.status THEN
        RETURN NULL;
    END IF;

    IF NEW.status = 'PENDING_PAYMENT' THEN
        change_kind := 'LOCKED';
    ELSIF NEW.status = 'CONFIRMED' THEN
        change_kind := 'SOLD';
    ELSIF TG_OP = 'UPDATE' AND OLD.status IN ('PENDING_PAYMENT', 'CONFIRMED') THEN
        change_kind := 'RELEASED';
    ELSE
        RETURN NULL;
    END IF;

    INSERT INTO event_streams (event_id, version) VALUES (NEW.event_id, 1)
        ON CONFLICT (event_id) DO UPDATE SET version = event_streams.version + 1
        RETURNING version INTO next_version;
    INSERT INTO event_table_changes (event_id, version, table_id, kind, expires_at)
        VALUES (NEW.event_id, next_version, NEW.table_id, change_kind,
            CASE WHEN change_kind = 'LOCKED' THEN NEW.expires_at ELSE NULL END);
    RETURN NULL;
END;
$$;
CREATE TRIGGER reservations_stream_status
    AFTER INSERT OR UPDATE OF status ON reservations
    FOR EACH ROW EXECUTE FUNCTION record_table_change();

ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_EVENT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_EVENT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_EVENT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_SECTOR_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_SECTOR_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_SECTOR_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_TABLE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_TABLE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_TABLE_DELETED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_TABLES_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_EVENT_LAYOUT_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'ADMIN_EVENT_IMAGE_UPLOADED';
ALTER TYPE "AuditAction" ADD VALUE 'RESERVATION_CHECKED_IN';
ALTER TABLE "audit_logs" ADD COLUMN "event_id" UUID;
CREATE INDEX "audit_logs_event_id_created_at_idx" ON "audit_logs"("event_id", "created_at");

COMMIT;
