/** **Bold** runs inside a paragraph or list item. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((part, index) => (index % 2 ? <strong key={index} className="font-semibold">{part}</strong> : part))}</>;
}

/** The line under a document's title: "Version 2026-11-06.1 – gäller från 6 november 2026". */
const VERSION_LINE = /^Version\s+\S+\s+[–-]\s+gäller\s+från\s+/i;

/** The version line of a document's text, if its first paragraph is one (shown in the small box under the title on the page). */
export function legalVersionLine(content: string): string | null {
  const first = content.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/).find((block) => !block.trim().startsWith("# ") && !block.trim().startsWith("<!--"));
  const text = first?.replace(/\n/g, " ").trim() ?? "";
  return VERSION_LINE.test(text) ? text : null;
}

/**
 * A legal document's text. `page` is the public page (2026-11-11, "Typografi – Workflow styr"): 16 px body with line
 * height 1.65, H2 24 px and H3 19 px, and the version line left out because the page shows it in the box under the title.
 * Without it (the guide, the administration) the text stays compact. The text itself is never changed.
 */
export function LegalDocumentContent({ content, page = false }: { content: string; page?: boolean }) {
  const blocks = content.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  const versionLine = page ? legalVersionLine(content) : null;
  return (
    <div className={page ? "space-y-4 text-base leading-[1.65] text-foreground" : "space-y-3 text-sm leading-7 text-foreground"} data-testid={page ? "legal-text" : undefined}>
      {blocks.map((block, index) => {
        const text = block.replace(/\n/g, " ").trim();
        // The machine-readable price block (<!-- hintek-prisblock … -->) is part of the hashed text but not shown.
        if (text.startsWith("# ") || text.startsWith("<!--")) return null;
        if (versionLine && text === versionLine) return null;
        if (text.startsWith("### "))
          return (
            <h3 key={index} className={page ? "pt-2 text-[1.1875rem] font-bold leading-[1.3]" : "pt-3 text-sm font-semibold"}>
              {text.slice(4)}
            </h3>
          );
        if (text.startsWith("## "))
          return (
            <h2 key={index} className={page ? "pt-6 text-2xl font-bold leading-[1.3] tracking-[-.01em] first:pt-0" : "pt-5 text-base font-semibold first:pt-0"}>
              {text.slice(3)}
            </h2>
          );
        if (block.startsWith("- ")) {
          // A list item may continue on indented lines.
          const items = block.split(/\n(?=- )/).map((item) => item.slice(2).replace(/\n\s*/g, " ").trim());
          return (
            <ul key={index} className={page ? "list-disc space-y-1.5 pl-6" : "list-disc space-y-1 pl-5"}>
              {items.map((item) => (
                <li key={item}><Inline text={item} /></li>
              ))}
            </ul>
          );
        }
        return <p key={index}><Inline text={text} /></p>;
      })}
    </div>
  );
}
