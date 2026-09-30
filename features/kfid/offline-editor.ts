// Standalone offline form. Shares V3 fields, schema and evaluation rules; never calls private APIs.
import {
  blankControl,
  normalizeControl,
  newRow,
  sections,
  sectionKeys,
  visualFields,
  evaluate,
  ruleSummary,
  type ControlData,
  type Field,
} from "../../lib/kfid/model";
import { createPortableControlExport } from "../../lib/kfid/portable";
const root = document.getElementById("offline-editor")!;
const status = document.getElementById("offline-status")!;
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  return e;
}
function start() {
  const owner = JSON.parse(
    localStorage.getItem("kfid.offline.owner") || "null",
  ) as { email: string; organizationId: string; name: string } | null;
  // The signed-in workspace stores the owner only for an account that may sign in (Fas 1: no hard-coded address).
  if (!owner?.email || !owner.organizationId) {
    status.textContent =
      "Logga in online först för att förbereda ett lokalt utkast på den här enheten.";
    return;
  }
  const key = `kfid.v3.draft.${owner.email}.${owner.organizationId}`;
  const stored = JSON.parse(localStorage.getItem(key) || "null");
  const data: ControlData = stored?.data
    ? normalizeControl(stored.data)
    : blankControl();
  if (!stored) data.meta.perf = owner.name || "";
  let draft = {
    id: stored?.id || "",
    version: stored?.version || 0,
    customerId: stored?.customerId || null,
    status: stored?.status || "DRAFT",
    dirty: Boolean(stored?.dirty),
    data,
  };
  if (draft.status === "COMPLETED") {
    status.textContent =
      "Den senaste kontrollen är färdigställd. Öppna en ny kontroll online innan du arbetar vidare offline.";
    return;
  }
  status.textContent =
    "Utkastet lagras bara på den här enheten. Logga in online för att spara på servern. Kunder, bilagor, krediter, rapporter och AI kräver internet.";
  const message = element("p");
  message.setAttribute("role", "status");
  root.append(message);
  function persist() {
    try {
      draft = { ...draft, data, dirty: true };
      localStorage.setItem(key, JSON.stringify(draft));
      message.textContent = `Utkast sparat lokalt ${new Date().toLocaleTimeString("sv-SE", { timeZone: "Europe/Stockholm" })}`;
    } catch {
      message.textContent =
        "Kunde inte spara lokalt. Ladda ned utkastet innan du stänger.";
    }
  }
  function field(
    parent: HTMLElement,
    f: Field,
    value: unknown,
    change: (v: string | boolean) => void,
  ) {
    const label = element("label", f.label);
    let input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (f.options) {
      input = element("select");
      for (const v of f.options) {
        const option = element("option", v);
        option.value = v;
        input.append(option);
      }
      input.value = String(value ?? "");
    } else {
      input = element("input");
      input.type =
        f.type === "checkbox"
          ? "checkbox"
          : f.type === "number"
            ? "number"
            : "text";
      if (input.type === "number") input.step = "any";
      if (input.type === "checkbox") input.checked = value === true;
      else input.value = String(value ?? "");
    }
    input.addEventListener("input", () => {
      change(
        input instanceof HTMLInputElement && input.type === "checkbox"
          ? input.checked
          : input.value,
      );
      persist();
    });
    label.append(input);
    parent.append(label);
  }
  const meta = element("section");
  meta.append(element("h2", "Projekt och instrument"));
  const grid = element("div");
  grid.className = "grid";
  for (const [key, label] of Object.entries({
    proj: "Projekt / anläggning",
    date: "Datum",
    perf: "Utfört av",
    ctrl: "Kontrollerat av",
    client: "Kontaktperson",
    addr: "E-post",
    instr: "Instrument (typ)",
    sn: "Instrument S/N",
    cal: "Kalibrering",
  })) {
    field(
      grid,
      { key, label },
      data.meta[key as keyof typeof data.meta],
      (v) => {
        data.meta = { ...data.meta, [key]: v };
      },
    );
  }
  meta.append(grid);
  root.append(meta);
  for (const k of sectionKeys) {
    const section = element("section");
    field(
      section,
      { key: k, label: `Aktivera ${sections[k].title}`, type: "checkbox" },
      data.active[k],
      (v) => {
        data.active[k] = v === true;
        rows.hidden = !data.active[k];
      },
    );
    const rows = element("div");
    rows.hidden = !data.active[k];
    function render() {
      rows.replaceChildren();
      data[k].rows.forEach((row, index) => {
        const card = element("fieldset");
        card.append(
          element(
            "legend",
            `${sections[k].title} · Rad ${index + 1}${row.example ? " · EXEMPELDATA" : ""}`,
          ),
        );
        const g = element("div");
        g.className = "grid";
        const result = element("p");
        function recalc() {
          if (data.meta.autoOn) row.ok = evaluate(k, row);
          result.textContent = row.ok
            ? "Godkänd enligt vald V1-regel"
            : "Ej godkänd / ej bedömd";
        }
        for (const f of [
          ...sections[k].fields,
          { key: "comment", label: "Kommentar" },
        ])
          field(g, f, row[f.key], (v) => {
            row[f.key] = v;
            recalc();
          });
        if (!data.meta.autoOn)
          field(
            g,
            { key: "ok", label: "Manuellt godkänd", type: "checkbox" },
            row.ok,
            (v) => {
              row.ok = v === true;
              recalc();
            },
          );
        recalc();
        card.append(g, result);
        const remove = element("button", "Ta bort rad");
        remove.type = "button";
        remove.className = "secondary";
        remove.onclick = () => {
          data[k].rows.splice(index, 1);
          persist();
          render();
        };
        card.append(remove);
        rows.append(card);
      });
      const add = element("button", "Lägg till rad");
      add.type = "button";
      add.onclick = () => {
        if (data[k].rows.length >= 300) return;
        data[k].rows.push(newRow(k));
        persist();
        render();
      };
      rows.append(add);
    }
    render();
    section.append(rows);
    root.append(section);
  }
  const vis = element("section");
  vis.append(element("h2", "Visuell kontroll och sammanfattning"));
  field(
    vis,
    { key: "vis", label: "Aktivera visuell kontroll", type: "checkbox" },
    data.active.vis,
    (v) => {
      data.active.vis = v === true;
    },
  );
  for (const f of visualFields)
    field(vis, { ...f, type: "checkbox" }, data.vis.checks[f.key], (v) => {
      data.vis.checks[f.key] = v === true;
    });
  const label = element("label", "Sammanfattning / kommentarer");
  const comment = element("textarea");
  comment.value = data.vis.comment;
  comment.rows = 6;
  comment.maxLength = 15000;
  comment.oninput = () => {
    data.vis.comment = comment.value;
    persist();
  };
  label.append(comment);
  vis.append(label);
  const summarize = element("button", "Sammanställ resultat");
  summarize.type = "button";
  summarize.onclick = () => {
    data.vis.comment = ruleSummary(normalizeControl(data));
    comment.value = data.vis.comment;
    persist();
  };
  vis.append(summarize);
  root.append(vis);
  const actions = element("section");
  const download = element("button", "Ladda ned utkast som JSON");
  download.type = "button";
  download.onclick = () => {
    try {
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(createPortableControlExport(data), null, 2)], {
          type: "application/json",
        }),
      );
      const a = element("a");
      a.href = url;
      a.download = "kfid-offline-utkast.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      message.textContent =
        "Kontrollera fälten innan du exporterar, bland annat e-postadressen.";
    }
  };
  actions.append(download);
  const online = element("a", "Återgå till Workflow och spara");
  online.href = "/?view=new";
  actions.append(online);
  root.append(actions);
}
try {
  start();
} catch {
  status.textContent =
    "Det lokala utkastet kunde inte läsas. Återanslut till Workflow för att fortsätta.";
}
