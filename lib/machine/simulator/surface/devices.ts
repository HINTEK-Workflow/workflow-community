// PLC-simulatorn (2026-11-02): the field devices a person drags onto the drawing surface, as data. Every
// device has terminals and electrical elements: a contact joins two terminals when closed, a load is energised between a + and
// a − of one supply, a source puts 0–10 V on a signal terminal once it has its supply, a sink reads 0–10 V, a supply (v3,
// 2026-11-03) is an external source with its own + and −, a meter shows the voltage between two terminals. Groups as the people
// using the system: Industri, Fastighet (vaktmästare, fastighetstekniker) and El (matning och mätning). Named generically; no
// maker's names anywhere.

export type DeviceGroup = "industri" | "fastighet" | "el";
export type TerminalRole = "supply" | "ground" | "analog" | "wire";
export const TERMINAL_ROLES = ["wire", "supply", "ground", "analog"] as const satisfies readonly TerminalRole[];
/**
 * An extra terminal a device design adds (PLC-apparater v2, 2026-11-07: "väljer man vilka anslutningar det skall vara"):
 * ids e1–e16, which no function uses, so a wire to one is never mistaken for a function's terminal.
 */
export const EXTRA_TERMINAL = /^e(?:[1-9]|1[0-6])$/;
export const isExtraTerminal = (id: string) => EXTRA_TERMINAL.test(id);
/**
 * A terminal. `id` is what wires and saved drawings refer to and never changes; `name` is the designation printed on the plate
 * when it differs from the id (a contact with the NO/NC option is marked 13/14 as NO and 11/12 as NC, as such devices are).
 */
export type TerminalDef = { id: string; role: TerminalRole; side: "top" | "bottom"; title?: string; name?: string | { no: string; nc: string } };
/** What closes a contact: the device's own state, read by the engine each cycle. */
export type ContactWhen = "pressed" | "on" | "energised" | "tripped" | "open" | "closed";
export type Element =
  | { kind: "contact"; a: string; b: string; name: string; when: ContactWhen; invert?: true | "nc-option" }
  | { kind: "load"; a: string; b: string }
  /** A 0–10 V signal on `terminal`; with `plus` null the source is self-powered and needs only its − as reference. */
  | { kind: "source"; terminal: string; plus: string | null; minus: string }
  | { kind: "sink"; terminal: string }
  /** An external DC supply: a fixed voltage, or the knob's value scaled to `maxVolts`. */
  | { kind: "supply"; plus: string; minus: string; volts: number | "knob"; maxVolts: number }
  | { kind: "meter"; plus: string; minus: string };
export type OptionDef = { key: string; label: string; choices: { value: string; label: string }[] };
export type Interaction = "momentary" | "toggle" | "knob" | null;

export const DEVICE_KINDS = [
  "knapp", "knapp_lampa", "nodstopp", "nodstoppsrela", "vippa", "valjare", "gransbrytare", "vred", "lampa", "summer", "motor", "ventil", "varmare", "nivagivare", "tempgivare", "rela", "kontaktor", "larm",
  "tilluftsflakt", "franluftsflakt", "spjall", "brandlarm", "givare_tilluft", "givare_franluft", "givare_ute", "givare_rum", "givare_fram", "tryckgivare",
  "varmebatteri", "cirkpump", "shunt", "varmekalla", "frysvakt",
  "kalla24", "kallajust", "kalla010", "kalla420", "signalsim", "voltmeter",
] as const;
export type DeviceKindId = (typeof DEVICE_KINDS)[number];
export const isDeviceKind = (value: string): value is DeviceKindId => (DEVICE_KINDS as readonly string[]).includes(value);

export type DeviceKindDef = {
  id: DeviceKindId; label: string; group: DeviceGroup;
  /** A short name for the palette's tiles; the full name is the tooltip. */
  name: string;
  /** One short line under the name in the palette. */
  short: string;
  width: number; height: number;
  terminals: TerminalDef[]; elements: Element[]; options: OptionDef[]; interaction: Interaction;
};

