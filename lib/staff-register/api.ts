import { NextResponse } from "next/server";
import { serverExtensions } from "@/lib/extensions/server";
import { failure, type Context } from "@/lib/kfid/server";
import { STAFF_REGISTER_WRITE_PAUSED, StaffRegisterError, staffRegisterWriteAllowed, type StaffRegisterCaller } from "./model";

/** The caller of the staff register routes, from the server's own session context. */
export const staffRegisterCaller = (ctx: Context): StaffRegisterCaller => ({
  organizationId: ctx.organizationId, userId: ctx.user.id, userName: ctx.user.name || ctx.user.email,
  admin: ctx.admin, permissions: ctx.workflowPermissions, storageMode: ctx.organization.storageMode,
});

/**
 * Whether new register rows may be written for the caller's company now: the core asks the extension (ee/ billing) for
 * Cloud write access and its reason; only an overdue invoice is exempt (model.ts staffRegisterWriteAllowed). Without
 * ee/ writing is always available. A non-Cloud company is stopped later by requireStaffRegister.
 */
export async function staffRegisterWritable(ctx: Context, now = new Date()) {
  if (ctx.organization.storageMode !== "HINTEK_CLOUD") return true;
  return staffRegisterWriteAllowed(await serverExtensions.cloudWriteAccess(ctx.organizationId, now));
}

export async function requireStaffRegisterWrite(ctx: Context, now = new Date()) {
  if (!(await staffRegisterWritable(ctx, now))) throw new StaffRegisterError(423, STAFF_REGISTER_WRITE_PAUSED);
}

/** A register error with its status (and code, e.g. NEEDS_ID_NUMBER); anything else as every other route. */
export function staffRegisterFailure(error: unknown) {
  if (error instanceof StaffRegisterError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
  return failure(error);
}
