import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ControlData } from "./model";
import { attachmentLabel } from "./editor-tools";
import { read } from "./storage";
import {
  createExcelReport,
  createPdfReport,
  type ReportIdentity,
} from "./report-core";

type FileItem = {
  filename: string;
  storagePath: string;
  mimeType: string;
  section: string;
  rowId: string | null;
};

type ServerReportIdentity = Omit<ReportIdentity, "logoBytes"> & {
  logoPath?: string | null;
};

export async function pdfReport(
  data: ControlData,
  identity: ServerReportIdentity,
  files: FileItem[],
  template = false,
) {
  const [fontBytes, logoBytes, reportFiles] = await Promise.all([
    readFile(path.join(process.cwd(), "public/fonts/DejaVuSans.ttf")),
    identity.logoPath ? read(identity.logoPath).catch(() => null) : null,
    Promise.all(
      files.map(async (file) => ({
        filename: file.filename,
        mimeType: file.mimeType,
        section: file.section,
        rowId: file.rowId,
        label: attachmentLabel(data, file),
        bytes: file.mimeType.startsWith("image/")
          ? await read(file.storagePath).catch(() => undefined)
          : undefined,
      })),
    ),
  ]);
  return createPdfReport(
    data,
    { ...identity, logoBytes: logoBytes ?? undefined },
    reportFiles,
    template,
    fontBytes,
  );
}

export async function excelReport(
  data: ControlData,
  identity: ServerReportIdentity,
  template = false,
  attachmentCount?: number,
) {
  return createExcelReport(data, identity, template, attachmentCount);
}
