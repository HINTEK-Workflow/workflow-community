// PLC-simulatorn: short ST programs to try on their own, one line of explanation each. The drawings' programs
// live with the drawings (surface/examples.ts); these need no wiring to show something.

export type StExample = { id: string; title: string; line: string; source: string };

export const ST_EXAMPLES: readonly StExample[] = [
  {
    id: "blink", title: "Blinkande lampa", line: "Två timrar som turas om: utgång DO0 blinkar med en sekund till och en sekund från.",
    source: [
      "PROGRAM Blink", "VAR", "  Lampa AT %QX0.0 : BOOL;", "  Till : TON;", "  Fran : TON;", "END_VAR", "",
      "(* Till räknar medan lampan är släckt, Från medan den lyser. *)",
      "Till(IN := NOT Lampa AND NOT Fran.Q, PT := T#1s);", "Fran(IN := Lampa, PT := T#1s);", "",
      "IF Till.Q THEN", "  Lampa := TRUE;", "ELSIF Fran.Q THEN", "  Lampa := FALSE;", "END_IF;", "END_PROGRAM",
    ].join("\n"),
  },
  {
    id: "raknare", title: "Räknare med återställning", line: "Varje tryck på DI0 räknas; vid fem tänds DO0, DI1 nollställer.",
    source: [
      "PROGRAM Raknare", "VAR", "  Knapp AT %IX0.0 : BOOL;", "  Noll AT %IX0.1 : BOOL;", "  Fem AT %QX0.0 : BOOL;", "  Puls : R_TRIG;", "  Antal : CTU;", "END_VAR", "",
      "Puls(CLK := Knapp);                       // en cykel per tryck",
      "Antal(CU := Puls.Q, R := Noll, PV := 5);", "Fem := Antal.Q;", "END_PROGRAM",
    ].join("\n"),
  },
  {
    id: "stegsekvens", title: "Stegsekvens med CASE", line: "Ett steg i taget: DO0, sedan DO1, sedan DO2, en sekund vardera, runt och runt.",
    source: [
      "PROGRAM Steg", "VAR", "  Ut0 AT %QX0.0 : BOOL;", "  Ut1 AT %QX0.1 : BOOL;", "  Ut2 AT %QX0.2 : BOOL;", "  Steg : INT := 0;", "  Vantan : TON;", "END_VAR", "",
      "Vantan(IN := TRUE, PT := T#1s);", "",
      "IF Vantan.Q THEN", "  Steg := (Steg + 1) MOD 3;", "  Vantan(IN := FALSE, PT := T#1s);        // nollställ timern", "END_IF;", "",
      "CASE Steg OF", "  0: Ut0 := TRUE; Ut1 := FALSE; Ut2 := FALSE;", "  1: Ut0 := FALSE; Ut1 := TRUE; Ut2 := FALSE;", "  2: Ut0 := FALSE; Ut1 := FALSE; Ut2 := TRUE;", "END_CASE;", "END_PROGRAM",
    ].join("\n"),
  },
  {
    id: "skalning", title: "Skala en analog signal", line: "AI0 (0–10 V) blir procent; över 80 % tänds DO0 efter två sekunder.",
    source: [
      "PROGRAM Skalning", "VAR", "  Raw AT %IW0 : INT;      // 0–10000", "  Hog AT %QX0.0 : BOOL;", "  Procent : REAL;", "  Fordrojning : TON;", "END_VAR", "",
      "Procent := INT_TO_REAL(Raw) / 100.0;", "Fordrojning(IN := Procent > 80.0, PT := T#2s);", "Hog := Fordrojning.Q;", "END_PROGRAM",
    ].join("\n"),
  },
  {
    id: "tidsstyrning", title: "Tidsstyrning efter klockan", line: "DO0 är till vardagar 06–18 enligt simulatorns klocka. Öka hastigheten så går dygnet fort.",
    source: [
      "PROGRAM Tidsstyrning", "VAR", "  Drift AT %QX0.0 : BOOL;", "  TID_H : INT;        // klockans timme", "  VECKODAG : INT;     // 1 = måndag … 7 = söndag", "END_VAR", "",
      "Drift := VECKODAG <= 5 AND TID_H >= 6 AND TID_H < 18;", "END_PROGRAM",
    ].join("\n"),
  },
];

/** The help card "Så skriver du", in our own words, one screen. */
export const ST_HELP: readonly { title: string; lines: readonly string[] }[] = [
  { title: "Programmet", lines: ["PROGRAM Namn … END_PROGRAM runt allt (får utelämnas).", "VAR … END_VAR deklarerar variablerna. Sedan satser, en i taget, avslutade med ;.", "Kommentarer: (* så här *) eller // till radens slut."] },
  { title: "Variabler och plintar", lines: ["Namn AT %IX0.0 : BOOL; knyter till DI0. %IX1.0 är DI8. %QX0.3 är DO3.", "Namn AT %IW1 : INT; är AI1, 0–10000 för 0–10 V. %QW0 är AO0.", "En variabel som heter DI0, AI2, DO5 eller AO1 behöver inget AT.", "Typer: BOOL, INT, REAL, TIME. Startvärde: Steg : INT := 2;", "TID_H, TID_M och VECKODAG (INT) ger simulatorns klocka."] },
  { title: "Satser", lines: ["Tilldelning: Motor := Start AND NOT Stopp;", "IF villkor THEN … ELSIF … ELSE … END_IF;", "CASE Steg OF 1: … 2, 3..5: … ELSE … END_CASE;", "Block anropas med namn på ingångarna: T1(IN := Start, PT := T#2s); och läses som T1.Q.", "Delrutin: ROUTINE Namn … END_ROUTINE; anropas med CALL Namn; och RETURN; hoppar ur.", "Slingor (FOR, WHILE) finns inte: programmet körs om från början varje cykel."] },
  { title: "Uttryck", lines: ["AND OR XOR NOT, jämförelser = <> < > <= >=, räkning + - * / MOD.", "Tal: 12, 12.5, tider T#500ms, T#2s, T#1m30s, sant/falskt TRUE FALSE.", "INT blir REAL av sig själv; REAL till INT kräver REAL_TO_INT eller TRUNC.", "Funktioner: ABS MIN MAX LIMIT SQRT INT_TO_REAL REAL_TO_INT TRUNC TIME_TO_REAL."] },
  { title: "Block", lines: ["TON (IN, PT → Q, ET) tillslagsfördröjning. TOF frånslagsfördröjning. TP en puls på PT vid stigande flank.", "R_TRIG, F_TRIG (CLK → Q) en cykel på stigande eller fallande flank.", "CTU (CU, R, PV → Q, CV) räknar upp, CTD (CD, LD, PV → Q, CV) räknar ner.", "PID (SP, PV, KP, TI, TD, MIN, MAX, MANUAL, MV → OUT, ERR, SP, PV) regulatorn, OUT i MIN–MAX; SP och PV går att läsa och visa i Trend."] },
];
