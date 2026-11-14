// PLC-simulatorn (2026-11-02): the server's numbers under one roof, so the device can never guess a threshold. Imported from pure
// modules; what lives in a module a page cannot import (database or node:crypto) is copied below, and
// tests/plc-simulator-device.test.ts compares each copy with the source text.
export { INGEST_SCHEMA_VERSION, MAX_BODY_BYTES, MAX_EVENTS_PER_CALL, MAX_TEXT_LENGTH } from "@/lib/machine/intake";
export { ALARM_MODE_LABELS, ALARM_MODES, SIM_TEXT_PREFIX } from "@/lib/machine/alarm-rules";

// Copies, each checked against its source by a test.
/** `ingestCall` in lib/security/rate-limit.ts. */
export const SOURCE_CALL_LIMIT = 120;
/** The form `parseSourceToken` in lib/machine/keys.ts accepts. */
export const SOURCE_KEY_FORM = /^hwf_mch_([a-z0-9]{20,40})_([A-Za-z0-9_-]{40,60})$/;
/** `connectionAreaHref("machines")`; lib/integrations/connection-areas.ts draws in the quote rules, which this page has no use for. */
export const MACHINES_HREF = "/?view=advanced&section=machines";

// The simulator's own.
export const SIM_EVENT_PREFIX = "plcsim-";
// SIM_TEXT_PREFIX is re-exported above from alarm-rules.ts, which names a simulated alarm's order by it.
/** One call at a time and a second between starts: half the source's limit in any minute, so two windows on one key stay within it. */
export const MIN_CALL_GAP_MS = 1000;
export const CALL_TIMEOUT_MS = 20_000;
export const MAX_QUEUE = 2000;
export const MAX_LOG_ENTRIES = 300;
export const MAX_LOG_TEXT = 4 * 1024;
export const MAX_REJECTED_SHOWN = 100;
export const MAX_RETRY_AFTER_S = 3600;
export const DEFAULT_RETRY_AFTER_S = 60;
export const MAX_BACKOFF_MS = 60_000;
export const MODULE_OFF_RETRY_MS = 60_000;
