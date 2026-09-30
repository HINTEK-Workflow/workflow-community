import { formLeafBlocks, formOptionalSections, initialFormValues, type FormColumn, type FormDocument, type FormFieldBlock, type FormValues } from "./form-document";

/**
 * Example answers for the editor's preview (2026-09-26): with or without deviations, so formulas, totals,
 * deviations and the requirements for completion can be checked before publishing. Clearly example data; nothing is
 * stored. Signatures and dates are filled in as a person would.
 */
export function sampleFormValues(document: FormDocument, options: { deviations?: boolean; today?: string } = {}): FormValues {
  const deviations = Boolean(options.deviations);
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const values = initialFormValues(document);
  // Every moment is on in the preview, so the whole form is seen.
  for (const section of formOptionalSections(document)) values.sections[section.id] = true;
  const number = (item: { min: number | null; max: number | null; allowedMin?: number | null; allowedMax?: number | null }) => {
    const low = item.min ?? item.allowedMin ?? null;
    const high = item.max ?? item.allowedMax ?? null;
    if (deviations && low !== null) return Math.max(item.allowedMin ?? -Infinity, low > 0 ? low / 2 : low - 1);
    if (deviations && high !== null) return Math.min(item.allowedMax ?? Infinity, high + 1);
    if (low !== null && high !== null) return (low + high) / 2;
    if (low !== null) return low * 2 || low + 10;
    if (high !== null) return high / 2;
    return 10;
  };
  const choice = (options: string[], deviating: string[]) => (deviations ? deviating[0] : undefined) ?? options.find((option) => !deviating.includes(option)) ?? options[0] ?? null;
  const field = (block: FormFieldBlock) => {
    switch (block.input) {
      case "text": return "Exempel";
      case "textarea": return "Exempeltext för förhandsgranskningen.";
      case "number": return number(block);
      case "date": return today;
      case "datetime": return `${today}T08:00`;
      case "choice": { const picked = choice(block.options, block.deviationOptions); return block.multiple ? (picked ? [picked] : []) : picked; }
      // A switch among the moments (Autobedömning) is on, so conditions are shown working.
      case "yesno": return block.momentSwitch ? "YES" : deviations && block.deviationOn !== "NONE" ? block.deviationOn : block.deviationOn === "YES" ? "NO" : "YES";
    }
  };
  const cell = (column: FormColumn) => column.input === "number" ? number(column) : column.input === "choice" ? choice(column.options, column.deviationOptions) : column.input === "yesno" ? "YES"
    : column.input === "text" ? "Exempel" : column.input === "textarea" ? "Exempeltext." : column.input === "date" ? today : column.input === "images" ? []
    : column.input === "check" || column.input === "assessment" ? true : column.input === "scale" ? Math.min(2, column.options.length) || null : null;
  let deviated = false;
  for (const block of formLeafBlocks(document)) {
    if (block.type === "field") values.fields[block.key] = field(block);
    if (block.type === "checklist") values.checklists[block.key] = Object.fromEntries(block.items.map((item, index) => {
      const bad = deviations && index === 0;
      return [item.id, { state: bad ? "NOT_OK" as const : "OK" as const, comment: bad ? "Exempel på en avvikelse." : "" }];
    }));
    if (block.type === "table") {
      const rows = block.rowMode === "fixed" ? values.tables[block.key] : Array.from({ length: 3 }, (_, index) => ({ id: `row-${index + 1}`, label: "", cells: {} }));
      // When asked, the last row deviates: its first number column gets a low value, so an interval or a row formula
      // such as [uppmätt] >= [gräns] shows as a deviation.
      const firstNumber = block.columns.find((column) => column.input === "number");
      // An example value set in the form is used first, so a condition such as the control's rules is met.
      values.tables[block.key] = rows.map((row, index) => ({ ...row, cells: Object.fromEntries(block.columns.filter((column) => column.input !== "formula").map((column) => {
        const deviating = deviations && index === rows.length - 1 && column === firstNumber;
        return [column.key, deviating ? (column.max !== null && column.min === null ? column.max + 1 : column.min !== null ? column.min / 2 - 1 : 0) : column.exampleValue ?? cell(column)];
      })) }));
    }
    if (block.type === "signature") values.signatures[block.key] = { name: "Exempel Exempelsson", confirmed: true, signedAt: null };
    deviated ||= deviations;
  }
  if (deviated) values.deviationComment = "Exempel på en kommentar till avvikelserna.";
  return values;
}
