export type CloudOriginVersion = { id: string; version: number };
export type CloudCurrentVersion = { version: number; status?: string } | null;

export const MAX_CLOUD_WORKSPACE_RECORDS = 500;
export const MAX_CLOUD_WORKSPACE_BUNDLE_BYTES = 50_000_000;
/** Comments in one .hwf file (a company with more gets the zip file, where they are read in parts). */
export const MAX_CLOUD_WORKSPACE_COMMENTS = 5_000;

// A caller must load current only inside the signed-in organization.
// COPY_CONFLICT never updates or deletes the Cloud original.
export function planCloudReimport(
  origin: CloudOriginVersion | undefined,
  current: CloudCurrentVersion,
): "CREATE" | "UPDATE" | "COPY_CONFLICT" {
  if (!origin) return "CREATE";
  if (!current || current.version !== origin.version || current.status === "COMPLETED" || current.status === "CANCELLED")
    return "COPY_CONFLICT";
  return "UPDATE";
}
