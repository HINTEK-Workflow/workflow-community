"use client";
import { useRef } from "react";
import { Download, Printer, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "./ui";
import { useInstance } from "@/components/instance-provider";
export function ReportPreview({
  url,
  onClose,
}: {
  url: string | null;
  onClose: () => void;
}) {
  const { features } = useInstance();
  const frame = useRef<HTMLIFrameElement>(null);
  const inlineUrl = url?.startsWith("blob:") ? url : `${url}?inline=true`;
  return (
    <Modal
      open={Boolean(url)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Rapportförhandsgranskning"
    >
      {url && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                frame.current?.contentWindow?.focus();
                frame.current?.contentWindow?.print();
              }}
            >
              <Printer />
              Skriv ut
            </Button>
            <Button asChild variant="outline">
              <a href={url} download>
                <Download />
                PDF
              </a>
            </Button>
            <Button asChild variant="outline">
              <a
                href={inlineUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ArrowUpRight />
                Öppna i egen flik
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Rapporten är redan skapad.{features.credits ? " Förhandsgranskning, utskrift och ny nedladdning använder inga fler krediter." : ""}
          </p>
          <iframe
            ref={frame}
            title="PDF-rapport"
            className="h-[65vh] w-full rounded-lg border"
            src={inlineUrl}
          />
        </div>
      )}
    </Modal>
  );
}