const twoWire = (a: string, b: string, side: "top" | "bottom" = "top"): TerminalDef[] => [{ id: a, role: "wire", side }, { id: b, role: "wire", side }];
/** One contact on terminals 1 and 2 (the ids), marked as a NO contact (13/14), a NC contact (11/12) or by the device's NO/NC option. */
const contactPair = (marking: "no" | "nc" | "option"): TerminalDef[] => marking === "option"
  ? [{ id: "1", role: "wire", side: "top", name: { no: "13", nc: "11" } }, { id: "2", role: "wire", side: "top", name: { no: "14", nc: "12" } }]
  : marking === "no" ? [{ id: "1", role: "wire", side: "top", name: "13" }, { id: "2", role: "wire", side: "top", name: "14" }] : [{ id: "1", role: "wire", side: "top", name: "11" }, { id: "2", role: "wire", side: "top", name: "12" }];
const load = (a: string, b: string): Element => ({ kind: "load", a, b });
const contact = (a: string, b: string, name: string, when: ContactWhen, invert?: true | "nc-option"): Element => ({ kind: "contact", a, b, name, when, ...(invert ? { invert } : {}) });
/** +, − and a signal terminal, the three-wire sensor or actuator an electrician knows. */
const threeWire: TerminalDef[] = [{ id: "+", role: "supply", side: "top", title: "+24 V" }, { id: "−", role: "ground", side: "top", title: "0 V" }, { id: "ut", role: "analog", side: "top", title: "0–10 V ut" }];
const threeWireIn: TerminalDef[] = [{ id: "1", role: "wire", side: "top" }, { id: "2", role: "wire", side: "top" }, { id: "styr", role: "analog", side: "top", title: "0–10 V in" }];
const sensorElements: Element[] = [{ kind: "source", terminal: "ut", plus: "+", minus: "−" }];
const controlledLoad: Element[] = [load("1", "2"), { kind: "sink", terminal: "styr" }];
const supplyTerminals: TerminalDef[] = [{ id: "+", role: "supply", side: "bottom", title: "+ (plus)" }, { id: "−", role: "ground", side: "bottom", title: "− (0 V)" }];

const NC_OPTION: OptionDef = { key: "nc", label: "Kontakt", choices: [{ value: "no", label: "Slutande (NO)" }, { value: "nc", label: "Brytande (NC)" }] };
const COLOUR_OPTION: OptionDef = { key: "color", label: "Färg", choices: [{ value: "green", label: "Grön" }, { value: "red", label: "Röd" }, { value: "yellow", label: "Gul" }, { value: "blue", label: "Blå" }, { value: "white", label: "Vit" }] };
/** A pushbutton's cap: by default green as NO and red as NC, else the chosen colour. */
const BUTTON_COLOUR_OPTION: OptionDef = { key: "color", label: "Färg", choices: [{ value: "auto", label: "Efter kontakt" }, { value: "green", label: "Grön" }, { value: "red", label: "Röd" }, { value: "yellow", label: "Gul" }, { value: "blue", label: "Blå" }, { value: "black", label: "Svart" }, { value: "white", label: "Vit" }] };
/** Fjädrande or låsande (2026-11-09: "se till att det går välja om den är momentary eller latch"): a latching button stays in until pushed again. */
// The English terms (2026-11-09: "finns inte bra ord på svenska så skriv den engelska termen").
const LATCH_OPTION: OptionDef = { key: "latch", label: "Funktion", choices: [{ value: "momentary", label: "Momentary" }, { value: "latch", label: "Latch" }] };
const SEVERITY_OPTION: OptionDef = { key: "severity", label: "Larmnivå", choices: [{ value: "warning", label: "Varning" }, { value: "fault", label: "Fel" }, { value: "critical", label: "Kritiskt" }] };

