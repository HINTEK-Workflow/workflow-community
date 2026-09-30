import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The API/MCP server (Daniel 2026-09-30: one core, the same permissions everywhere). A call with an issued key runs
 * the ordinary route handlers inside this scope; `context()` then loads the member the key acts for instead of the
 * browser session, so every existing tenant, role, permission, legal and write check applies unchanged. The scope is
 * only ever set by the tool dispatcher after the key has been verified – never from a request header.
 */
export type IntegrationPrincipal = {
  keyId: string;
  keyName: string;
  kind: "API" | "MCP";
  organizationId: string;
  actingUserId: string;
  scopes: string[];
};

const storage = new AsyncLocalStorage<IntegrationPrincipal>();

export function runAsPrincipal<T>(principal: IntegrationPrincipal, work: () => Promise<T>) {
  return storage.run(principal, work);
}

export function currentPrincipal() {
  return storage.getStore() ?? null;
}
