import { workflowTaskAttachmentLimit } from "@/lib/workflow/task-model";
import type {
  LocalAttachment,
  LocalWorkspaceDocument,
} from "./local-workspace-store";

export const LOCAL_FILES_DIRECTORY = "kfid-files";
const MAX_FILE_SIZE = 10_000_000;

type PreparedFile = {
  bytes: Uint8Array;
  extension: "jpg" | "png" | "webp" | "pdf" | "txt" | "doc" | "docx" | "xls" | "xlsx";
  mimeType: string;
  image: boolean;
};

export type LocalAttachmentStore = {
  read: (attachment: LocalAttachment) => Promise<Blob>;
  write: (attachment: LocalAttachment, contents: Blob) => Promise<void>;
  remove: (attachment: LocalAttachment) => Promise<void>;
};

function startsWith(bytes: Uint8Array, signature: number[]) {
  return signature.every((value, index) => bytes[index] === value);
}

async function prepareFile(file: File): Promise<PreparedFile> {
  if (!file.size || file.size > MAX_FILE_SIZE)
    throw new Error("Välj en fil på högst 10 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const lower = file.name.toLocaleLowerCase("sv-SE");
  if (startsWith(bytes, [0xff, 0xd8, 0xff]))
    return { bytes, extension: "jpg", mimeType: "image/jpeg", image: true };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return { bytes, extension: "png", mimeType: "image/png", image: true };
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return { bytes, extension: "webp", mimeType: "image/webp", image: true };
  if (String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-")
    return { bytes, extension: "pdf", mimeType: "application/pdf", image: false };
  if (lower.endsWith(".txt") && !bytes.includes(0))
    return { bytes, extension: "txt", mimeType: "text/plain", image: false };
  if (startsWith(bytes, [0x50, 0x4b]) && /\.(docx|xlsx)$/.test(lower)) {
    const extension = lower.endsWith(".docx") ? "docx" : "xlsx";
    return { bytes, extension, mimeType: "application/octet-stream", image: false };
  }
  if (
    startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) &&
    /\.(doc|xls)$/.test(lower)
  ) {
    const extension = lower.endsWith(".doc") ? "doc" : "xls";
    return { bytes, extension, mimeType: "application/octet-stream", image: false };
  }
  throw new Error(
    "Tillåtna filer: JPG, PNG, WebP, PDF, TXT, DOC/DOCX och XLS/XLSX.",
  );
}

async function resourceDirectory(
  directory: FileSystemDirectoryHandle,
  resourceId: string,
  create: boolean,
) {
  const root = await directory.getDirectoryHandle(LOCAL_FILES_DIRECTORY, {
    create,
  });
  return root.getDirectoryHandle(resourceId, { create });
}

export function createDirectoryLocalAttachmentStore(
  directory: FileSystemDirectoryHandle,
): LocalAttachmentStore {
  return {
    async read(attachment) {
      const folder = await resourceDirectory(
        directory,
        attachment.taskId,
        false,
      );
      const handle = await folder.getFileHandle(attachment.storageName);
      return handle.getFile();
    },
    async write(attachment, contents) {
      const target = await resourceDirectory(
        directory,
        attachment.taskId,
        true,
      );
      const handle = await target.getFileHandle(attachment.storageName, {
        create: true,
      });
      const writable = await handle.createWritable();
      await writable.write(contents);
      await writable.close();
    },
    async remove(attachment) {
      const folder = await resourceDirectory(
        directory,
        attachment.taskId,
        false,
      );
      await folder.removeEntry(attachment.storageName);
    },
  };
}

export function createMemoryLocalAttachmentStore(
  initialFiles: ReadonlyMap<string, Blob> = new Map(),
): LocalAttachmentStore {
  const files = new Map(initialFiles);
  return {
    async read(attachment) {
      const file = files.get(attachment.id);
      if (!file)
        throw new Error(`Bilagan ”${attachment.filename}” saknas i arbetsytefilen.`);
      return file;
    },
    async write(attachment, contents) {
      files.set(attachment.id, contents);
    },
    async remove(attachment) {
      files.delete(attachment.id);
    },
  };
}

export async function stageLocalWorkflowTaskAttachment(store: LocalAttachmentStore, workspace: LocalWorkspaceDocument, input: { taskId: string; file: File; receipt?: boolean }) {
  const task = workspace.workflowTasks.find((item) => item.id === input.taskId);
  if (!task) throw new Error("Uppgiften hittades inte i den lokala arbetsytan.");
  if (task.status === "COMPLETED") throw new Error("En slutförd uppgift kan inte ändras.");
  const limit = workflowTaskAttachmentLimit(task.kind);
  if (workspace.attachments.filter((item) => item.taskId === task.id).length >= limit) throw new Error(`Max ${limit} bilagor per uppgift.`);
  const prepared = await prepareFile(input.file);
  if (["doc", "xls"].includes(prepared.extension)) throw new Error("Tillåtna filer: JPG, PNG, WebP, PDF, TXT, DOCX och XLSX.");
  const id = crypto.randomUUID();
  const attachment: LocalAttachment = {
    id,
    taskId: task.id,
    filename: input.file.name.trim().slice(0, 200) || `bilaga.${prepared.extension}`,
    storageName: `${id}.${prepared.extension}`,
    mimeType: prepared.mimeType,
    size: prepared.bytes.byteLength,
    section: "vis",
    rowId: null,
    ...(input.receipt && prepared.image ? { receipt: true } : {}),
    createdAt: new Date().toISOString(),
  };
  await store.write(attachment, new Blob([prepared.bytes as BlobPart], { type: attachment.mimeType }));
  return { workspace: { ...workspace, attachments: [...workspace.attachments, attachment] }, attachment };
}

export async function removeLocalAttachmentFiles(
  store: LocalAttachmentStore,
  attachments: LocalAttachment[],
) {
  await Promise.allSettled(
    attachments.map((item) => store.remove(item)),
  );
}
