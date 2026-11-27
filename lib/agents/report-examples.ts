import { fillReport, REPORT_TEMPLATE_KEYS } from "./report-template";
import type { RunReport } from "./model";

/**
 * The PDF editor's examples of Agentrapport (and the demo's): invented records only, no real names, no limit values. Every report
 * template has one, and "empty" shows the plain "Inget att rapportera".
 */
export function exampleAgentReport(key: string): RunReport {
  if (key === "empty") return fillReport("weekly_work_orders", { title: "Veckans arbetsorder", summary: "", sections: [{ heading: "Saknar ansvarig", rows: [] }] });
  const template = (REPORT_TEMPLATE_KEYS as readonly string[]).includes(key) ? key : "general";
  const rows = (titles: string[]) => titles.map((title, index) => ({ title, detail: `Klart senast 2026-11-${String(24 + index).padStart(2, "0")}` }));
  const parts: Record<string, Parameters<typeof fillReport>[1]> = {
    deviations: { title: "Månadens tillbud", summary: "Två tillbud och tre avvikelser registrerades i månaden.", facts: [{ label: "Avvikelser", value: "5" }, { label: "Tillbud", value: "2" }, { label: "Personskada", value: "0" }],
      sections: [{ heading: "Avvikelser, tillbud och olycksfall", rows: [{ title: "#14 Halkade på stege", detail: "Hög" }, { title: "#15 Öppen kopplingsdosa i trapphus", detail: "Normal" }, { title: "#16 Saknad märkning i central", detail: "Låg" }] }],
      ai: "Tillbudet med stegen väger tyngst: det är registrerat som Hög och kunde ha gett en personskada. Den öppna kopplingsdosan bör följas upp snabbt eftersom den står i ett allmänt utrymme.",
      nextSteps: ["Arbetsmiljöansvarig eller elsäkerhetsansvarig avgör vad som ska göras."] },
    weekly_work_orders: { title: "Veckans arbetsorder", summary: "12 arbetsordrar den här veckan. 3 saknar ansvarig och 1 är förfallen.", facts: [{ label: "Arbetsordrar", value: "12" }], sections: [{ heading: "Saknar ansvarig", rows: rows(["Byte av armatur", "Service ventilation", "Felsökning jordfelsbrytare"]) }] },
    time: { title: "Min veckotid", summary: "32,5 timmar den här veckan.", sections: [{ heading: "Per arbetsorder och projekt", rows: [{ title: "Elrenovering", detail: "20 timmar" }, { title: "Service", detail: "12,5 timmar" }] }] },
    pending_invoicing: { title: "Fakturaunderlag som väntar", summary: "2 färdiga arbetsordrar är inte fakturerade.", sections: [{ heading: "Inte fakturerat", rows: [{ title: "Byte av central", detail: "8 400 kr exkl. moms" }, { title: "Belysning garage", detail: "3 150 kr exkl. moms" }] }] },
    quotes_waiting: { title: "Offerter som väntar", summary: "2 skickade offerter väntar på svar.", sections: [{ heading: "Väntar på svar", rows: [{ title: "Offert 1042: Laddbox", detail: "Skickad 2026-11-10" }, { title: "Offert 1045: Elcentral", detail: "gäller till 2026-11-30" }] }] },
    capacity: { title: "Nästa veckas kapacitet", summary: "18 bokningar nästa vecka. 2 arbetsordrar saknar bokning.", sections: [{ heading: "Per person", rows: [{ title: "Montör A", detail: "32 timmar bokade" }, { title: "Montör B", detail: "16 timmar bokade, frånvaro i veckan" }] }] },
    calibrations: { title: "Kalibreringar och behörigheter", summary: "1 instrument och 1 intyg går ut inom 60 dagar.", sections: [{ heading: "Instrument att kalibrera", rows: [{ title: "Installationstestare (EX-1)", detail: "Nästa kalibrering 2026-12-20" }] }, { heading: "Intyg som går ut", rows: [{ title: "Arbete på väg", detail: "gäller till 2027-01-05" }] }] },
    weekly_news: { title: "Veckonyhet", summary: "Den här veckan har vi bytt belysning i en skola.", sections: [], ai: "Den här veckan har vi bytt belysning i en skola och gjort service på ventilationen i ett kontor." },
    internal_news: { title: "Veckans planering", summary: "Den här veckan finns 18 bokningar i planeringen.", sections: [{ heading: "Saknar bokning", rows: rows(["Service ventilation"]) }] },
    general: { title: "Rapport", summary: "Workflow hämtade 8 arbetsordrar och Workflow AI sammanfattade dem.", sections: [{ heading: "Arbetsordrar", rows: rows(["Byte av armatur", "Service ventilation"]) }], ai: "Det mesta av veckans arbete gällde belysning och service. Två arbetsordrar ska vara klara nästa vecka." },
  };
  return fillReport(template, parts[template]!);
}