export const DEVICE_DEFS: Record<DeviceKindId, DeviceKindDef> = {
  knapp: { id: "knapp", label: "Tryckknapp", name: "Tryckknapp", group: "industri", short: "Sluter (NO, 13–14) eller bryter (NC, 11–12) medan du håller (momentary), eller tills du trycker igen (latch). Kåpan grön som NO och röd som NC om du inte väljer färg.", width: 72, height: 72, terminals: contactPair("option"), elements: [contact("1", "2", "knapp", "pressed", "nc-option")], options: [NC_OPTION, LATCH_OPTION, BUTTON_COLOUR_OPTION], interaction: "momentary" },
  knapp_lampa: { id: "knapp_lampa", label: "Belyst tryckknapp", name: "Belyst knapp", group: "industri", short: "Kontakten 13–14 (NC: 11–12) och lampan X1–X2 är oberoende av varandra.", width: 72, height: 84, terminals: [...contactPair("option"), ...twoWire("X1", "X2", "bottom")], elements: [contact("1", "2", "knapp", "pressed", "nc-option"), load("X1", "X2")], options: [NC_OPTION, LATCH_OPTION, COLOUR_OPTION], interaction: "momentary" },
  // 2026-11-09: an emergency stop – a red mushroom that breaks its contacts, stays in and is reset by a second push (a twist on the real one).
  // Two channels (2026-11-09: "nödstopp brukar ha två kanaler"): 11–12 on top and 21–22 below, both breaking.
  nodstopp: { id: "nodstopp", label: "Nödstopp", name: "Nödstopp", group: "industri", short: "Röd svampknapp med två kanaler. Kontakterna 11–12 och 21–22 är slutna i normalläge. Tryck, så bryter båda och knappen stannar inne. Tryck igen för att återställa.", width: 72, height: 96, terminals: [{ id: "1", role: "wire", side: "top", name: "11" }, { id: "2", role: "wire", side: "top", name: "12" }, { id: "3", role: "wire", side: "bottom", name: "21" }, { id: "4", role: "wire", side: "bottom", name: "22" }], elements: [contact("1", "2", "nodstopp", "on", true), contact("3", "4", "nodstopp2", "on", true)], options: [], interaction: "toggle" },
  // 2026-11-09: "Lägg även till ett enkelt nödstoppsrelä, med återställning". Simple and two-channel: A1–A2 feeds it, S12 and S22
  // read the emergency stop's two channels, S34 the reset button. With both channels at 24 V a press on reset pulls it in and 13–14 and
  // 23–24 close; a channel that opens drops it, and it stays out until reset again with both channels whole.
  nodstoppsrela: { id: "nodstoppsrela", label: "Nödstoppsrelä", name: "Nödstoppsrelä", group: "industri", short: "Övervakar nödstoppets två kanaler S12 och S22. Med båda på 24 V drar det när återställningen S34 får 24 V och sluter 13–14 och 23–24. Bryter en kanal släpper det.", width: 96, height: 84,
    terminals: [{ id: "A1", role: "supply", side: "top", title: "A1 (+24 V)" }, { id: "A2", role: "ground", side: "top", title: "A2 (0 V)" }, { id: "S12", role: "wire", side: "top", title: "Kanal 1 in" }, { id: "S22", role: "wire", side: "top", title: "Kanal 2 in" }, { id: "S34", role: "wire", side: "top", title: "Återställning in" },
      { id: "13", role: "wire", side: "bottom", title: "Säker utgång 1" }, { id: "14", role: "wire", side: "bottom", title: "Säker utgång 1" }, { id: "23", role: "wire", side: "bottom", title: "Säker utgång 2" }, { id: "24", role: "wire", side: "bottom", title: "Säker utgång 2" }],
    elements: [load("A1", "A2"), contact("13", "14", "k1", "on"), contact("23", "24", "k2", "on")], options: [], interaction: null },
  vippa: { id: "vippa", label: "Vippströmbrytare", name: "Vippa", group: "industri", short: "Till eller från, tills du vippar igen. Sluter 13–14 i läge I.", width: 72, height: 72, terminals: contactPair("no"), elements: [contact("1", "2", "vippa", "on")], options: [], interaction: "toggle" },
  valjare: { id: "valjare", label: "Vredomkopplare 0/I", name: "Omkopplare", group: "industri", short: "Vrid till I så sluter kontakten 13–14, tillbaka till 0 så bryter den.", width: 72, height: 72, terminals: contactPair("no"), elements: [contact("1", "2", "valjare", "on")], options: [], interaction: "toggle" },
  gransbrytare: { id: "gransbrytare", label: "Gränslägesbrytare", name: "Gränsläge", group: "industri", short: "Rullarmen påverkas av en maskindel, här med ett tryck. NO (13–14) eller NC (11–12).", width: 72, height: 72, terminals: contactPair("option"), elements: [contact("1", "2", "grans", "on", "nc-option")], options: [NC_OPTION], interaction: "toggle" },
  vred: { id: "vred", label: "Vred 0–10 V", name: "Vred 0–10 V", group: "industri", short: "Potentiometer: + och − matar, ut är släpkontakten med 0–10 V.", width: 84, height: 84, terminals: threeWire, elements: sensorElements, options: [], interaction: "knob" },
  lampa: { id: "lampa", label: "Lampa", name: "Lampa", group: "industri", short: "Lyser med X1 på en utgång och X2 på 0 V.", width: 64, height: 72, terminals: twoWire("X1", "X2"), elements: [load("X1", "X2")], options: [COLOUR_OPTION], interaction: null },
  summer: { id: "summer", label: "Summer", name: "Summer", group: "industri", short: "Ljuder när den får spänning.", width: 64, height: 72, terminals: twoWire("1", "2"), elements: [load("1", "2")], options: [], interaction: null },
  motor: { id: "motor", label: "Motor", name: "Motor", group: "industri", short: "24 V-motor med plintarna U1 och U2. Snurrar när den får spänning och fyller tanken.", width: 84, height: 84, terminals: twoWire("U1", "U2"), elements: [load("U1", "U2")], options: [], interaction: null },
  ventil: { id: "ventil", label: "Magnetventil", name: "Magnetventil", group: "industri", short: "Öppnar när den får spänning. Tömmer tanken.", width: 72, height: 72, terminals: twoWire("1", "2"), elements: [load("1", "2")], options: [], interaction: null },
  varmare: { id: "varmare", label: "Värmare", name: "Värmare", group: "industri", short: "Värmer ugnen: till/från, eller 0–10 V på styr.", width: 84, height: 72, terminals: threeWireIn, elements: controlledLoad, options: [], interaction: null },
  nivagivare: { id: "nivagivare", label: "Nivågivare", name: "Nivågivare", group: "industri", short: "Tankens nivå 0–100 % som 0–10 V.", width: 72, height: 96, terminals: threeWire, elements: sensorElements, options: [], interaction: null },
  tempgivare: { id: "tempgivare", label: "Temperaturgivare ugn", name: "Temp ugn", group: "industri", short: "0–200 °C som 0–10 V.", width: 60, height: 96, terminals: threeWire, elements: sensorElements, options: [], interaction: null },
  rela: { id: "rela", label: "Relä", name: "Relä", group: "industri", short: "Spolen A1–A2 växlar kontakten: 11–14 sluter, 11–12 bryter.", width: 84, height: 84, terminals: [{ id: "A1", role: "wire", side: "top", title: "A1, spole +" }, { id: "A2", role: "wire", side: "top", title: "A2, spole −" }, { id: "11", role: "wire", side: "bottom", title: "11, gemensam" }, { id: "12", role: "wire", side: "bottom", title: "12, sluten mot 11 i viloläge" }, { id: "14", role: "wire", side: "bottom", title: "14, sluten mot 11 när spolen drar" }], elements: [load("A1", "A2"), contact("11", "14", "no", "energised"), contact("11", "12", "nc", "energised", true)], options: [], interaction: null },
  kontaktor: { id: "kontaktor", label: "Kontaktor", name: "Kontaktor", group: "industri", short: "Spolen A1–A2 drar. Då sluter 1–2 till motorn och hjälpkontakten 13–14, och hjälpkontakten 21–22 bryter. Ingen trefas: den visar bara att den drar.", width: 120, height: 108, terminals: [{ id: "A1", role: "wire", side: "top", title: "A1, spole +" }, { id: "A2", role: "wire", side: "top", title: "A2, spole −" }, { id: "1", role: "wire", side: "bottom", title: "1, kontakt till motorn, in" }, { id: "2", role: "wire", side: "bottom", title: "2, kontakt till motorn, ut" }, { id: "13", role: "wire", side: "bottom", title: "13, hjälpkontakt, sluter när spolen drar" }, { id: "14", role: "wire", side: "bottom", title: "14, hjälpkontakt, sluter när spolen drar" }, { id: "21", role: "wire", side: "bottom", title: "21, hjälpkontakt, bryter när spolen drar" }, { id: "22", role: "wire", side: "bottom", title: "22, hjälpkontakt, bryter när spolen drar" }], elements: [load("A1", "A2"), contact("1", "2", "huvud", "energised"), contact("13", "14", "hjalp", "energised"), contact("21", "22", "hjalp-nc", "energised", true)], options: [], interaction: null },
  larm: { id: "larm", label: "Larmutgång", name: "Larmutgång", group: "industri", short: "Spänning här blir ett larm, lokalt och till Workflow om kopplad.", width: 84, height: 72, terminals: twoWire("1", "2"), elements: [load("1", "2")], options: [SEVERITY_OPTION], interaction: null },

  tilluftsflakt: { id: "tilluftsflakt", label: "Tilluftsfläkt", name: "Tilluftsfläkt", group: "fastighet", short: "Till/från, eller varvtal 0–10 V på styr. Ger flödet.", width: 84, height: 84, terminals: threeWireIn, elements: controlledLoad, options: [], interaction: null },
  franluftsflakt: { id: "franluftsflakt", label: "Frånluftsfläkt", name: "Frånluftsfläkt", group: "fastighet", short: "Till/från, eller varvtal 0–10 V på styr.", width: 84, height: 84, terminals: threeWireIn, elements: controlledLoad, options: [], interaction: null },
  spjall: { id: "spjall", label: "Spjäll", name: "Spjäll", group: "fastighet", short: "Ställdonet öppnar med spänning på 1–2 och stänger utan. Ändlägena Ö1–Ö2 (öppet) och S1–S2 (stängt).", width: 96, height: 84, terminals: [{ id: "1", role: "wire", side: "top", title: "1, ställdon" }, { id: "2", role: "wire", side: "top", title: "2, ställdon" }, { id: "Ö1", role: "wire", side: "bottom", title: "Ö1, sluten mot Ö2 i öppet läge" }, { id: "Ö2", role: "wire", side: "bottom", title: "Ö2, ändläge öppet" }, { id: "S1", role: "wire", side: "bottom", title: "S1, sluten mot S2 i stängt läge" }, { id: "S2", role: "wire", side: "bottom", title: "S2, ändläge stängt" }], elements: [load("1", "2"), contact("Ö1", "Ö2", "oppet", "open"), contact("S1", "S2", "stangt", "closed")], options: [], interaction: null },
  brandlarm: { id: "brandlarm", label: "Brandlarm (NC)", name: "Brandlarm", group: "fastighet", short: "Larmtryckknapp, kontakten 11–12 sluten i normalläge. Tryck för att lösa ut.", width: 72, height: 72, terminals: contactPair("nc"), elements: [contact("1", "2", "brand", "on", true)], options: [], interaction: "toggle" },
  givare_tilluft: { id: "givare_tilluft", label: "Givare tilluft", name: "Tilluft", group: "fastighet", short: "Tilluftstemperatur 0–100 °C som 0–10 V.", width: 60, height: 96, terminals: threeWire, elements: sensorElements, options: [], interaction: null },
  givare_franluft: { id: "givare_franluft", label: "Givare frånluft", name: "Frånluft", group: "fastighet", short: "Frånluftstemperatur 0–100 °C som 0–10 V.", width: 60, height: 96, terminals: threeWire, elements: sensorElements, options: [], interaction: null },
  givare_ute: { id: "givare_ute", label: "Givare ute", name: "Ute", group: "fastighet", short: "Utetemperatur −40…+60 °C som 0–10 V.", width: 60, height: 96, terminals: threeWire, elements: sensorElements, options: [], interaction: null },
  givare_rum: { id: "givare_rum", label: "Givare rum", name: "Rum", group: "fastighet", short: "Rumstemperatur 0–100 °C som 0–10 V.", width: 60, height: 96, terminals: threeWire, elements: sensorElements, options: [], interaction: null },
  givare_fram: { id: "givare_fram", label: "Givare framledning", name: "Framledning", group: "fastighet", short: "Framledningstemperatur 0–100 °C som 0–10 V.", width: 60, height: 96, terminals: threeWire, elements: sensorElements, options: [], interaction: null },
  tryckgivare: { id: "tryckgivare", label: "Tryckgivare filter", name: "Filtervakt", group: "fastighet", short: "Tryckfall över filtret 0–500 Pa som 0–10 V.", width: 72, height: 84, terminals: threeWire, elements: sensorElements, options: [], interaction: null },
  varmebatteri: { id: "varmebatteri", label: "Värmebatteri", name: "Värmebatteri", group: "fastighet", short: "Ventilen 0–10 V på styr värmer tilluften.", width: 84, height: 72, terminals: threeWireIn, elements: controlledLoad, options: [], interaction: null },
  cirkpump: { id: "cirkpump", label: "Cirkulationspump", name: "Cirk.pump", group: "fastighet", short: "Driver värmekretsen när den får spänning.", width: 72, height: 72, terminals: twoWire("1", "2"), elements: [load("1", "2")], options: [], interaction: null },
  shunt: { id: "shunt", label: "Shuntventil", name: "Shunt", group: "fastighet", short: "0–10 V på styr blandar in varmt vatten.", width: 84, height: 72, terminals: threeWireIn, elements: controlledLoad, options: [], interaction: null },
  varmekalla: { id: "varmekalla", label: "Värmekälla", name: "Värmekälla", group: "fastighet", short: "Elpanna eller värmepump: till/från, eller steg 0–10 V.", width: 84, height: 84, terminals: threeWireIn, elements: controlledLoad, options: [{ key: "sort", label: "Sort", choices: [{ value: "elpanna", label: "Elpanna" }, { value: "varmepump", label: "Värmepump" }] }], interaction: null },
  frysvakt: { id: "frysvakt", label: "Frysvakt", name: "Frysvakt", group: "fastighet", short: "Kapillärtermostat, kontakten 11–12 sluten i normalläge. Bryter under gränsen.", width: 72, height: 72, terminals: contactPair("nc"), elements: [contact("1", "2", "frys", "tripped", true)], options: [{ key: "limitC", label: "Löser under", choices: [{ value: "3", label: "3 °C" }, { value: "5", label: "5 °C" }, { value: "8", label: "8 °C" }] }], interaction: null },

  kalla24: { id: "kalla24", label: "Spänningskälla 24 V DC", name: "24 V DC", group: "el", short: "Egen matning: + och −. Koppla − ihop med PLC:ns 0 V när ingångar ska läsa den.", width: 84, height: 72, terminals: supplyTerminals, elements: [{ kind: "supply", plus: "+", minus: "−", volts: 24, maxVolts: 24 }], options: [], interaction: null },
  kallajust: { id: "kallajust", label: "Justerbar spänningskälla 0–30 V DC", name: "Justerbar DC", group: "el", short: "Vrid fram spänningen. Under 15 V räknar apparaterna det som 0, över 30 V tål PLC:n inte.", width: 96, height: 96, terminals: supplyTerminals, elements: [{ kind: "supply", plus: "+", minus: "−", volts: "knob", maxVolts: 30 }], options: [], interaction: "knob" },
  kalla010: { id: "kalla010", label: "Signalkälla 0–10 V", name: "Signal 0–10 V", group: "el", short: "En analog signal på ut mot −. Koppla − till PLC:ns 0 V.", width: 84, height: 96, terminals: [{ id: "ut", role: "analog", side: "bottom", title: "0–10 V ut" }, { id: "−", role: "ground", side: "bottom", title: "− (0 V)" }], elements: [{ kind: "source", terminal: "ut", plus: null, minus: "−" }], options: [], interaction: "knob" },
  // 2026-11-09: "Saknar 4–20 mA". The simulator has no currents (wiring.ts), so the loop is modelled as the PLC's analog input
  // reads it: through its 500 Ω measuring resistor 4–20 mA is 2–10 V (raw 2000–10000). Current flows only in a closed loop: ut to an
  // AI and − to the PLC's 0 V; otherwise the source gives nothing (ÄV 0 mA).
  kalla420: { id: "kalla420", label: "Signalkälla 4–20 mA", name: "Signal 4–20 mA", group: "el", short: "Strömsignal från ut till en analog ingång och tillbaka på −. Ingången läser den över 500 Ω: 4 mA blir 2 V, 20 mA blir 10 V.", width: 84, height: 96, terminals: [{ id: "ut", role: "analog", side: "bottom", title: "4–20 mA ut" }, { id: "−", role: "ground", side: "bottom", title: "− (tillbaka)" }], elements: [{ kind: "source", terminal: "ut", plus: null, minus: "−" }], options: [], interaction: "knob" },
  // 2026-11-09: "en spänning- och strömsimulator-dosa … typ en givartestare". Battery powered: 0–10 V or 4–20 mA on + against −.
  signalsim: { id: "signalsim", label: "Givartestare V/mA", name: "Givartestare", group: "el", short: "Signaldosa på batteri. Välj 0–10 V eller 4–20 mA och vrid fram värdet för att prova en analog ingång.", width: 84, height: 108, terminals: [{ id: "ut", role: "analog", side: "bottom", name: "+", title: "Signal ut (+)" }, { id: "−", role: "ground", side: "bottom", title: "− (0 V)" }], elements: [{ kind: "source", terminal: "ut", plus: null, minus: "−" }], options: [{ key: "mode", label: "Signal", choices: [{ value: "V", label: "0–10 V" }, { value: "mA", label: "4–20 mA" }] }], interaction: "knob" },
  voltmeter: { id: "voltmeter", label: "Voltmeter", name: "Voltmeter", group: "el", short: "Panelinstrument 0–30 V: visar spänningen mellan + och −. Drar ingen ström.", width: 72, height: 84, terminals: [{ id: "+", role: "wire", side: "top", title: "Mätning +" }, { id: "−", role: "wire", side: "top", title: "Mätning −" }], elements: [{ kind: "meter", plus: "+", minus: "−" }], options: [], interaction: null },
};

