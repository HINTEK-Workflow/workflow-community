import { ioName, nameIo, PLC_IO, type PlcOutputs } from "@/lib/machine/simulator/st/io";
import { DEVICE_DEFS, terminalName } from "./devices";
import { designedDef } from "./device-designs";
import { endKey, isTerminalEnd, type Layout, PLC_DEVICE_ID, wiresAtJunction } from "./layout";
import { ANALOG_MAX_VOLTS, bonded, devicesById, type Net, ON_VOLTS, PLC_MAX_VOLTS, PLC_SUPPLY_TEXT, type Solved, sourceLabel, voltageBetween } from "./wiring";

// PLC-simulatorn (v3, 2026-11-03: "upptäcka och förklara felaktiga elektriska kopplingar"): the check of a
// drawing against its nets, every cycle. Three levels: fel (something is wrong and may stop the PLC), varning (it will not
// work as meant, or is risky), information (unfinished). Every finding names the wires, devices and PLC terminals it is about,
// so the surface can mark them. Rules only fire on what the nets show for certain: an open contact is never "missing" a feed,
// an unused auxiliary contact is never a fault. The six examples give no fel and no varning (tests/plc-simulator-surface.test.ts).

export type FindingLevel = "error" | "warning" | "info";
export type Finding = { id: string; level: FindingLevel; text: string; wires: string[]; devices: string[]; terminals: string[]; /** The PLC stops and shows ERR. */ stops: boolean };

export const LEVEL_ORDER: Record<FindingLevel, number> = { error: 0, warning: 1, info: 2 };
export const LEVEL_LABELS: Record<FindingLevel, string> = { error: "Fel", warning: "Varning", info: "Information" };

const voltsText = (volts: number) => `${volts.toLocaleString("sv-SE", { maximumFractionDigits: 1 })} V`;
const plcName = (terminal: string) => (terminal === "24V" ? "L+" : terminal === "0V" ? "M" : terminal);
export const PLC_FEED_TEXT = "Mata knappar och lampor från källan, inte från PLC:ns matningsplintar.";

