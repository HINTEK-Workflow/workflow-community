/** **Bold** runs inside a paragraph or list item. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return <>{parts.map((part, index) => (index % 2 ? <strong key={index} className="font-semibold">{part}</strong> : part))}</>;
}

export function LegalDocumentContent({ content }: { content: string }) {
  const blocks = content.replace(/\r\n/g, "\n").trim().split(/\n\s*\n/);
  return (
    <div className="space-y-3 text-sm leading-7 text-foreground">
      {blocks.map((block, index) => {
        const text = block.replace(/\n/g, " ").trim();
        // The machine-readable price block (<!-- hintek-prisblock … -->) is part of the hashed text but not shown.
        if (text.startsWith("# ") || text.startsWith("<!--")) return null;
        if (text.startsWith("## "))
          return (
            <h2 key={index} className="pt-5 text-base font-semibold first:pt-0">
              {text.slice(3)}
            </h2>
          );
        if (block.startsWith("- ")) {
          // A list item may continue on indented lines.
          const items = block.split(/\n(?=- )/).map((item) => item.slice(2).replace(/\n\s*/g, " ").trim());
          return (
            <ul key={index} className="list-disc space-y-1 pl-5">
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
