// MCP batches (granskningen 2026-11-24, G-23 / data-ai F-08). Earlier protocol versions (2025-03-26) allow a JSON-RPC
// batch; 2025-06-18 and later have removed it. A batch is answered one message at a time, and no more than this many
// messages are taken in one request: a client that needs more sends more requests (each one counted by the key's limits).
// Pure, so the route and the unit tests read the same rule.

/** The most messages one batch may hold. Real MCP clients send one at a time; 20 leaves room for an initialise burst. */
export const MCP_MAX_BATCH = 20;

/** Why a batch cannot be taken (status and message), or null when it may be answered. */
export function batchProblem(batch: unknown[]): { status: 400; message: string } | null {
  if (!batch.length) return { status: 400, message: "Ogiltig JSON-RPC-begäran." };
  if (batch.length > MCP_MAX_BATCH) return { status: 400, message: `För många meddelanden i en sats (högst ${MCP_MAX_BATCH}). Skicka dem i flera begäranden.` };
  return null;
}
