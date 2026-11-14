/**
 * Visa Facebook och Instagram lokalt (2026-11-10): a stand-in for Meta on this computer, so the whole way – connecting, choosing
 * the page, Testpublicering and Publicera – can be shown on a dev server without a real Meta app or token. Nothing is ever
 * sent to Meta; what is "posted" is shown on the stand-in's own page.
 *
 *   npx tsx scripts/meta/demo-meta.ts [--port 3097] [--one-page]
 *
 * The dev server must be started with META_GRAPH_BASE_URL=http://127.0.0.1:<port> (only a loopback address is accepted), so
 * the app talks to the stand-in instead of graph.facebook.com. The stand-in prints the app id, the app secret and the token to
 * paste under Inställningar → Kopplingar → Webb och sociala medier (all made up). --one-page: a single page (chosen at
 * once) instead of two to choose between. Stops with Ctrl+C.
 */
import { startFakeMeta } from "../../tests/fake-meta";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1] || 3097);
if (!Number.isInteger(port) || port < 3020 || port > 3999) throw new Error("Välj en ledig port mellan 3020 och 3999.");

async function main() {
  const pages = [
    { id: "111111111111111", name: "Elfirma Exempel AB", instagram: { id: "17840000000000001", username: "elfirma_exempel" } },
    ...(args.includes("--one-page") ? [] : [{ id: "222222222222222", name: "Elfirma Exempel – Service", instagram: null }]),
  ];
  const fake = await startFakeMeta({ port, pages });
  console.log(`Låtsas-Meta kör på ${fake.url} (bara den här datorn). Det som "publiceras" syns på ${fake.url}/`);
  console.log("Klistra in under Inställningar → Kopplingar → Webb och sociala medier → Facebook och Instagram:");
  console.log(`  Appens id:         ${fake.appId}`);
  console.log(`  Appens hemlighet:  ${fake.appSecret}`);
  console.log(`  Token:             ${fake.shortToken}`);
  console.log("Allt ovan är påhittat och fungerar bara mot den här ställföreträdaren. Stoppa med Ctrl+C.");
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
