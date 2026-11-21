import { z } from "zod";
import { prisma } from "@/lib/db";
import { ApiError, context, failure, requireCloudStorage } from "@/lib/kfid/server";
import { hasWorkflowPermission, workflowSubjectForTask } from "@/lib/workflow/permissions";
import { joinTask, taskEditors, type TaskLiveEvent } from "@/lib/workflow/live-bus";

export const dynamic = "force-dynamic";

// A connection lives at most five minutes; the browser reconnects by itself, and the session and the person's right
// to read the task are checked again each time, so a sign-out or a removed permission ends the stream within minutes.
const LIFETIME_MS = 5 * 60_000;
const HEARTBEAT_MS = 20_000;

/**
 * Live sync for one task (2026-10-04): Server-Sent Events from our own server with who has the task open and
 * when a newer version is saved. Nothing of the task's content is sent; the browser reads the new version through the
 * ordinary, permission-checked GET.
 */
export async function GET(request: Request) {
  try {
    const ctx = await context();
    requireCloudStorage(ctx);
    const id = z.string().min(1).max(100).parse(new URL(request.url).searchParams.get("id"));
    const task = await prisma.workflowTask.findFirst({ where: { id, organizationId: ctx.organizationId }, select: { id: true, kind: true, formArea: true } });
    if (!task || !(ctx.admin || hasWorkflowPermission(ctx.workflowPermissions, workflowSubjectForTask(task.kind, task.formArea), "read"))) throw new ApiError(404, "Uppgiften hittades inte.");
    const encoder = new TextEncoder();
    let close = () => undefined as void;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let open = true;
        const send = (text: string) => { if (open) try { controller.enqueue(encoder.encode(text)); } catch { finish(); } };
        const event = (data: TaskLiveEvent) => send(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
        send("retry: 2000\n\n");
        const leave = joinTask(task.id, { id: ctx.user.id, name: ctx.user.name || ctx.user.email }, event);
        event({ type: "presence", editors: taskEditors(task.id) });
        const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
        const lifetime = setTimeout(() => finish(), LIFETIME_MS);
        function finish() {
          if (!open) return;
          open = false;
          clearInterval(heartbeat);
          clearTimeout(lifetime);
          leave();
          try { controller.close(); } catch { /* already closed */ }
        }
        close = finish;
        request.signal.addEventListener("abort", finish);
      },
      cancel() { close(); },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        // A proxy in front (nginx) must pass each event at once instead of buffering the stream.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