export const GROUP_LABELS: Record<DeviceGroup, string> = { industri: "Industri", fastighet: "Fastighet", el: "Matning och mätning" };
export const DEVICE_GROUPS: readonly DeviceGroup[] = ["industri", "fastighet", "el"];
export const devicesInGroup = (group: DeviceGroup) => DEVICE_KINDS.map((id) => DEVICE_DEFS[id]).filter((def) => def.group === group);

export const optionValue = (def: DeviceKindDef, options: Readonly<Record<string, string>>, key: string) => options[key] ?? def.options.find((option) => option.key === key)?.choices[0]?.value ?? "";

/** The designation printed at a terminal: its `name` (by the NO/NC option when it has two), else its id. One source for the plate, the wire texts and the check. */
export function terminalName(def: DeviceKindDef, options: Readonly<Record<string, string>>, terminalId: string): string {
  const terminal = def.terminals.find((candidate) => candidate.id === terminalId);
  if (!terminal?.name) return terminalId;
  if (typeof terminal.name === "string") return terminal.name;
  return optionValue(def, options, "nc") === "nc" ? terminal.name.nc : terminal.name.no;
}
/** The tooltip of a terminal: its own title, else "Plint 13". */
export function terminalTitle(def: DeviceKindDef, options: Readonly<Record<string, string>>, terminalId: string): string {
  const terminal = def.terminals.find((candidate) => candidate.id === terminalId);
  return terminal?.title ?? `Plint ${terminalName(def, options, terminalId)}`;
}

