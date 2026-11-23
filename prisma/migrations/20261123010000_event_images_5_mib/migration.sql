BEGIN;

ALTER TABLE "event_images"
    DROP CONSTRAINT "event_images_content_check",
    ADD CONSTRAINT "event_images_content_check" CHECK (octet_length("content") BETWEEN 1 AND 5242880);

COMMIT;
