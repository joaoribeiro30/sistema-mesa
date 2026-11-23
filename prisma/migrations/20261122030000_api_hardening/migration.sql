BEGIN;

CREATE TYPE "AuditAction" AS ENUM (
    'LOGIN_LOCKED', 'LOGIN_BLOCKED', 'ADMIN_OVERVIEW_VIEWED', 'ADMIN_CREATED',
    'USER_ROLE_CHANGED', 'PASSWORD_RESET', 'GOOGLE_LINKED', 'PAYMENT_STATUS_CHANGED'
);

CREATE TABLE "audit_logs" (
    "id" BIGSERIAL PRIMARY KEY,
    "action" "AuditAction" NOT NULL,
    "actor_user_id" UUID,
    "subject_user_id" UUID,
    "reservation_id" UUID,
    "payment_id" UUID,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
CREATE INDEX "audit_logs_payment_id_created_at_idx" ON "audit_logs"("payment_id", "created_at");

CREATE TABLE "login_attempts" (
    "key" CHAR(64) PRIMARY KEY,
    "failures" INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
    "locked_until" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "login_attempts_expires_at_idx" ON "login_attempts"("expires_at");

CREATE TABLE "rate_limit_buckets" (
    "key" CHAR(64) PRIMARY KEY,
    "hits" INTEGER NOT NULL CHECK (hits > 0),
    "expires_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "rate_limit_buckets_expires_at_idx" ON "rate_limit_buckets"("expires_at");

CREATE FUNCTION audit_payment_status() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    previous_status "PaymentStatus";
BEGIN
    IF TG_OP = 'UPDATE' THEN
        previous_status := OLD.status;
        IF previous_status = NEW.status THEN
            RETURN NULL;
        END IF;
    END IF;

    INSERT INTO audit_logs (action, reservation_id, payment_id, details)
    VALUES ('PAYMENT_STATUS_CHANGED', NEW.reservation_id, NEW.id, jsonb_build_object(
        'provider', NEW.provider, 'previousStatus', previous_status, 'status', NEW.status,
        'amountMinor', NEW.amount_minor, 'currency', NEW.currency
    ));
    RETURN NULL;
END;
$$;
CREATE TRIGGER payments_audit_status
    AFTER INSERT OR UPDATE OF status ON payments
    FOR EACH ROW EXECUTE FUNCTION audit_payment_status();

CREATE FUNCTION audit_user_role() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.role = 'ADMIN' THEN
            INSERT INTO audit_logs (action, subject_user_id, details)
            VALUES ('ADMIN_CREATED', NEW.id, jsonb_build_object('role', NEW.role));
        END IF;
    ELSIF OLD.role <> NEW.role THEN
        INSERT INTO audit_logs (action, subject_user_id, details)
        VALUES ('USER_ROLE_CHANGED', NEW.id, jsonb_build_object('previousRole', OLD.role, 'role', NEW.role));
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER users_audit_role
    AFTER INSERT OR UPDATE OF role ON users
    FOR EACH ROW EXECUTE FUNCTION audit_user_role();

COMMIT;
