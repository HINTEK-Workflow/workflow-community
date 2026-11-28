-- Spårbarhet K3.1–K3.3 (2026-11-27): a tamper-evident chain over the security, administration and change logs, the change
-- history on work orders, protocols, deviations, maintenance plans and machines, and the company's log retention.
-- Additive only: new columns are nullable (rows from before stay as they are and are bound by one anchor hash per chain),
-- new tables, functions and triggers. The rule in TypeScript, for the nightly check: lib/traceability/chain.ts.
BEGIN;

-- The tables whose rows are chained are held still while the rows from before are anchored, so no row is left between the
-- anchor and the trigger.
LOCK TABLE "AdministrationEvent", "SecurityEvent" IN SHARE ROW EXCLUSIVE MODE;

-- K3.3: the company's log retention in years (1, 2, 5 or 10; 2 as standard).
ALTER TABLE "Organization" ADD COLUMN "logRetentionYears" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "Organization" ADD CONSTRAINT "Organization_logRetentionYears_check" CHECK ("logRetentionYears" IN (1, 2, 5, 10));

-- K3.1: each chained row's number in its chain and its links.
ALTER TABLE "AdministrationEvent" ADD COLUMN "chainSeq" INTEGER, ADD COLUMN "prevHash" TEXT, ADD COLUMN "rowHash" TEXT;
ALTER TABLE "SecurityEvent" ADD COLUMN "chainSeq" INTEGER, ADD COLUMN "prevHash" TEXT, ADD COLUMN "rowHash" TEXT;
CREATE INDEX "AdministrationEvent_organizationId_chainSeq_idx" ON "AdministrationEvent"("organizationId", "chainSeq");
CREATE INDEX "SecurityEvent_organizationId_chainSeq_idx" ON "SecurityEvent"("organizationId", "chainSeq");

-- K3.2: the change history.
CREATE TABLE "RecordChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "changes" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chainSeq" INTEGER,
    "prevHash" TEXT,
    "rowHash" TEXT,
    CONSTRAINT "RecordChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RecordChange_entityType_check" CHECK ("entityType" IN ('TASK', 'DEVIATION', 'MAINTENANCE_PLAN', 'MACHINE')),
    CONSTRAINT "RecordChange_action_check" CHECK ("action" IN ('CREATED', 'UPDATED', 'DELETED')),
    CONSTRAINT "RecordChange_changes_size_check" CHECK (octet_length("changes") <= 65536)
);
CREATE INDEX "RecordChange_organizationId_entityType_entityId_createdAt_idx" ON "RecordChange"("organizationId", "entityType", "entityId", "createdAt");
CREATE INDEX "RecordChange_organizationId_chainSeq_idx" ON "RecordChange"("organizationId", "chainSeq");
CREATE INDEX "RecordChange_organizationId_createdAt_idx" ON "RecordChange"("organizationId", "createdAt");

-- The end of each chain, its known starting points and the links kept without their rows.
CREATE TABLE "AuditChainHead" (
    "log" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL,
    "organizationId" TEXT,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,
    "lastHash" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "verifiedSeq" INTEGER,
    "brokenAt" TIMESTAMP(3),
    "brokenSeq" INTEGER,
    "brokenReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditChainHead_pkey" PRIMARY KEY ("log", "chainKey"),
    CONSTRAINT "AuditChainHead_log_check" CHECK ("log" IN ('admin', 'security', 'change'))
);
CREATE INDEX "AuditChainHead_organizationId_idx" ON "AuditChainHead"("organizationId");
CREATE INDEX "AuditChainHead_brokenAt_idx" ON "AuditChainHead"("brokenAt");

CREATE TABLE "AuditChainCheckpoint" (
    "id" TEXT NOT NULL,
    "log" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL,
    "organizationId" TEXT,
    "throughSeq" INTEGER NOT NULL,
    "hash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "legacyCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditChainCheckpoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditChainCheckpoint_kind_check" CHECK ("kind" IN ('genesis', 'anchor', 'retention'))
);
CREATE INDEX "AuditChainCheckpoint_log_chainKey_throughSeq_idx" ON "AuditChainCheckpoint"("log", "chainKey", "throughSeq");
CREATE INDEX "AuditChainCheckpoint_organizationId_idx" ON "AuditChainCheckpoint"("organizationId");

