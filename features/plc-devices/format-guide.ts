import { EASES, STATE_TEXT, STATES, VALUE_TEXT, VALUES, WHOLE_PICTURE } from "@/lib/machine/simulator/surface/animation";
import { DEVICE_FILE_FORMAT, DEVICE_FILE_VERSION, MAX_IMPORT_DEVICES, MAX_LAYERED_SVG_BYTES, MAX_PNG_BYTES, MAX_SOUND_BYTES, MAX_SVG_BYTES, MAX_TERMINALS, MAX_TERMINALS_PER_SIDE, PLATE_EDGE, requiredTerminals, ROLE_LABELS, STATE_VIEW_LABELS, STATE_VIEWS, TERMINAL_STEP } from "@/lib/machine/simulator/surface/device-designs";
import { DEVICE_DEFS, DEVICE_GROUPS, DEVICE_KINDS, GROUP_LABELS, TERMINAL_ROLES } from "@/lib/machine/simulator/surface/devices";
import { READOUT_CHOICES, READOUT_SIDE_LABELS, READOUT_SIDES, READOUT_VALUE_TEXT, READOUT_VALUES, SETPOINTS, SHOW_VALUE_TEXT, SHOW_VALUES } from "@/lib/machine/simulator/surface/readouts";
import { MAX_LAYER_BYTES } from "@/lib/machine/simulator/surface/svg-safe";

/**
 * The file format of PLC-apparater (2026-11-06; version 2 and 3 on 2026-11-07), written as an instruction another AI system can follow.
 * The same text is in docs/drift/PLC_APPARATFORMAT.md;
 * the lists are built from the simulator's own catalogue and the animation's own lists, so they are never out of date here, and the
 * example is built as an object, so it is always valid JSON (a test imports it).
 */
const functionLines = DEVICE_KINDS.map((kind) => {
  const def = DEVICE_DEFS[kind];
  const needed = [...requiredTerminals(kind).keys()];
  const settings = def.options.map((option) => `${option.label}${option.key === SETPOINTS[kind] ? " (börvärde, på värdeetiketten)" : ""}: ${option.choices.map((choice) => choice.label).join(" / ")}, standard ${option.choices[0]!.label}`);
  if (def.interaction === "knob") settings.push("vred 0–100 % på apparaten");
  if (def.interaction === "momentary") settings.push("tryck och håll");
  if (def.interaction === "toggle") settings.push("vippa till/från");
  const values = READOUT_CHOICES[kind] ?? [];
  return [
    `- ${kind}: ${def.label}. ${def.short}`,
    `  Plintar: ${def.terminals.map((terminal) => terminal.id).join(", ")}.${needed.length ? ` Krävs: ${needed.join(", ")}.` : " Krävs: minst en hel kontakt."}`,
    `  Ställs på apparaten (inte i filen): ${settings.length ? settings.join("; ") : "inget"}.`,
    `  Värdeetikett: ${values.length ? values.map((value) => `"${value}"`).join(", ") : "inga värden"}.`,
  ].join("\n");
}).join("\n");

