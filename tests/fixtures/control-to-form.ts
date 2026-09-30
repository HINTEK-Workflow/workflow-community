import type { ControlData } from "../../lib/kfid/model";
import { sectionKeys } from "../../lib/kfid/model";
import { emptyFormValues, type FormValues } from "../../lib/workflow/form-document";

/**
 * Today's control data as answers to the Kontroll före idrifttagning form, for comparing the two reports (
 * 2026-09-27). Old controls stay in their own engine; this is only used by the tests. Numbers are written the way the
 * control prints them ("0.4"), so the comparison shows the layout and not the decimal separator.
 */
export function controlToFormValues(data: ControlData, files: { id: string; section: string; rowId: string | null }[] = []): FormValues {
  const values = emptyFormValues();
  const text = (value: unknown) => typeof value === "number" ? String(value) : value ?? "";
  const { meta } = data;
  values.fields = { proj: meta.proj, perf: meta.perf, date: meta.date, client: meta.client, addr: meta.addr, ctrl: meta.ctrl, instr: meta.instr, sn: meta.sn, cal: meta.cal, auto: meta.autoOn ? "YES" : "NO" };
  for (const key of [...sectionKeys, "vis"] as const) values.sections[`kfid-${key}`] = data.active[key];
  for (const key of sectionKeys) {
    values.tables[key] = data[key].rows.map((row) => {
      const cells: Record<string, string | number | boolean | string[] | null> = {};
      for (const [name, value] of Object.entries(row)) if (!["uid", "example"].includes(name)) cells[name] = typeof value === "boolean" ? value : text(value) as string;
      cells.bild = files.filter((file) => file.section === key && file.rowId === row.uid).map((file) => file.id);
      return { id: String(row.uid), label: "", cells, ...(row.example === true ? { example: true } : {}) };
    });
    values.images[`${key}_bilder`] = files.filter((file) => file.section === key && !file.rowId).map((file) => file.id);
  }
  values.images.vis_bilder = files.filter((file) => !sectionKeys.includes(file.section as never)).map((file) => file.id);
  values.checklists.vis = Object.fromEntries(["markning", "dok", "mek", "ip"].map((item) => [item, { state: data.vis.checks[item] === true ? "OK" as const : data.vis.checks[item] === false ? "NOT_OK" as const : null, comment: "" }]));
  values.deviationComment = data.vis.comment;
  return values;
}
