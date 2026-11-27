import { ApiError } from "@/lib/kfid/errors";
import { parseLocalWorkspaceBundle } from "@/features/kfid/local-workspace-bundle";

/**
 * Reads an uploaded .hwf Cloud copy on the server. A file from another company or a damaged file is the user's input,
 * not a server fault, so it becomes a clear 422 instead of a generic 500 (totalkontrollen F2, 2026-09-29).
 */
export async function parseUploadedCloudBundle(file: Blob, organizationId: string) {
  try {
    return await parseLocalWorkspaceBundle(file, organizationId);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error ? error.message : "";
    if (message.includes("annat Workflow-företag"))
      throw new ApiError(422, "Filen tillhör ett annat företag och kan inte återimporteras här.");
    if (message.startsWith("Arbetsytefilen kunde inte öppnas"))
      throw new ApiError(422, message);
    throw error;
  }
}