/** Devices that feed the PLC's inputs (contacts, signal sources and supplies without loads) go along the top of the surface, the rest along the bottom. */
export const feedsInputs = (def: DeviceKindDef) => def.elements.some((element) => element.kind === "contact" || element.kind === "source" || element.kind === "supply") && !def.elements.some((element) => element.kind === "load");

/** The sensors read the plant: what each one measures, and its range over 0–10 V. */
export const SENSOR_RANGES: Partial<Record<DeviceKindId, { reads: "tank" | "oven" | "supply" | "extract" | "outdoor" | "room" | "flow" | "filter"; low: number; high: number; unit: string }>> = {
  nivagivare: { reads: "tank", low: 0, high: 100, unit: "%" },
  tempgivare: { reads: "oven", low: 0, high: 200, unit: "°C" },
  givare_tilluft: { reads: "supply", low: 0, high: 100, unit: "°C" },
  givare_franluft: { reads: "extract", low: 0, high: 100, unit: "°C" },
  givare_ute: { reads: "outdoor", low: -40, high: 60, unit: "°C" },
  givare_rum: { reads: "room", low: 0, high: 100, unit: "°C" },
  givare_fram: { reads: "flow", low: 0, high: 100, unit: "°C" },
  tryckgivare: { reads: "filter", low: 0, high: 500, unit: "Pa" },
};