/** The example: a green pushbutton whose plunger moves down when pressed and whose ring lights while the lamp has voltage. */
const EXAMPLE_SVG = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 72">`,
  `<defs><radialGradient id="cap" cx="0.4" cy="0.35" r="0.7"><stop offset="0" stop-color="#86efac"/><stop offset="1" stop-color="#15803d"/></radialGradient></defs>`,
  `<rect x="6" y="6" width="60" height="60" rx="8" fill="#1f2937"/>`,
  `<circle id="ring" cx="36" cy="36" r="25" fill="none" stroke="#475569" stroke-width="4"/>`,
  `<g id="plunger"><circle cx="36" cy="36" r="18" fill="url(#cap)"/><ellipse cx="31" cy="28" rx="8" ry="4" fill="#ffffff" opacity="0.4"/></g>`,
  `</svg>`,
].join("");
const EXAMPLE = {
  format: DEVICE_FILE_FORMAT,
  version: DEVICE_FILE_VERSION,
  devices: [
    {
      name: "Startknapp",
      label: "Belyst startknapp grön",
      short: "Sluter 13–14 medan du håller. Ringen lyser när X1–X2 har spänning.",
      group: "industri",
      function: "knapp_lampa",
      terminals: [
        { id: "1", side: "top", at: 0.25, name: "13" },
        { id: "2", side: "top", at: 0.75, name: "14" },
        { id: "X1", side: "bottom", at: 0.25 },
        { id: "X2", side: "bottom", at: 0.75 },
      ],
      image: { format: "svg", svg: EXAMPLE_SVG },
      animation: {
        rules: [
          { part: "plunger", when: "pressed", move: [0, 2], scale: 0.94, ms: 60 },
          { part: "ring", when: "energised", stroke: "#22c55e", ms: 120 },
          { part: "ring", when: "energised", blink: 1 },
        ],
      },
    },
    {
      name: "Relä 2 A2",
      label: "Relä med dubbel A2 och bara slutande kontakt",
      group: "industri",
      function: "rela",
      terminals: [
        { id: "A1", side: "top", at: null },
        { id: "A2", side: "top", at: null },
        { id: "e1", name: "A2", side: "top", at: null, role: "wire", joins: "A2" },
        { id: "11", side: "bottom", at: null },
        { id: "12", side: "bottom", at: null, used: false },
        { id: "14", side: "bottom", at: null },
      ],
    },
    {
      name: "Tilluft",
      label: "Givare tilluft med värdeetikett",
      group: "fastighet",
      function: "givare_tilluft",
      readout: { side: "right", values: ["reading"] },
    },
  ],
};

