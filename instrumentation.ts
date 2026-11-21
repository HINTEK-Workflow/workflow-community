/**
 * Once when the server process starts (Next.js instrumentation): the commercial part may schedule its own start work (ee/
 * schedules the automatic blocks of the operator's website). Only in the Node.js runtime – the import sits inside the
 * runtime check, so the edge bundle never contains it – never during a build, and nothing here can stop the server from
 * starting. Without ee/ nothing happens.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    try {
      const { startServerWork } = await import("./instrumentation-node");
      startServerWork();
    } catch {
      // The start work is a convenience; the app works without it.
    }
  }
}
