export type CloudOriginVersion = { id: string; version: number };
export type CloudCurrentVersion = { version: number; status?: string } | null;
export type CloudAttachmentSnapshot = { attachmentIds?: string[] };

export const MAX_CLOUD_WORKSPACE_RECORDS = 500;
export const MAX_CLOUD_WORKSPACE_BUNDLE_BYTES = 50_000_000;

// A caller must load current only inside the signed-in organization.
// COPY_CONFLICT never updates or deletes the Cloud original.
export function planCloudReimport(
  origin: CloudOriginVersion | undefined,
  current: CloudCurrentVersion,
): "CREATE" | "UPDATE" | "COPY_CONFLICT" {
  if (!origin) return "CREATE";
  if (!current || current.version !== origin.version || current.status === "COMPLETED")
    return "COPY_CONFLICT";
  return "UPDATE";
}

// Attachments have no version field. A changed set on either side must not be
// merged into an existing control, even when the control version is unchanged.
export function planCloudControlReimport(
  origin: (CloudOriginVersion & CloudAttachmentSnapshot) | undefined,
  current: (CloudCurrentVersion & { attachmentIds?: string[] }) | null,
  localAttachmentOriginIds: string[],
  localAttachmentCount: number,
): "CREATE" | "UPDATE" | "COPY_CONFLICT" {
  const base = planCloudReimport(origin, current);
  if (base !== "UPDATE") return base;
  if (!origin?.attachmentIds || !current?.attachmentIds) return "COPY_CONFLICT";
  const same = (left: string[], right: string[]) =>
    left.length === right.length && left.every((id, index) => id === right[index]);
  const original = [...origin.attachmentIds].sort();
  if (!same(original, [...current.attachmentIds].sort()) ||
      !same(original, [...localAttachmentOriginIds].sort()) ||
      localAttachmentCount !== original.length) return "COPY_CONFLICT";
  return "UPDATE";
}