export function checkDrawing(layout: Layout, solved: Solved, outputs: PlcOutputs): Finding[] {
  const devices = devicesById(layout);
  const findings: Finding[] = [];
  const wiresOnNet = new Map<number, string[]>();
  const wiredKeys = new Set<string>();
  for (const wire of layout.wires) {
    const net = solved.netOf.get(endKey(wire.from));
    if (net) wiresOnNet.set(net.id, [...(wiresOnNet.get(net.id) ?? []), wire.id]);
    wiredKeys.add(endKey(wire.from)); wiredKeys.add(endKey(wire.to));
  }
  const label = (deviceId: string) => sourceLabel(deviceId, devices);
  const plcKeysOf = (net: Net) => net.keys.filter((key) => key.startsWith(`${PLC_DEVICE_ID}:`)).map((key) => key.slice(PLC_DEVICE_ID.length + 1));
  const add = (level: FindingLevel, code: string, text: string, about: { net?: Net; wires?: string[]; devices?: string[]; terminals?: string[]; stops?: boolean }) => {
    const wires = [...new Set([...(about.net ? wiresOnNet.get(about.net.id) ?? [] : []), ...(about.wires ?? [])])];
    const terminals = [...new Set([...(about.net ? plcKeysOf(about.net) : []), ...(about.terminals ?? [])])];
    const deviceIds = [...new Set(about.devices ?? [])];
    const id = `${code}:${[...wires, ...terminals, ...deviceIds].join(",")}`;
    if (!findings.some((finding) => finding.id === id)) findings.push({ id, level, text, wires, devices: deviceIds, terminals, stops: about.stops === true });
  };
  const hasContactTerminal = (net: Net) => net.keys.some((key) => {
    if (key.startsWith("@") || key.startsWith(`${PLC_DEVICE_ID}:`)) return false;
    const [deviceId, terminal] = key.split(":");
    const device = devices.get(deviceId);
    return device !== undefined && DEVICE_DEFS[device.kind].elements.some((element) => element.kind === "contact" && (element.a === terminal || element.b === terminal));
  });
  const hasOutputTerminal = (net: Net) => plcKeysOf(net).some((terminal) => { const io = nameIo(terminal); return io?.kind === "DO" || io?.kind === "AO"; });
  const hasAnyPole = (net: Net) => net.plus.length + net.minus.length + net.signals.length > 0;

  // ---------- A. Short circuits ----------
  for (const net of solved.nets) if (net.short) add("error", "short", `${net.short}.`, { net, devices: [...net.plus, ...net.minus].map((pole) => pole.source).filter((source) => source !== PLC_DEVICE_ID), stops: true });

  // ---------- A2. The PLC's own supply on L+ and M ----------
  const plusNet = solved.netOf.get(`${PLC_DEVICE_ID}:24V`)!, minusNet = solved.netOf.get(`${PLC_DEVICE_ID}:0V`)!;
  if (solved.plcVolts !== null && solved.plcVolts > PLC_MAX_VOLTS) add("error", "plc-over", `PLC:n får ${voltsText(solved.plcVolts)} mellan L+ och M; den tål högst ${PLC_MAX_VOLTS} V.`, { net: plusNet, terminals: ["0V"], devices: plusNet.plus.map((pole) => pole.source), stops: true });
  else if (!solved.plcPowered) {
    const swapped = minusNet.plus.some((plus) => plusNet.minus.some((minus) => minus.source === plus.source));
    if (swapped) add("error", "plc-polarity", "PLC:n är kopplad med fel polaritet: källans + ska till L+ och − till M.", { terminals: ["24V", "0V"], devices: minusNet.plus.map((pole) => pole.source) });
    else if (solved.plcVolts !== null && solved.plcVolts > 0.5) add("error", "plc-low", `PLC:n får bara ${voltsText(solved.plcVolts)} mellan L+ och M; den behöver minst ${ON_VOLTS} V.`, { terminals: ["24V", "0V"], devices: plusNet.plus.map((pole) => pole.source) });
    else add("error", "plc-unpowered", `${PLC_SUPPLY_TEXT}.`, { terminals: ["24V", "0V"] });
  }
  // A field device wired straight to L+ or M works (it is the same net as the source) but is not how a panel is fed: one note, with the wires.
  const supplyTerminals = new Set(layout.devices.flatMap((device) => DEVICE_DEFS[device.kind].elements.flatMap((element) => (element.kind === "supply" ? [`${device.id}:${element.plus}`, `${device.id}:${element.minus}`] : []))));
  const fedFromPlc = layout.wires.filter((wire) => {
    const ends = [wire.from, wire.to];
    const plcSupply = ends.some((end) => isTerminalEnd(end) && end.device === PLC_DEVICE_ID && (end.terminal === "24V" || end.terminal === "0V"));
    const field = ends.some((end) => isTerminalEnd(end) && end.device !== PLC_DEVICE_ID && !supplyTerminals.has(endKey(end)));
    return plcSupply && field;
  });
  if (fedFromPlc.length) add("info", "plc-fed", PLC_FEED_TEXT, { wires: fedFromPlc.map((wire) => wire.id), devices: fedFromPlc.flatMap((wire) => [wire.from, wire.to]).filter((end): end is Extract<typeof end, { device: string }> => isTerminalEnd(end) && end.device !== PLC_DEVICE_ID).map((end) => end.device) });

  // ---------- B. Sources on one net ----------
  for (const net of solved.nets) {
    const sources = [...new Set(net.plus.map((pole) => pole.source))];
    for (let i = 0; i < sources.length; i += 1) for (let j = i + 1; j < sources.length; j += 1) {
      const a = net.plus.find((pole) => pole.source === sources[i])!, b = net.plus.find((pole) => pole.source === sources[j])!;
      if (bonded(solved, a.source, b.source)) { if (Math.abs(a.volts - b.volts) <= 0.5) add("warning", "parallel", `${label(a.source)} och ${label(b.source)} matar samma nät (parallellkopplade källor).`, { net, devices: [a.source, b.source] }); }
      else add("warning", "unbonded-sources", `${label(a.source)} och ${label(b.source)} är hopkopplade utan gemensam 0 V.`, { net, devices: [a.source, b.source] });
    }
    for (const signal of net.signals) {
      const plus = net.plus[0];
      if (plus && signal.source !== PLC_DEVICE_ID) add("error", "signal-to-plus", `Signalutgången på ${label(signal.source)} är kopplad mot ${voltsText(plus.volts)}.`, { net, devices: [signal.source, ...(plus.source === PLC_DEVICE_ID ? [] : [plus.source])] });
      if (net.minus.some((pole) => bonded(solved, pole.source, signal.source)) && signal.source !== PLC_DEVICE_ID) add("warning", "signal-to-minus", `Signalen från ${label(signal.source)} ligger på 0 V (kortsluten mot −).`, { net, devices: [signal.source] });
    }
    if (net.signals.length >= 2) add("warning", "signals-joined", `Två signalutgångar är hopkopplade: ${net.signals.slice(0, 2).map((pole) => (pole.source === PLC_DEVICE_ID ? pole.key.slice(PLC_DEVICE_ID.length + 1) : label(pole.source))).join(" och ")}.`, { net, devices: net.signals.map((pole) => pole.source).filter((source) => source !== PLC_DEVICE_ID) });
  }

  // ---------- C. The PLC's own terminals ----------
  for (let index = 0; index < PLC_IO.do; index += 1) {
    const terminal = ioName({ kind: "DO", index });
    const net = solved.netOf.get(`${PLC_DEVICE_ID}:${terminal}`);
    if (!net) continue;
    const others = plcKeysOf(net).filter((other) => other !== terminal && nameIo(other)?.kind === "DO");
    for (const other of others) if (other > terminal) add("error", "do-joined", `${terminal} och ${other} är hopkopplade. Två utgångar får inte kopplas ihop.`, { net, stops: outputs.do[index] === true || outputs.do[nameIo(other)!.index] === true });
    const external = net.plus.filter((pole) => !(pole.source === PLC_DEVICE_ID && nameIo(pole.key.slice(PLC_DEVICE_ID.length + 1))?.kind === "DO"));
    if (external.length) add("warning", "do-on-plus", `${terminal} ligger på ett +-nät; en utgång matar själv och ska gå till lasten.`, { net });
  }
  for (let index = 0; index < PLC_IO.ao; index += 1) {
    const terminal = ioName({ kind: "AO", index });
    const net = solved.netOf.get(`${PLC_DEVICE_ID}:${terminal}`);
    if (!net) continue;
    if (net.plus.length) add("error", "ao-on-plus", `${terminal} är kopplad mot ${voltsText(Math.max(...net.plus.map((pole) => pole.volts)))}; utgången är gjord för 0–10 V.`, { net, stops: true });
    if (net.minus.some((pole) => bonded(solved, pole.source, PLC_DEVICE_ID))) add("warning", "ao-on-minus", `${terminal} ligger på 0 V.`, { net });
  }
  for (let index = 0; index < PLC_IO.di; index += 1) {
    const terminal = ioName({ kind: "DI", index });
    const net = solved.netOf.get(`${PLC_DEVICE_ID}:${terminal}`);
    if (!net) continue;
    for (const pole of net.plus) {
      if (!bonded(solved, pole.source, PLC_DEVICE_ID)) { add("warning", "di-unbonded", `${terminal} matas från ${label(pole.source)}, men källans − är inte kopplad till PLC:ns M (0 V). Ingången ser inget.`, { net, devices: [pole.source] }); continue; }
      if (pole.volts > PLC_MAX_VOLTS) add("error", "di-over", `${terminal} får ${voltsText(pole.volts)}; PLC:n tål högst ${PLC_MAX_VOLTS} V.`, { net, devices: pole.source === PLC_DEVICE_ID ? [] : [pole.source], stops: true });
      else if (pole.volts > 0.5 && pole.volts < ON_VOLTS) add("warning", "di-low", `${terminal} får ${voltsText(pole.volts)}: för lågt för en säker etta (gräns ${ON_VOLTS} V), räknas som 0.`, { net, devices: pole.source === PLC_DEVICE_ID ? [] : [pole.source] });
    }
    for (const pole of net.signals) if (pole.volts > 0.5) add("warning", "di-analog", `${terminal} får en analog signal (${voltsText(pole.volts)}); under ${ON_VOLTS} V räknas som 0.`, { net, devices: pole.source === PLC_DEVICE_ID ? [] : [pole.source] });
  }
  for (let index = 0; index < PLC_IO.ai; index += 1) {
    const terminal = ioName({ kind: "AI", index });
    const net = solved.netOf.get(`${PLC_DEVICE_ID}:${terminal}`);
    if (!net) continue;
    for (const pole of net.plus) {
      if (pole.volts > ANALOG_MAX_VOLTS + 0.5) add("error", "ai-over", `${terminal} får ${voltsText(pole.volts)}; ingången är gjord för 0–${ANALOG_MAX_VOLTS} V.`, { net, devices: pole.source === PLC_DEVICE_ID ? [] : [pole.source], stops: true });
    }
    for (const pole of net.signals) if (!bonded(solved, pole.source, PLC_DEVICE_ID)) add("warning", "ai-unbonded", `${terminal} får en signal från ${label(pole.source)} utan gemensam 0 V med PLC:ns M; ingången läser 0.`, { net, devices: [pole.source] });
  }

  // ---------- D. Devices ----------
  for (const device of layout.devices) {
    const def = designedDef(device);
    const name = device.label || def.label;
    const key = (terminal: string) => `${device.id}:${terminal}`;
    const wiredTerminals = def.terminals.filter((terminal) => wiredKeys.has(key(terminal.id)));
    if (!wiredTerminals.length) { add("info", "unwired", `${name} är inte kopplad.`, { devices: [device.id] }); continue; }
    for (const element of def.elements) {
      if (element.kind === "load") {
        const wiredA = wiredKeys.has(key(element.a)), wiredB = wiredKeys.has(key(element.b));
        if (wiredA !== wiredB) { add("warning", "half-wired", `${name}: plint ${terminalName(def, device.options, wiredA ? element.b : element.a)} är inte kopplad.`, { devices: [device.id] }); continue; }
        if (!wiredA) continue;
        const netA = solved.netOf.get(key(element.a))!, netB = solved.netOf.get(key(element.b))!;
        if (netA === netB) { add("warning", "same-net", `${name}: båda plintarna sitter på samma nät, ingen spänning över.`, { net: netA, devices: [device.id] }); continue; }
        const volts = voltageBetween(solved, key(element.a), key(element.b));
        if (volts === null) {
          const dead = (fed: Net, other: Net) => hasAnyPole(fed) && !hasAnyPole(other) && !hasContactTerminal(other) && !hasOutputTerminal(other);
          if (dead(netA, netB) || dead(netB, netA)) add("warning", "no-return", `${name} har bara en sida matad; ingen väg tillbaka till källans andra pol.`, { devices: [device.id], wires: [...(wiresOnNet.get(netA.id) ?? []), ...(wiresOnNet.get(netB.id) ?? [])] });
          else if ((netA.plus.length || netA.signals.length) && netB.minus.length) add("warning", "no-common", `${name} sitter mellan ${label(netA.plus[0]?.source ?? netA.signals[0].source)} och ett 0 V som inte hör ihop med den källan.`, { devices: [device.id] });
          else if ((netB.plus.length || netB.signals.length) && netA.minus.length) add("warning", "no-common", `${name} sitter mellan ${label(netB.plus[0]?.source ?? netB.signals[0].source)} och ett 0 V som inte hör ihop med den källan.`, { devices: [device.id] });
        } else if (Math.abs(volts) > 0.5 && Math.abs(volts) < ON_VOLTS) add("warning", "low-volts", `${name} får ${voltsText(Math.abs(volts))}, för lite för en 24 V-apparat (gräns ${ON_VOLTS} V).`, { devices: [device.id] });
      } else if (element.kind === "source" && element.plus !== null && wiredKeys.has(key(element.terminal))) {
        const volts = voltageBetween(solved, key(element.plus), key(element.minus));
        if (volts !== null && volts <= -ON_VOLTS) add("warning", "polarity", `${name} är kopplad med fel polaritet (+ och − omkastade).`, { devices: [device.id] });
        else if (volts === null || volts < ON_VOLTS) add("warning", "no-supply", `${name} saknar matning: + behöver +24 V och − behöver 0 V.`, { devices: [device.id] });
      } else if (element.kind === "contact") {
        const wiredA = wiredKeys.has(key(element.a)), wiredB = wiredKeys.has(key(element.b));
        if (wiredA !== wiredB) add("info", "half-contact", `${name}: plint ${terminalName(def, device.options, wiredA ? element.b : element.a)} är inte kopplad.`, { devices: [device.id] });
      }
    }
  }

  // ---------- E. Wires ----------
  for (const wire of layout.wires) {
    const loose = [wire.from, wire.to].filter((end) => !isTerminalEnd(end) && wiresAtJunction(layout, end.junction).length === 1).length;
    if (loose === 2) add("warning", "loose", `Ledning ${wire.id} är inte ansluten i någon ände.`, { wires: [wire.id] });
    else if (loose === 1) add("warning", "loose", `Ledning ${wire.id} har en lös ände.`, { wires: [wire.id] });
    const net = solved.netOf.get(endKey(wire.from));
    if (!net || !wire.kind || wire.kind === "auto") continue;
    if (wire.kind === "minus" && net.plus.length) add("warning", "marked-minus", `Ledning ${wire.id} är märkt 0 V men ligger på +${voltsText(Math.max(...net.plus.map((pole) => pole.volts)))}.`, { wires: [wire.id] });
    if (wire.kind === "plus" && net.minus.length && !net.plus.length) add("warning", "marked-plus", `Ledning ${wire.id} är märkt +24 V men ligger på 0 V.`, { wires: [wire.id] });
  }

  return findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}

/** "2 fel · 1 varning", or "Inga fel" – the short form for a header. */
export function findingsSummary(findings: readonly Finding[]) {
  const count = (level: FindingLevel) => findings.filter((finding) => finding.level === level).length;
  const errors = count("error"), warnings = count("warning");
  const parts = [errors ? `${errors} fel` : null, warnings ? `${warnings} ${warnings === 1 ? "varning" : "varningar"}` : null].filter((part): part is string => part !== null);
  return parts.length ? parts.join(" · ") : "Inga fel";
}

/** The plc terminal names a finding is about, as the PLC drawing shows them. */
export const findingTerminalLabel = plcName;