CREATE TABLE "AuditChainGap" (
    "log" TEXT NOT NULL,
    "chainKey" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "organizationId" TEXT,
    "prevHash" TEXT NOT NULL,
    "rowHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditChainGap_pkey" PRIMARY KEY ("log", "chainKey", "seq"),
    CONSTRAINT "AuditChainGap_kind_check" CHECK ("kind" IN ('erased', 'removed', 'retention', 'redacted'))
);
CREATE INDEX "AuditChainGap_organizationId_idx" ON "AuditChainGap"("organizationId");

-- The canonical text (lib/traceability/chain.ts canonicalValue, canonicalTime and canonicalRow give the same, character for character).
CREATE OR REPLACE FUNCTION audit_chain_field(v TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN v IS NULL THEN '-' ELSE octet_length(v)::text || ':' || v END
$$;

CREATE OR REPLACE FUNCTION audit_chain_time(v TIMESTAMP) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT to_char(v, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

CREATE OR REPLACE FUNCTION audit_chain_canonical_admin(p_id TEXT, p_org TEXT, p_actor TEXT, p_action TEXT, p_detail TEXT, p_at TIMESTAMP) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT 'v1|admin'
    || E'\nid=' || audit_chain_field(p_id)
    || E'\norganizationId=' || audit_chain_field(p_org)
    || E'\nactorId=' || audit_chain_field(p_actor)
    || E'\naction=' || audit_chain_field(p_action)
    || E'\ndetail=' || audit_chain_field(p_detail)
    || E'\ncreatedAt=' || audit_chain_field(audit_chain_time(p_at))
$$;

CREATE OR REPLACE FUNCTION audit_chain_canonical_security(p_id TEXT, p_type TEXT, p_user TEXT, p_actor TEXT, p_org TEXT, p_platform BOOLEAN, p_client TEXT, p_ip TEXT, p_detail TEXT, p_at TIMESTAMP) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT 'v1|security'
    || E'\nid=' || audit_chain_field(p_id)
    || E'\ntype=' || audit_chain_field(p_type)
    || E'\nuserId=' || audit_chain_field(p_user)
    || E'\nactorId=' || audit_chain_field(p_actor)
    || E'\norganizationId=' || audit_chain_field(p_org)
    || E'\nplatform=' || audit_chain_field(CASE WHEN p_platform THEN 'true' ELSE 'false' END)
    || E'\nclient=' || audit_chain_field(p_client)
    || E'\nipHash=' || audit_chain_field(p_ip)
    || E'\ndetail=' || audit_chain_field(p_detail)
    || E'\ncreatedAt=' || audit_chain_field(audit_chain_time(p_at))
$$;

CREATE OR REPLACE FUNCTION audit_chain_canonical_change(p_id TEXT, p_org TEXT, p_type TEXT, p_entity TEXT, p_action TEXT, p_actor TEXT, p_changes TEXT, p_at TIMESTAMP) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT 'v1|change'
    || E'\nid=' || audit_chain_field(p_id)
    || E'\norganizationId=' || audit_chain_field(p_org)
    || E'\nentityType=' || audit_chain_field(p_type)
    || E'\nentityId=' || audit_chain_field(p_entity)
    || E'\naction=' || audit_chain_field(p_action)
    || E'\nactorId=' || audit_chain_field(p_actor)
    || E'\nchanges=' || audit_chain_field(p_changes)
    || E'\ncreatedAt=' || audit_chain_field(audit_chain_time(p_at))
$$;

CREATE OR REPLACE FUNCTION audit_chain_genesis(p_log TEXT, p_key TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(sha256(convert_to('hintek-workflow-audit-chain-v1' || E'\n' || p_log || E'\n' || p_key, 'UTF8')), 'hex')
$$;

-- The next link of a chain, under the head's row lock (held until the writer's transaction ends, so the chain never forks):
-- a new chain starts at its genesis hash, written as its first checkpoint.
CREATE OR REPLACE FUNCTION audit_chain_next(p_log TEXT, p_org TEXT, p_canonical TEXT, OUT o_seq INTEGER, OUT o_prev TEXT, OUT o_hash TEXT) LANGUAGE plpgsql AS $$
DECLARE
  v_key TEXT := COALESCE(NULLIF(p_org, ''), 'platform');
  v_genesis TEXT;
BEGIN
  SELECT "lastSeq", "lastHash" INTO o_seq, o_prev FROM "AuditChainHead" WHERE "log" = p_log AND "chainKey" = v_key FOR UPDATE;
  IF NOT FOUND THEN
    v_genesis := audit_chain_genesis(p_log, v_key);
    INSERT INTO "AuditChainHead" ("log", "chainKey", "organizationId", "lastSeq", "lastHash") VALUES (p_log, v_key, NULLIF(p_org, ''), 0, v_genesis)
      ON CONFLICT ("log", "chainKey") DO NOTHING;
    IF FOUND THEN
      INSERT INTO "AuditChainCheckpoint" ("id", "log", "chainKey", "organizationId", "throughSeq", "hash", "kind") VALUES (gen_random_uuid()::text, p_log, v_key, NULLIF(p_org, ''), 0, v_genesis, 'genesis');
    END IF;
    SELECT "lastSeq", "lastHash" INTO o_seq, o_prev FROM "AuditChainHead" WHERE "log" = p_log AND "chainKey" = v_key FOR UPDATE;
  END IF;
  o_seq := o_seq + 1;
  o_hash := encode(sha256(convert_to(o_prev || E'\n' || o_seq::text || E'\n' || p_canonical, 'UTF8')), 'hex');
  UPDATE "AuditChainHead" SET "lastSeq" = o_seq, "lastHash" = o_hash, "updatedAt" = CURRENT_TIMESTAMP WHERE "log" = p_log AND "chainKey" = v_key;
END
$$;

CREATE OR REPLACE FUNCTION audit_chain_admin_append() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  NEW."createdAt" := date_trunc('milliseconds', NEW."createdAt");
  SELECT * INTO r FROM audit_chain_next('admin', NEW."organizationId",
    audit_chain_canonical_admin(NEW."id", NEW."organizationId", NEW."actorId", NEW."action", NEW."detail", NEW."createdAt"));
  NEW."chainSeq" := r.o_seq; NEW."prevHash" := r.o_prev; NEW."rowHash" := r.o_hash;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION audit_chain_security_append() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  NEW."createdAt" := date_trunc('milliseconds', NEW."createdAt");
  SELECT * INTO r FROM audit_chain_next('security', NEW."organizationId",
    audit_chain_canonical_security(NEW."id", NEW."type", NEW."userId", NEW."actorId", NEW."organizationId", NEW."platform", NEW."client", NEW."ipHash", NEW."detail", NEW."createdAt"));
  NEW."chainSeq" := r.o_seq; NEW."prevHash" := r.o_prev; NEW."rowHash" := r.o_hash;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION audit_chain_change_append() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE r RECORD;
BEGIN
  NEW."createdAt" := date_trunc('milliseconds', NEW."createdAt");
  SELECT * INTO r FROM audit_chain_next('change', NEW."organizationId",
    audit_chain_canonical_change(NEW."id", NEW."organizationId", NEW."entityType", NEW."entityId", NEW."action", NEW."actorId", NEW."changes", NEW."createdAt"));
  NEW."chainSeq" := r.o_seq; NEW."prevHash" := r.o_prev; NEW."rowHash" := r.o_hash;
  RETURN NEW;
END
$$;

-- A row's place in the chain is written once, on insert.
CREATE OR REPLACE FUNCTION audit_chain_links_fixed() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."chainSeq" IS DISTINCT FROM OLD."chainSeq" OR NEW."prevHash" IS DISTINCT FROM OLD."prevHash" OR NEW."rowHash" IS DISTINCT FROM OLD."rowHash" THEN
    RAISE EXCEPTION 'A log row''s chain links cannot be changed.';
  END IF;
  RETURN NEW;
END
$$;

-- The rows from before: one anchor hash per chain over their own hashes, in the order createdAt, id
-- (lib/traceability/chain.ts anchorHash). The anchor is the chain's start; nothing in the rows is rewritten.
WITH legacy AS (
  SELECT "organizationId" AS chain_key, count(*)::int AS n,
    string_agg(encode(sha256(convert_to(audit_chain_canonical_admin("id", "organizationId", "actorId", "action", "detail", "createdAt"), 'UTF8')), 'hex'), E'\n' ORDER BY "createdAt", "id" COLLATE "C") AS digests
  FROM "AdministrationEvent" GROUP BY "organizationId"
), anchored AS (
  SELECT chain_key, n, encode(sha256(convert_to('hintek-workflow-audit-anchor-v1' || E'\nadmin\n' || chain_key || E'\n' || n::text || E'\n' || digests, 'UTF8')), 'hex') AS anchor FROM legacy
), heads AS (
  INSERT INTO "AuditChainHead" ("log", "chainKey", "organizationId", "lastSeq", "lastHash") SELECT 'admin', chain_key, chain_key, 0, anchor FROM anchored RETURNING 1
)
INSERT INTO "AuditChainCheckpoint" ("id", "log", "chainKey", "organizationId", "throughSeq", "hash", "kind", "legacyCount")
  SELECT gen_random_uuid()::text, 'admin', chain_key, chain_key, 0, anchor, 'anchor', n FROM anchored;

WITH legacy AS (
  SELECT COALESCE("organizationId", 'platform') AS chain_key, count(*)::int AS n,
    string_agg(encode(sha256(convert_to(audit_chain_canonical_security("id", "type", "userId", "actorId", "organizationId", "platform", "client", "ipHash", "detail", "createdAt"), 'UTF8')), 'hex'), E'\n' ORDER BY "createdAt", "id" COLLATE "C") AS digests
  FROM "SecurityEvent" GROUP BY COALESCE("organizationId", 'platform')
), anchored AS (
  SELECT chain_key, n, encode(sha256(convert_to('hintek-workflow-audit-anchor-v1' || E'\nsecurity\n' || chain_key || E'\n' || n::text || E'\n' || digests, 'UTF8')), 'hex') AS anchor FROM legacy
), heads AS (
  INSERT INTO "AuditChainHead" ("log", "chainKey", "organizationId", "lastSeq", "lastHash") SELECT 'security', chain_key, NULLIF(chain_key, 'platform'), 0, anchor FROM anchored RETURNING 1
)
INSERT INTO "AuditChainCheckpoint" ("id", "log", "chainKey", "organizationId", "throughSeq", "hash", "kind", "legacyCount")
  SELECT gen_random_uuid()::text, 'security', chain_key, NULLIF(chain_key, 'platform'), 0, anchor, 'anchor', n FROM anchored;

CREATE TRIGGER "AdministrationEvent_audit_chain" BEFORE INSERT ON "AdministrationEvent" FOR EACH ROW EXECUTE FUNCTION audit_chain_admin_append();
CREATE TRIGGER "SecurityEvent_audit_chain" BEFORE INSERT ON "SecurityEvent" FOR EACH ROW EXECUTE FUNCTION audit_chain_security_append();
CREATE TRIGGER "RecordChange_audit_chain" BEFORE INSERT ON "RecordChange" FOR EACH ROW EXECUTE FUNCTION audit_chain_change_append();
CREATE TRIGGER "AdministrationEvent_audit_chain_fixed" BEFORE UPDATE ON "AdministrationEvent" FOR EACH ROW EXECUTE FUNCTION audit_chain_links_fixed();
CREATE TRIGGER "SecurityEvent_audit_chain_fixed" BEFORE UPDATE ON "SecurityEvent" FOR EACH ROW EXECUTE FUNCTION audit_chain_links_fixed();
CREATE TRIGGER "RecordChange_audit_chain_fixed" BEFORE UPDATE ON "RecordChange" FOR EACH ROW EXECUTE FUNCTION audit_chain_links_fixed();

COMMIT;