export const DEVICE_FORMAT_GUIDE = `Skapa en JSON-fil för PLC-simulatorn i Workflow.

Till AI:n:
- Svara bara med JSON-filen, utan text före eller efter.
- Ändrar du ett befintligt bibliotek: behåll varje apparats "key" och ändra aldrig "function" på en befintlig apparat (gör en ny apparat utan "key" i stället).
- Fältet "instruction" är den här texten. Låt det vara som det är eller ta bort det; det läses inte vid import.
- Kontrollera svaret mot reglerna nedan innan du svarar: bara tillåtna fält, giltig JSON, plintar och animering enligt reglerna.

Filen:
{
  "format": "${DEVICE_FILE_FORMAT}",
  "version": ${DEVICE_FILE_VERSION},
  "instruction": "…den här texten (valfri)…",
  "devices": [ ...en eller flera apparater, högst ${MAX_IMPORT_DEVICES}... ]
}

En fil kan ha en apparat eller alla. Exportera alla ger hela biblioteket med den här instruktionen överst. Filer med version 1, 2 och 3 går också att importera (version 1: bara funktionens plintar; version 2: utan animering och värdeetikett; version 3: utan fotolager, värdet "volts" och regeln "show").

En apparat:
- "name": kort namn i paletten, högst 24 tecken. Krävs.
- "label": hela namnet, högst 60 tecken. Krävs.
- "short": en mening om vad den gör, högst 200 tecken.
- "group": ${DEVICE_GROUPS.map((group) => `"${group}" (${GROUP_LABELS[group]})`).join(", ")}. Krävs.
- "function": en funktion ur listan nedan. Krävs. Funktionen bestämmer hur apparaten fungerar elektriskt och vilka plintar den har.
- "terminals": apparatens plintar. Utelämnas listan får apparaten funktionens egna plintar. Annars:
  - Alla funktionens plintar ska finnas med, med "id" exakt som i listan. En plint som funktionen inte kräver kan ha "used": false; den ritas då inte och går inte att koppla. Minst en kontakt ska ha båda sina plintar.
  - Extra plintar har "id" "e1" till "e${MAX_TERMINALS}", en "name" (krävs), "role" (${TERMINAL_ROLES.map((role) => `"${role}" = ${ROLE_LABELS[role]}`).join(", ")}) och "joins": id för en annan plint som den är förbunden med inuti apparaten, eller null.
  - Varje plint: "side" ("top" eller "bottom"), "at" (läget längs sidan, 0 = vänster, 1 = höger, eller null för jämnt fördelat), "name" (märkning, högst 8 tecken), "title" (förklaring, högst 60 tecken).
  - Högst ${MAX_TERMINALS} plintar som används, högst ${MAX_TERMINALS_PER_SIDE} på en sida.
- "image": bilden, antingen {"format": "svg", "svg": "<svg ...>...</svg>"} eller {"format": "png", "dataUrl": "data:image/png;base64,..."}. null eller utelämnad: simulatorns standardbild för funktionen. En SVG kan ha fotolager, se Bilden nedan.
- "animation": hur bildens delar rör sig, se Animering nedan. null eller utelämnad: funktionens standardanimering.
- "stateView": en extra effekt för en egen bild: ${STATE_VIEWS.map((view) => `"${view}" (${STATE_VIEW_LABELS[view]})`).join(", ")}. Använd hellre "animation".
- "imageOn": bilden när apparaten är på, i samma form som "image". Krävs när stateView är "swap".
- "sound": apparatens eget ljud, {"format": "mp3", "ogg" eller "wav", "dataUrl": "data:audio/...;base64,..."}, högst ${MAX_SOUND_BYTES / 1024} kB. null eller utelämnad: funktionens standardljud. Ljudet spelas en gång när apparaten slår till (kontaktor, relä, ventil, knapp) eller går runt så länge den går (summer, fläkt, motor, pump, larm).
- "silent": true gör apparaten tyst.
- "readout": värdeetiketten utanför plattan, se Värdeetikett nedan. null eller utelämnad: funktionens standardetikett.
- "hidden": true döljer apparaten i paletten.
- "key": valfri. Namnet på en befintlig apparat (t.ex. "knapp") om filen ska ersätta den.

Inga andra fält är tillåtna.

Värdeetikett ("readout"):
En liten ruta bredvid apparaten, utanför plattan, med apparatens värden i större siffror (t.ex. "21,5 °C" eller "BV 5 °C"). Enheten följer funktionen. Ett börvärde (BV) ändras genom att klicka på etiketten; det är samma inställning som i simulatorns egenskaper.
{ "side": en av ${READOUT_SIDES.map((side) => `"${side}" (${READOUT_SIDE_LABELS[side].toLowerCase()})`).join(", ")}, "values": [ ...värden ur funktionens lista, högst 4... ] }
- Värdena: ${READOUT_VALUES.map((value) => `"${value}" = ${READOUT_VALUE_TEXT[value]}`).join("; ")}.
- Vilka värden en funktion har står under Funktioner nedan. "values": [] döljer etiketten.
- Välj en sida utan plintar ("right" eller "left") så att etiketten inte ligger över ledningar.
Exempel på en temperaturgivare: "readout": { "side": "right", "values": ["reading"] } visar till exempel "21,5 °C" till höger om givaren.

Bottenplattan:
- Alla apparater har samma bottenplatta. Den blir bredare med plintarna: ${TERMINAL_STEP} px per plint på den sida som har flest, plus ${PLATE_EDGE} px, men aldrig smalare än funktionens egen.
- Bilden ligger ovanpå plattan och fyller den. Plintarna sitter på plattans över- och underkant.

Bilden:
- SVG högst ${MAX_SVG_BYTES / 1024} kB (med fotolager högst ${MAX_LAYERED_SVG_BYTES / 1024} kB), PNG högst ${MAX_PNG_BYTES / 1024} kB.
- Rita apparaten som en tydlig bild av föremålet, gärna med mörk eller genomskinlig bakgrund och en viewBox som börjar på 0 0, till exempel viewBox="0 0 72 72".
- Ge varje del som ska röra sig ett id (bokstäver, siffror, - och _, börjar med en bokstav), till exempel <g id="plunger">…</g>. Lägg det som rör sig i en egen grupp.
- Tillåtet: svg, g, path, rect, circle, ellipse, line, polyline, polygon, text, tspan, defs, linearGradient, radialGradient, stop, clipPath, image (bara fotolager, se nedan) och vanliga ritattribut (fill, stroke, opacity, transform …). Färger och gradienter går bra; en gradient refereras med url(#id).
- Inte tillåtet (tas bort eller nekas): script, style-element, foreignObject, use, a, filter, mask, animate, händelser (onclick m.fl.), länkar och adresser utåt.
- Fotolager (version 4): ett fotografi har inga delar, så en fotobild delas i lager: <image x="…" y="…" width="…" height="…" href="data:image/png;base64,…"/> eller data:image/webp;base64,…, varje lager i en egen grupp med id, till exempel <g id="body"><image …/></g><g id="cap"><image …/></g>. Då kan animeringen trycka in kåpan, snurra hjulet eller vrida vredet medan höljet står still. Bara inbäddad PNG eller WebP, högst ${MAX_LAYER_BYTES / 1024} kB per lager; en adress, en SVG eller något annat i href tas bort. Vektordelar (lysdiod, lins, text) ritas ovanpå i samma bild.
- Inga logotyper eller tillverkarnamn.

Animering ("animation"):
Animeringen är regler, inte kod. Inget körs; varje värde kontrolleras.
{ "rules": [ ...högst 40 regler... ] }
En regel:
- "part": id för en del i bilden. "${WHOLE_PICTURE}" är hela bilden (också en PNG). Krävs.
- "when": när regeln gäller: ${STATES.map((state) => `"${state}" (${STATE_TEXT[state]})`).join(", ")}. Skriv "not " före för motsatsen, till exempel "not energised". Utelämnad: alltid.
- Vad som händer medan regeln gäller (minst en sak):
  - "move": [x, y] flyttar delen så många enheter i bildens viewBox.
  - "rotate": grader, vrider delen (runt sin mitt, eller runt "origin").
  - "scale": 1 = oförändrad, 0.9 = mindre. "scaleY": bara på höjden (ett spjällblad som vrids, sett framifrån).
  - "origin": [x, y] punkten som "rotate" och "scale" sker runt, i bildens viewBox.
  - "opacity": 0–1.
  - "fill" och "stroke": en färg som "#22c55e" eller "#fff".
  - "hidden": true döljer delen.
  - "blink": blinkningar per sekund, 0.2–10.
  - "spin": snurrar hela tiden med fart från ett värde (${VALUES.map((value) => `"${value}"`).join(", ")} eller "one" för alltid full fart); "rpm" är varv per minut vid fullt värde (standard 60). En del som snurrar kan inte också flyttas eller vridas.
  - "follow": följer ett värde mellan två lägen: {"value": ett av ${VALUES.map((value) => `"${value}"`).join(", ")}, och "rotate": [från, till], "move": [[x, y], [x, y]], "opacity": [från, till], "scale": [från, till] eller "scaleY": [från, till]}.
  - "show": skriver ett värde i delen, som ska vara en <text> med det id:t (version 4): ${SHOW_VALUES.map((value) => `"${value}" = ${SHOW_VALUE_TEXT[value]}`).join("; ")}. Texten blir till exempel "12,5 V", "21,5 °C" eller "80 %", och "–" när inget är känt.
- "ms": hur lång tid ändringen tar, 0–3000 millisekunder.
- "ease": ${EASES.map((ease) => `"${ease}"`).join(", ")}.
Värdena: ${VALUES.map((value) => `"${value}" = ${VALUE_TEXT[value]}`).join("; ")}.
Gäller flera regler samma del läggs rörelserna ihop; för färg och genomskinlighet vinner den senare. Utan regel visas delen som den är ritad: rita alltså viloläget, och låt reglerna visa vad som händer.
Simulatorns egna bilder har sina delar med samma namn som i deras standardanimering (t.ex. "cap" och "light" på en tryckknapp, "armature", "contact" och "led" på reläet, "rotor" på fläktarna); en egen SVG med samma id får standardanimeringen utan egna regler.

Funktioner (vad de gör, plintar, vad som ställs på apparaten och vilka värden etiketten kan visa):
${functionLines}

Exempel (en belyst tryckknapp vars kolv går ner när du trycker och vars ring lyser när lampan har spänning, ett relä med dubbel A2 och en temperaturgivare med värdeetikett):
${JSON.stringify(EXAMPLE, null, 2)}
`;