export const rangeToVolts = (value: number, range: { low: number; high: number }) => Math.min(10, Math.max(0, ((value - range.low) / (range.high - range.low)) * 10));

/** A knob's 0–100 as volts: the potentiometer and the signal source give 0–10 V, the adjustable supply 0–30 V. */
export function knobVolts(kind: DeviceKindId, value: number) {
  const supply = DEVICE_DEFS[kind].elements.find((element) => element.kind === "supply");
  return (value / 100) * (supply?.kind === "supply" ? supply.maxVolts : 10);
}

/** What a knob source gives: a voltage (0–10 V) or a current (4–20 mA); null for a sensor that measures the plant. */
export function signalKind(kind: DeviceKindId, options: Readonly<Record<string, string>> = {}): "volts" | "current" | null {
  if (kind === "vred" || kind === "kalla010") return "volts";
  if (kind === "kalla420") return "current";
  if (kind === "signalsim") return optionValue(DEVICE_DEFS.signalsim, options, "mode") === "mA" ? "current" : "volts";
  return null;
}
/** A knob source's set value (BV) in its own unit: 0–10 V, or 4–20 mA. */
export const knobSignal = (kind: DeviceKindId, options: Readonly<Record<string, string>>, value: number) => (signalKind(kind, options) === "current" ? 4 + (16 * value) / 100 : value / 10);
/** The analog input's measuring resistor for a current loop: U = I × 500 Ω, so 4–20 mA is 2–10 V. */
export const LOOP_OHMS = 500;
export const milliampsToVolts = (mA: number) => (mA / 1000) * LOOP_OHMS;
export const voltsToMilliamps = (volts: number) => (volts / LOOP_OHMS) * 1000;

/** Search in the palette: the name, the full label and the short line, case- and accent-insensitive. */
export function deviceMatches(def: DeviceKindDef, query: string) {
  const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const needle = fold(query.trim());
  return !needle || fold(`${def.name} ${def.label} ${def.short} ${GROUP_LABELS[def.group]}`).includes(needle);
}

/** Whether a pushbutton is set to latch: a press holds it in, the next releases it. */
export const isLatching = (def: DeviceKindDef, options: Readonly<Record<string, string>>) => def.options.some((option) => option.key === "latch") && optionValue(def, options, "latch") === "latch";
