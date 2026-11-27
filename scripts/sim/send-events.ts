// Simulator for maskinintaget (docs/drift/MASKININTAG.md): sends events to a Workflow instance so the intake can be tried
// without a machine. Never against production data you care about; a local instance or a test company.
//
//   npx tsx scripts/sim/send-events.ts --url http://localhost:3001 --key hwf_mch_… --mode single
//
// Modes: single (one alarm), state (running), diagnosis (with I/O values), duplicate (the same batch twice: the second is all
// duplicates), flutter (30 raised/cleared on a few minutes), batch (20 events), toolarge (21 events: refused), bad (a broken
// event among good ones: only that one is refused), nokey (a wrong key: 401), storm (--count N events in batches of 20).

type Args = { url: string; key: string; mode: string; count: number };

function parse(argv: string[]): Args {
  const get = (name: string, fallback = "") => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] ?? fallback : fallback; };
  return { url: get("url", "http://localhost:3001"), key: get("key", process.env.MACHINE_KEY ?? ""), mode: get("mode", "single"), count: Number(get("count", "100")) };
}

const run = Date.now().toString(36);
let counter = 0;
const id = (prefix = "sim") => `${prefix}-${run}-${(counter += 1)}`;
const makeEvent = (extra: Record<string, unknown> = {}) => ({ eventId: id(), occurredAt: new Date().toISOString(), type: "alarm", code: "SIM1", severity: "fault", state: "raised", text: "Simulerat larm", ...extra });

async function send(args: Args, events: unknown[], key = args.key) {
  const response = await fetch(`${args.url.replace(/\/$/, "")}/api/ingest/v1/events`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ schemaVersion: 1, events }),
  });
  const text = await response.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* the answer was not JSON: shown as it is */ }
  console.log(`HTTP ${response.status}`, JSON.stringify(body));
  return { status: response.status, body };
}

async function main() {
  const args = parse(process.argv.slice(2));
  if (!args.key && args.mode !== "nokey") { console.error("Ange --key (eller MACHINE_KEY) med källans nyckel."); process.exit(1); }
  switch (args.mode) {
    case "single": await send(args, [makeEvent()]); break;
    case "state": await send(args, [makeEvent({ type: "state", state: "running", code: "RUN", severity: "info", text: "Maskinen går" })]); break;
    case "diagnosis": await send(args, [makeEvent({ type: "diagnosis", state: undefined, code: "DIAG1", severity: "warning", text: "Lagret låter annorlunda", basis: "Vibrationen steg 30 % på en timme", values: { vibration_mm_s: 4.2, temp_c: 61.5, mode: "auto" } })]); break;
    case "duplicate": { const batch = [makeEvent(), makeEvent()]; await send(args, batch); await send(args, batch); break; }
    case "flutter": {
      const events = Array.from({ length: 30 }, (_, index) => makeEvent({ code: "FLUTTER", state: index % 2 === 0 ? "raised" : "cleared", occurredAt: new Date(Date.now() - (30 - index) * 4000).toISOString() }));
      await send(args, events.slice(0, 20)); await send(args, events.slice(20)); break;
    }
    case "batch": await send(args, Array.from({ length: 20 }, () => makeEvent())); break;
    case "toolarge": await send(args, Array.from({ length: 21 }, () => makeEvent())); break;
    case "bad": await send(args, [makeEvent(), makeEvent({ type: "nope" }), makeEvent()]); break;
    case "nokey": await send(args, [makeEvent()], "hwf_mch_000000000000000000000000_" + "A".repeat(43)); break;
    case "storm": {
      let sent = 0;
      const started = Date.now();
      while (sent < args.count) { const size = Math.min(20, args.count - sent); const { status } = await send(args, Array.from({ length: size }, () => makeEvent())); if (status === 429) { console.log("Begränsad (429): väntar en sekund"); await new Promise((resolve) => setTimeout(resolve, 1000)); continue; } sent += size; }
      console.log(`${sent} händelser på ${((Date.now() - started) / 1000).toFixed(1)} s`); break;
    }
    default: console.error(`Okänt läge: ${args.mode}`); process.exit(1);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
export {};
