import {
  createLocalWorkspaceBundle,
  parseLocalWorkspaceBundle,
  type LocalWorkspaceBundleImport,
} from "./local-workspace-bundle";
import type { LocalAttachmentStore } from "./local-attachments";
import type { LocalWorkspaceDocument } from "./local-workspace-store";

const DATABASE_NAME = "kfid-local-workspaces";
const DATABASE_VERSION = 2;
const RECOVERY_STORE = "recoveries";

type RecoveryRecord = {
  organizationId: string;
  workspaceId: string;
  updatedAt: string;
  bundle: Blob;
};

function openRecoveryDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("directories"))
        request.result.createObjectStore("directories");
      if (!request.result.objectStoreNames.contains(RECOVERY_STORE))
        request.result.createObjectStore(RECOVERY_STORE, {
          keyPath: "organizationId",
        });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openRecoveryDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(RECOVERY_STORE, mode);
      const request = operation(transaction.objectStore(RECOVERY_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function saveLocalWorkspaceRecovery(
  workspace: LocalWorkspaceDocument,
  store: LocalAttachmentStore,
) {
  const bundle = await createLocalWorkspaceBundle(workspace, store);
  const record: RecoveryRecord = {
    organizationId: workspace.cloudBinding.organizationId,
    workspaceId: workspace.workspaceId,
    updatedAt: workspace.updatedAt,
    bundle,
  };
  await runRequest("readwrite", (target) => target.put(record));
}

export async function loadLocalWorkspaceRecovery(
  organizationId: string,
): Promise<(LocalWorkspaceBundleImport & { workspaceId: string }) | null> {
  const record = await runRequest<RecoveryRecord | undefined>(
    "readonly",
    (target) => target.get(organizationId),
  );
  if (!record) return null;
  const parsed = await parseLocalWorkspaceBundle(record.bundle, organizationId);
  if (parsed.workspace.workspaceId !== record.workspaceId)
    throw new Error("Den lokala återställningskopian har en ogiltig identitet.");
  return { ...parsed, workspaceId: record.workspaceId };
}

export async function deleteLocalWorkspaceRecovery(organizationId: string) {
  await runRequest("readwrite", (target) => target.delete(organizationId));
}
