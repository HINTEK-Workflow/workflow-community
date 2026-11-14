import { NextResponse } from "next/server";
import { ApiError, failure, signedInAuth } from "@/lib/kfid/server";
import { HOST_STATUS_ALERT_DAYS, HOST_STATUS_STALE_HOURS, serverStatusAccess, updateCommands } from "@/lib/ops/host-status";
import { serverExtensions } from "@/lib/extensions/server";
import { readServerViews } from "@/lib/ops/host-status-server";

export const dynamic = "force-dynamic";

/**
 * Installation → Drift och säkerhet → Servrar och uppdateringar (2026-10-25): each server's status file
 * (scripts/ops/host-status.sh, written by root's cron) as read now. The superadmin only; read on the server, never kept
 * by a browser or a cache. Read-only: nothing here runs anything on the servers.
 *
 * `oneClick` (2026-11-06): the links to the handler on the administrator's own computer, or null where the
 * installation has none. `login` is the sign-in's time, so the toast after signing in is shown once per sign-in.
 */
export async function GET() {
  try {
    const auth = await signedInAuth();
    const access = serverStatusAccess(auth?.user ?? null);
    if (!access.ok) throw new ApiError(access.status, access.message);
    // Workflow's own servers (ee/ops/server-ops.ts): their manual commands and the one-click links; none without ee/.
    const ops = serverExtensions.serverOps ? await serverExtensions.serverOps() : null;
    const servers = (await readServerViews()).map((view) => ({ ...view, commands: updateCommands(view.host, ops?.statusCommands) }));
    return NextResponse.json({
      servers, readAt: new Date().toISOString(), staleHours: HOST_STATUS_STALE_HOURS, alertDays: HOST_STATUS_ALERT_DAYS,
      oneClick: ops?.oneClick ?? null, login: auth?.authAt ? String(auth.authAt) : null,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}
