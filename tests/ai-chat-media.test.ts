import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  azureImageProblem, azureInputSchema, azureTranscriptionPolicy, azureTranscriptionProblem, effectiveAzureSettings, IMAGES_OFF, storedAzureSchema, usedDeployments, VOICE_OFF,
} from "../lib/ai/azure-settings";
import {
  CHAT_IMAGE_MAX_BYTES, CHAT_IMAGE_MAX_SIDE, chatMediaSupport, cleanTranscript, IMAGE_INSTRUCTION, IMAGE_TOO_LARGE, IMAGE_UNREADABLE, IMAGE_WRONG_TYPE, imageMessageNote,
  imageTokenEstimate, sniffAudioType, sniffImageType, transcriptionRequest, transcriptionUsage, VOICE_MAX_BYTES, VOICE_NEEDS_AZURE, VOICE_TOO_LONG, VOICE_WRONG_TYPE,
} from "../lib/ai/chat-media";
import { prepareChatImage } from "../lib/ai/chat-image";
import { transcribeSpeech, TranscriptionRefused, type TranscriptionLedger } from "../lib/ai/transcription";
import { routeAiModel } from "../lib/ai/model-catalog";
import { openAiStartingCards } from "../lib/ai/openai-models";
import { prepareWorkflowAssistantRequest } from "../lib/ai/workflow-assistant";
import { applyNameplate, chatProposalInput, nameplateUntouched } from "../lib/ai/chat-proposals";

// Bilder och röst i Workflow AI (2026-11-21). Synthetic pictures and sounds only; no provider is called (fake clients).
const root = path.resolve(__dirname, "..");

