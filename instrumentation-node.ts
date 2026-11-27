import { serverExtensions } from "@/lib/extensions/server";

/** The Node.js part of instrumentation.ts: hands the start over to the installation's extensions. */
export function startServerWork() {
  serverExtensions.serverStarted?.();
}
