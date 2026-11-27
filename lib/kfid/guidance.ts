/**
 * The guidance a technician sees per moment of Kontroll före idrifttagning – the help beside each moment and the empty
 * state of each measurement table – used by the form (lib/workflow/builtin-kfid-form.ts).
 *
 * Standards-neutral (2026-10-06): the texts say how the function is used – what a row is, where its limit comes
 * from and how it is judged – never what a standard or a publisher says. No limit values: the company enters them
 * under Inställningar → Arbetssätt → Värden och referenser, and they are filled in on new rows where they can be changed.
 */
/** The help on every limit the person fills in, in every built-in form. */
export const LIMIT_HELP = "Gränsen står på raden. I protokollformuläret fylls den i från företagets värden (Inställningar → Arbetssätt → Värden och referenser) när de finns.";
/** A measured row whose limit is not filled in (2026-10-06): not judged – neither approved nor a deviation. */
export const NEEDS_LIMIT_TEXT = "Ej bedömd – ange gräns";

export const KFID_MOMENT_HELP = {
  iso: "En rad per krets och mätning. Skriv uppmätt värde och provspänning som i instrumentet. Gränsen står på raden och fylls i från företagets värden när de finns. Godkänd när uppmätt värde är minst gränsen. En rad utan gräns visas som Ej bedömd. Visar instrumentet ”>” (över mätområdet), skriv talet efter tecknet.",
  cont: "En rad per skyddsledare eller förbindning. Skriv uppmätt resistans. Gränsen står på raden och fylls i från företagets värden när de finns. Godkänd när uppmätt resistans är högst gränsen. En rad utan gräns visas som Ej bedömd.",
  volt: "En rad per mätpunkt. Välj den spänning som uppmätts, eller Avvikande om värdet ligger utanför det som gäller för anläggningen, och rotationsriktningen vid trefas. Godkänd vid 230 eller 400 Vac och en rotation som inte är vänster. Vid 400 Vac bedöms raden först när rotationen är vald.",
  rcd: "En rad per jordfelsbrytare. Standarden är EN 61008 / EN 61009. Välj samma typ, IΔn och Uc-gräns som i instrumentet och skriv de uppmätta tiderna och Uc. Gränserna visas vid Standard. Godkänd när tiderna och Uc ligger inom gränserna och båda kryssrutorna är ikryssade. Lämna 5× tomt när det inte kan provas (300 mA och mer för typ A, F och B).",
  zs: "En rad per grupp. Välj skyddsanordning och märkström och skriv uppmätt Zs. Högsta tillåtna Zs står på raden, fylls i från företagets värden när de finns och ändras efter skyddets typ och märkström. Godkänd när uppmätt Zs är högst det värdet.",
  vis: "Kryssa de punkter som är kontrollerade. Lägg till bilder eller dokument under Bilder.",
} as const;

/** The empty state of each measurement table: what one row is. */
export const KFID_EMPTY_TITLES = {
  iso: "Inga mätningar ännu. Lägg till en rad per krets och mätning, t.ex. Grupp 1 L–PE.",
  cont: "Inga mätningar ännu. Lägg till en rad per skyddsledare eller förbindning, t.ex. PE-skena–uttag kök.",
  volt: "Inga mätningar ännu. Lägg till en rad per mätpunkt, t.ex. huvudmatning eller uttag.",
  rcd: "Inga prov ännu. Lägg till en rad per jordfelsbrytare.",
  zs: "Inga mätningar ännu. Lägg till en rad per grupp.",
} as const;