// ---------- Bilder: preparing a photo on the server ----------
async function photo(width: number, height: number, withPosition = true) {
  const base = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } });
  const tagged = withPosition ? base.withExif({ IFD0: { Make: "QA-kamera", Model: "Prov 1" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "59/1 19/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "18/1 4/1 0/1" } }) : base;
  return tagged.jpeg().toBuffer();
}

test("a photo is made upright, smaller and saved again without EXIF – no position or camera data reaches the provider", async () => {
  const original = await photo(3200, 1200);
  const before = await sharp(original).metadata();
  assert.ok(before.exif && before.exif.length > 0, "the synthetic photo carries EXIF with a position");
  const prepared = await prepareChatImage(new Uint8Array(original));
  assert.match(prepared.dataUrl, /^data:image\/jpeg;base64,/);
  const bytes = Buffer.from(prepared.dataUrl.split(",")[1], "base64");
  const after = await sharp(bytes).metadata();
  assert.equal(after.exif, undefined, "no EXIF block at all");
  assert.equal(after.xmp, undefined);
  assert.equal(after.iptc, undefined);
  assert.equal(bytes.includes(Buffer.from("QA-kamera")), false);
  assert.equal(Math.max(prepared.width, prepared.height), CHAT_IMAGE_MAX_SIDE);
  assert.equal(prepared.width, after.width);
  assert.equal(prepared.tokens, imageTokenEstimate(prepared.width, prepared.height));
});

test("a photo taken on its side is turned upright by its orientation before the metadata is dropped", async () => {
  const sideways = await sharp({ create: { width: 400, height: 200, channels: 3, background: "#336699" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const prepared = await prepareChatImage(new Uint8Array(sideways));
  assert.deepEqual([prepared.width, prepared.height], [200, 400]);
  const after = await sharp(Buffer.from(prepared.dataUrl.split(",")[1], "base64")).metadata();
  assert.equal(after.orientation, undefined);
});

test("only real JPEG, PNG and WebP of at most 10 MB are taken; the bytes decide, not the name or type", async () => {
  assert.equal(sniffImageType(new Uint8Array(await photo(10, 10, false))), "image/jpeg");
  assert.equal(sniffImageType(new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 4, background: "#0000" } }).png().toBuffer())), "image/png");
  assert.equal(sniffImageType(new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).webp().toBuffer())), "image/webp");
  assert.equal(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  await assert.rejects(prepareChatImage(new TextEncoder().encode("GIF89a not allowed")), (error: Error & { status?: number }) => error.message === IMAGE_WRONG_TYPE && error.status === 400);
  const huge = new Uint8Array(CHAT_IMAGE_MAX_BYTES + 1); huge.set([0xff, 0xd8, 0xff]);
  await assert.rejects(prepareChatImage(huge), (error: Error & { status?: number }) => error.message === IMAGE_TOO_LARGE && error.status === 413);
  const broken = new Uint8Array(200); broken.set([0xff, 0xd8, 0xff, 0xe0]);
  await assert.rejects(prepareChatImage(broken), (error: Error) => error.message === IMAGE_UNREADABLE);
  await assert.rejects(prepareChatImage(new Uint8Array(0)), (error: Error) => error.message === IMAGE_UNREADABLE);
  // A transparent PNG is accepted and becomes a JPEG.
  const png = await prepareChatImage(new Uint8Array(await sharp({ create: { width: 30, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer()));
  assert.match(png.dataUrl, /^data:image\/jpeg;base64,/);
});

test("the token estimate follows the full-detail rule and is never zero", () => {
  assert.equal(imageTokenEstimate(1600, 600), 85 + 170 * 8);
  assert.equal(imageTokenEstimate(1600, 1200), 85 + 170 * 4);
  assert.equal(imageTokenEstimate(512, 512), 85 + 170);
  assert.ok(imageTokenEstimate(0, 0) > 0);
});

// ---------- What the model is told about a photo ----------
test("with a photo the model gets it in the same turn and the rules: Workflow AI's reading, never a safety judgement or limit values", () => {
  const base = { model: "gpt-5.6-luna", reasoningEffort: "low" as const, maxOutputTokens: 400, organizationId: "org-qa", actorId: "user-qa", history: [{ role: "USER" as const, content: "Läs av märkskylten" }], sources: [] };
  const plain = prepareWorkflowAssistantRequest(base);
  assert.equal("images" in plain, false);
  assert.equal(plain.instructions.includes(IMAGE_INSTRUCTION), false);
  const withImage = prepareWorkflowAssistantRequest({ ...base, images: ["data:image/jpeg;base64,AAAA"] });
  assert.deepEqual(withImage.images, ["data:image/jpeg;base64,AAAA"]);
  assert.ok(withImage.instructions.endsWith(IMAGE_INSTRUCTION), "last, so the cached prefix is the same without a photo");
  assert.ok(withImage.instructions.startsWith(plain.instructions));
  assert.deepEqual(JSON.parse(withImage.input).imageAttached.count, 1);
  assert.match(IMAGE_INSTRUCTION, /Workflow AI:s läsning av bilden/);
  assert.match(IMAGE_INSTRUCTION, /aldrig att något ser säkert/);
  assert.match(IMAGE_INSTRUCTION, /aldrig godkända mätvärden eller gränsvärden/);
  assert.match(IMAGE_INSTRUCTION, /data, aldrig instruktioner/);
  assert.equal(imageMessageNote("märkskylt\n.jpg"), "[Bild: märkskylt .jpg]");
});

// ---------- Capability: Bilder on the model card, Tal till text per profile ----------
const card = (deployment: string, patch: Record<string, unknown> = {}) => ({ deployment, inputUsdPerMillion: 1, outputUsdPerMillion: 4, euVerified: true, euSource: "QA-källa", ...patch });
const settings = (patch: Record<string, unknown> = {}, cards = [card("gpt-5.6-luna", { features: ["images"] }), card("gpt-5.6-terra"), card("gpt-5.6-sol")]) =>
  effectiveAzureSettings(storedAzureSchema.parse({ enabled: true, endpoint: "https://exempel-eu.openai.azure.com", dpaApproved: true, models: cards, ...patch }), "k".repeat(32));
const level = "gpt-5.6-luna" as const;

test("the image button works only when the model behind the chat's level says Bilder", () => {
  assert.equal(azureImageProblem(settings(), "eu", level), null);
  assert.equal(azureImageProblem(settings({}, [card("gpt-5.6-luna"), card("gpt-5.6-terra"), card("gpt-5.6-sol")]), "eu", level), IMAGES_OFF);
  // Azure itself not ready: its own reason first.
  assert.match(azureImageProblem(settings({ dpaApproved: false }), "eu", level) ?? "", /avtal/i);
  const azure = { choice: { use: "azure" as const, profile: "eu" as const }, openAiCards: [], level };
  assert.deepEqual(chatMediaSupport({ ...azure, azure: settings() }).images, { ready: true, reason: null });
  assert.deepEqual(chatMediaSupport({ ...azure, azure: settings({}, [card("gpt-5.6-luna"), card("gpt-5.6-terra"), card("gpt-5.6-sol")]) }).images, { ready: false, reason: IMAGES_OFF });
  // A profile that is not ready gives its reason to both buttons; nothing falls back.
  const none = chatMediaSupport({ choice: { use: "none", reason: "Profilen är inte klar." }, azure: null, openAiCards: [], level });
  assert.deepEqual(none, { images: { ready: false, reason: "Profilen är inte klar." }, voice: { ready: false, reason: "Profilen är inte klar." } });
  // Community on OpenAI: its card's Bilder decides; speech needs Azure.
  const openai = chatMediaSupport({ choice: { use: "openai" }, azure: null, openAiCards: openAiStartingCards(), level });
  assert.equal(openai.images.ready, true);
  assert.deepEqual(openai.voice, { ready: false, reason: VOICE_NEEDS_AZURE });
  const unticked = openAiStartingCards().map((item) => ({ ...item, features: item.features.filter((feature) => feature !== "images") }));
  assert.equal(chatMediaSupport({ choice: { use: "openai" }, azure: null, openAiCards: unticked, level }).images.reason, IMAGES_OFF);
});

test("Tal till text needs the profile's own deployment and a priced card; the EU profile also a verified EU source", () => {
  assert.equal(azureTranscriptionProblem(settings(), "standard"), VOICE_OFF);
  const voice = (euVerified: boolean, priced = true) => settings({ transcription: { standard: "tal-global", eu: "tal-eu" } }, [
    card("gpt-5.6-luna", { features: ["images"] }), card("gpt-5.6-terra"), card("gpt-5.6-sol"),
    card("tal-global", { euVerified: false, euSource: "" }), card("tal-eu", { euVerified, ...(priced ? {} : { inputUsdPerMillion: null }) }),
  ]);
  assert.equal(azureTranscriptionProblem(voice(true), "standard"), null);
  assert.equal(azureTranscriptionProblem(voice(true), "eu"), null);
  assert.match(azureTranscriptionProblem(voice(false), "eu") ?? "", /EU-behandling är inte verifierad/);
  assert.match(azureTranscriptionProblem(voice(true, false), "eu") ?? "", /Pris saknas/);
  // In the chat a technical reason reads as "not ready", and the plain one stays.
  // A neutral operator name: the Community export rewrites "på servern" in texts, and the test must read the same in both editions.
  const eu = chatMediaSupport({ choice: { use: "azure", profile: "eu" }, azure: voice(false), openAiCards: [], level, operator: "Driftaren" });
  assert.deepEqual(eu.voice, { ready: false, reason: "Tal till text är inte klart hos Driftaren ännu." });
  assert.deepEqual(chatMediaSupport({ choice: { use: "azure", profile: "standard" }, azure: settings(), openAiCards: [], level }).voice, { ready: false, reason: VOICE_OFF });
  // The run is priced with the transcription card and recorded as EU only for an EU-verified card.
  const priced = azureTranscriptionPolicy(routeAiModel("WRITING"), voice(true), "eu");
  assert.equal(priced.deployment, "tal-eu");
  assert.equal(priced.policy.processingRegion, "EU");
  assert.equal(priced.policy.inputPriceUsdMicrosPerMillion, 1_000_000);
  assert.equal(azureTranscriptionPolicy(routeAiModel("WRITING"), voice(true), "standard").policy.processingRegion, "GLOBAL");
  assert.throws(() => azureTranscriptionPolicy(routeAiModel("WRITING"), voice(false), "eu"));
});

test("the transcription deployments are saved settings with their own cards; an older save has none", () => {
  assert.deepEqual(effectiveAzureSettings(storedAzureSchema.parse({ enabled: true }), "").transcription, { standard: "", eu: "" });
  const input = azureInputSchema.parse({ enabled: true, endpoint: "", deployments: {}, dpaApproved: true, transcription: { standard: " tal-global ", eu: "" } });
  assert.deepEqual(input.transcription, { standard: "tal-global", eu: "" });
  assert.throws(() => azureInputSchema.parse({ enabled: true, endpoint: "", deployments: {}, dpaApproved: true, transcription: { standard: "x", eu: "", other: "y" } }));
  const used = usedDeployments({ deployments: { "gpt-5.6-luna": "a", "gpt-5.6-terra": "a", "gpt-5.6-sol": "b" }, transcription: { standard: "tal", eu: "" } });
  assert.deepEqual(used, ["a", "b", "tal"]);
});

// ---------- Röst: the request, the ledger, never the audio ----------
const webm = () => { const bytes = new Uint8Array(4_000); bytes.set([0x1a, 0x45, 0xdf, 0xa3]); for (let index = 4; index < bytes.length; index += 1) bytes[index] = (index * 7) % 251; return bytes; };
function fakeLedger() {
  const calls: { kind: string; args: unknown[] }[] = [];
  const ledger: TranscriptionLedger = {
    async reserve(...args) { calls.push({ kind: "reserve", args }); return { runId: "run-qa" }; },
    async settle(...args) { calls.push({ kind: "settle", args }); },
    async fail(...args) { calls.push({ kind: "fail", args }); },
  };
  return { ledger, calls };
}

test("a recording is sent as one Swedish transcription request to the profile's deployment, and only token counts reach the ledger", async () => {
  const audio = webm();
  const copy = Buffer.from(audio);
  const sent: unknown[] = [];
  const { ledger, calls } = fakeLedger();
  const client = { audio: { transcriptions: { async create(params: unknown) { sent.push(params); return { text: "  Bytte två  dvärgbrytare\u0007 i central 2 ", usage: { type: "tokens", input_tokens: 310, output_tokens: 14 } }; } } } };
  const result = await transcribeSpeech({ audio, seconds: 12, deployment: "tal-eu", client, ledger, toFile: async (bytes, name, type) => ({ name, type, size: bytes.length }) });
  assert.equal(result.text, "Bytte två dvärgbrytare i central 2");
  assert.deepEqual(sent, [{ model: "tal-eu", file: { name: "tal.webm", type: "audio/webm", size: 4_000 }, language: "sv", response_format: "json" }]);
  assert.deepEqual(transcriptionRequest("d", "f"), { model: "d", file: "f", language: "sv", response_format: "json" });
  assert.deepEqual(calls.map((call) => call.kind), ["reserve", "settle"]);
  assert.deepEqual(calls[0].args[0], { estimatedInputTokens: 240, inputTokenLimit: 2_400, maxOutputTokens: 1_000 });
  assert.deepEqual(calls[1].args, ["run-qa", { inputTokens: 310, cachedInputTokens: 0, outputTokens: 14 }]);
  // Never the audio: not in what the ledger got, and the buffer is wiped when the call is done.
  const logged = JSON.stringify(calls);
  assert.equal(logged.includes(copy.toString("base64").slice(0, 40)), false);
  assert.equal(audio.every((value) => value === 0), true);
  assert.deepEqual(Object.keys(result).sort(), ["text", "usage"]);
});

test("a refused or failed recording returns the reservation (or never makes one) and is wiped all the same", async () => {
  const { ledger, calls } = fakeLedger();
  const failing = { audio: { transcriptions: { async create(): Promise<never> { throw Object.assign(new Error("boom"), { status: 500 }); } } } };
  const audio = webm();
  await assert.rejects(transcribeSpeech({ audio, seconds: 5, deployment: "tal", client: failing, ledger, toFile: async () => ({}) }), /boom/);
  assert.deepEqual(calls.map((call) => call.kind), ["reserve", "fail"]);
  assert.deepEqual(calls[1].args, ["run-qa", "PROVIDER_FAILED"]);
  assert.equal(audio.every((value) => value === 0), true);
  // Wrong bytes, too large, too long: refused before anything is reserved or sent.
  const never = { audio: { transcriptions: { async create(): Promise<never> { throw new Error("must not be called"); } } } };
  const quiet = fakeLedger();
  const text = new TextEncoder().encode("inte ljud");
  await assert.rejects(transcribeSpeech({ audio: text, seconds: 3, deployment: "tal", client: never, ledger: quiet.ledger, toFile: async () => ({}) }), (error: unknown) => error instanceof TranscriptionRefused && error.message === VOICE_WRONG_TYPE);
  assert.equal(text.every((value) => value === 0), true);
  const big = new Uint8Array(VOICE_MAX_BYTES + 1); big.set([0x1a, 0x45, 0xdf, 0xa3]);
  await assert.rejects(transcribeSpeech({ audio: big, seconds: 10, deployment: "tal", client: never, ledger: quiet.ledger, toFile: async () => ({}) }), (error: unknown) => error instanceof TranscriptionRefused && error.status === 413);
  await assert.rejects(transcribeSpeech({ audio: webm(), seconds: 95, deployment: "tal", client: never, ledger: quiet.ledger, toFile: async () => ({}) }), (error: unknown) => error instanceof TranscriptionRefused && error.message === VOICE_TOO_LONG);
  assert.equal(quiet.calls.length, 0);
});

test("the browsers' recording formats are recognised by their bytes, and whisper's seconds become tokens", () => {
  assert.deepEqual(sniffAudioType(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0])), { mime: "audio/webm", extension: "webm" });
  assert.deepEqual(sniffAudioType(new TextEncoder().encode("OggS\0\0")), { mime: "audio/ogg", extension: "ogg" });
  assert.deepEqual(sniffAudioType(new TextEncoder().encode("\0\0\0\u0018ftypM4A ")), { mime: "audio/mp4", extension: "m4a" });
  assert.deepEqual(sniffAudioType(new TextEncoder().encode("RIFF\0\0\0\0WAVEfmt ")), { mime: "audio/wav", extension: "wav" });
  assert.equal(sniffAudioType(new TextEncoder().encode("hello world!")), null);
  assert.deepEqual(transcriptionUsage({ type: "duration", seconds: 9.5 }, 10, "abcdef"), { inputTokens: 190, cachedInputTokens: 0, outputTokens: 2 });
  assert.deepEqual(transcriptionUsage(undefined, 3, ""), { inputTokens: 60, cachedInputTokens: 0, outputTokens: 0 });
  assert.equal(cleanTranscript(42), "");
  assert.equal(cleanTranscript("a".repeat(9_000)).length, 8_000);
});

// ---------- Märkskylt till objektet ----------
test("a nameplate fills only what the plate gave, replaces a rating with the same label, and Ångra needs the place untouched", () => {
  const place = { manufacturer: "Gammal", model: "", serialNumber: "S-1", attributes: [{ label: "Märkspänning", value: "230 V" }, { label: "IP-klass", value: "IP44" }] };
  const { next, before } = applyNameplate(place, { manufacturer: "QA Motor AB", model: "M-200", serialNumber: null, ratings: [{ label: "märkspänning", value: "400 V" }, { label: "Märkström", value: "16 A" }] });
  assert.deepEqual(next, { manufacturer: "QA Motor AB", model: "M-200", serialNumber: "S-1", attributes: [{ label: "Märkspänning", value: "400 V" }, { label: "IP-klass", value: "IP44" }, { label: "Märkström", value: "16 A" }] });
  assert.deepEqual(before, place);
  assert.equal(nameplateUntouched(next, next), true);
  assert.equal(nameplateUntouched({ ...next, model: "Ändrad" }, next), false);
  const full = { ...place, attributes: Array.from({ length: 30 }, (_, index) => ({ label: `A${index}`, value: "x" })) };
  assert.equal(applyNameplate(full, { manufacturer: null, model: null, serialNumber: null, ratings: [{ label: "Ny", value: "1" }] }).next.attributes.length, 30);
  assert.equal(chatProposalInput.propose_place_nameplate.safeParse({ taskId: "t1", manufacturer: null, model: null, serialNumber: null, ratings: [] }).success, false);
  assert.equal(chatProposalInput.propose_place_nameplate.safeParse({ taskId: "t1", manufacturer: "QA", model: null, serialNumber: null, ratings: [] }).success, true);
});

// ---------- The browser side: the microphone only for the app itself, never the browser's speech service ----------
test("the app may use the microphone itself, and no source uses the browser's speech recognition (it sends audio to a third party)", () => {
  assert.match(readFileSync(path.join(root, "next.config.ts"), "utf8"), /microphone=\(self\)/);
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) { if (!["node_modules", ".next", "tests"].includes(name)) walk(full); continue; }
      if (/\.(tsx?|jsx?|mjs)$/.test(name) && /\b(webkit)?SpeechRecognition\b/.test(readFileSync(full, "utf8"))) offenders.push(path.relative(root, full));
    }
  };
  for (const dir of ["app", "components", "features", "lib"]) walk(path.join(root, dir));
  assert.deepEqual(offenders, []);
  const mic = readFileSync(path.join(root, "features/ai/chat-media.tsx"), "utf8");
  assert.match(mic, /fetch\("\/api\/ai\/transcribe"/);
  assert.match(mic, /getUserMedia\(\{ audio: true \}\)/);
});
