import type { ToolKind } from "./dnd";
import { isLdBit, isLdName, type LdCalcOp, type LdCmpOp, type LdNode, type LdOperand, type LdOutputKind } from "./model";
import { parseTimeLiteral } from "@/lib/machine/simulator/st/lexer";

// PLC-simulatorn, Ladder (the owner 2026-11-04: "Välj standardens namn och symboler som grund"): every instruction's name, in one
// table. Function blocks and pins carry the names of IEC 61131-3 (TON, TOF, TP, CTU, CTD, R_TRIG, F_TRIG, GT, GE, LT, LE, EQ, NE,
// ADD, SUB, MUL, DIV, MOVE; IN, PT, Q, ET, CU, R, PV, CV), contacts and coils are symbols. Our own code, help texts and drawings. The
// toolbar, the boxes on the rungs and the text line all read this table, so another naming would be changed here and nowhere else.

export type InstructionTab = "favoriter" | "bit" | "timer" | "jamfor" | "berakna" | "styrning";
export const INSTRUCTION_TABS: readonly { id: InstructionTab; label: string }[] = [
  { id: "favoriter", label: "Favoriter" }, { id: "bit", label: "Bit" }, { id: "timer", label: "Timer/Räknare" }, { id: "jamfor", label: "Jämför" }, { id: "berakna", label: "Beräkna" }, { id: "styrning", label: "Programstyrning" },
];

export type Instruction = { tool: ToolKind; name: string; title: string; tabs: readonly InstructionTab[]; symbol?: "no" | "nc" | "coil" | "ncoil" | "set" | "reset" };
export const INSTRUCTIONS: readonly Instruction[] = [
  { tool: "no", name: "NO", title: "Slutande kontakt: leder när taggen är 1", tabs: ["favoriter", "bit"], symbol: "no" },
  { tool: "nc", name: "NC", title: "Brytande kontakt: leder när taggen är 0", tabs: ["favoriter", "bit"], symbol: "nc" },
  { tool: "coil", name: "COIL", title: "Spole: taggen följer flödet", tabs: ["favoriter", "bit"], symbol: "coil" },
  { tool: "ncoil", name: "NCOIL", title: "Negerad spole: taggen är motsatsen till flödet", tabs: ["bit"], symbol: "ncoil" },
  { tool: "set", name: "S", title: "Set: taggen blir 1 och förblir 1", tabs: ["favoriter", "bit"], symbol: "set" },
  { tool: "reset", name: "R", title: "Reset: taggen blir 0 och förblir 0", tabs: ["favoriter", "bit"], symbol: "reset" },
  { tool: "parallel", name: "Gren", title: "Parallell gren runt det markerade (Ctrl+B)", tabs: ["favoriter", "bit"] },
  { tool: "r_trig", name: "R_TRIG", title: "Flank: Q i en cykel när flödet går till", tabs: ["bit"] },
  { tool: "f_trig", name: "F_TRIG", title: "Flank: Q i en cykel när flödet går från", tabs: ["bit"] },
  { tool: "ton", name: "TON", title: "Tillslagsfördröjning: Q när IN varit till i tiden PT", tabs: ["favoriter", "timer"] },
  { tool: "tof", name: "TOF", title: "Frånslagsfördröjning: Q hålls tiden PT efter att IN gått från", tabs: ["timer"] },
  { tool: "tp", name: "TP", title: "Puls: Q i tiden PT från stigande flank på IN", tabs: ["timer"] },
  { tool: "ctu", name: "CTU", title: "Räknare upp: CV ökar på CU, Q när CV når PV, R nollställer", tabs: ["favoriter", "timer"] },
  { tool: "ctd", name: "CTD", title: "Räknare ner: CV minskar på CD, Q när CV är 0, LD laddar PV", tabs: ["timer"] },
  { tool: "gt", name: "GT", title: "Större än: IN1 > IN2", tabs: ["favoriter", "jamfor"] },
  { tool: "ge", name: "GE", title: "Större än eller lika: IN1 ≥ IN2", tabs: ["jamfor"] },
  { tool: "lt", name: "LT", title: "Mindre än: IN1 < IN2", tabs: ["favoriter", "jamfor"] },
  { tool: "le", name: "LE", title: "Mindre än eller lika: IN1 ≤ IN2", tabs: ["jamfor"] },
  { tool: "eq", name: "EQ", title: "Lika: IN1 = IN2", tabs: ["jamfor"] },
  { tool: "ne", name: "NE", title: "Olika: IN1 ≠ IN2", tabs: ["jamfor"] },
  { tool: "add", name: "ADD", title: "Summa: OUT := IN1 + IN2 när flödet är till", tabs: ["berakna"] },
  { tool: "sub", name: "SUB", title: "Skillnad: OUT := IN1 − IN2 när flödet är till", tabs: ["berakna"] },
  { tool: "mul", name: "MUL", title: "Produkt: OUT := IN1 × IN2 när flödet är till", tabs: ["berakna"] },
  { tool: "div", name: "DIV", title: "Kvot: OUT := IN1 / IN2 när flödet är till", tabs: ["berakna"] },
  { tool: "move", name: "MOVE", title: "Kopiera: OUT := IN när flödet är till", tabs: ["favoriter", "berakna"] },
  { tool: "st", name: "ST", title: "ST-block: satser utan Ladder-form", tabs: ["berakna", "styrning"] },
  { tool: "call", name: "CALL", title: "Kör en rutin när flödet är till", tabs: ["styrning"] },
  { tool: "ret", name: "RET", title: "Avsluta rutinen när flödet är till", tabs: ["styrning"] },
];
export const instructionOf = (tool: ToolKind) => INSTRUCTIONS.find((item) => item.tool === tool) ?? null;
export const toolsInTab = (tab: InstructionTab) => INSTRUCTIONS.filter((item) => item.tabs.includes(tab));

export const CMP_NAMES: Record<LdCmpOp, string> = { ">": "GT", ">=": "GE", "<": "LT", "<=": "LE", "=": "EQ", "<>": "NE" };
const CMP_BY_NAME: Record<string, LdCmpOp> = { GT: ">", GE: ">=", LT: "<", LE: "<=", EQ: "=", NE: "<>" };
export const CALC_NAMES: Record<LdCalcOp, string> = { ADD: "ADD", SUB: "SUB", MUL: "MUL", DIV: "DIV", MOVE: "MOVE" };
export const BLOCK_NAMES = { ton: "TON", tof: "TOF", tp: "TP", ctu: "CTU", ctd: "CTD", r_trig: "R_TRIG", f_trig: "F_TRIG" } as const;
export const OUTPUT_SYMBOLS: Record<LdOutputKind, string> = { coil: "Spole", ncoil: "Negerad spole", set: "S", reset: "R" };

// ---------- the text line: the same names, written ----------

export function parseOperand(text: string): LdOperand | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return { kind: "const", value: Number(trimmed), type: trimmed.includes(".") ? "REAL" : "INT" };
  const time = /^T#(.+)$/i.exec(trimmed);
  if (time) { const ms = parseTimeLiteral(time[1]); return ms === null ? null : { kind: "const", value: ms, type: "TIME" }; }
  const member = /^([A-Za-z_][A-Za-z0-9_]*)\.(Q|ET|CV)$/i.exec(trimmed);
  if (member) return isLdName(member[1]) ? { kind: "member", object: member[1], field: member[2].toUpperCase() as "Q" | "ET" | "CV" } : null;
  return isLdName(trimmed) ? { kind: "var", name: trimmed } : null;
}

type NodeDraft = LdNode extends infer N ? (N extends LdNode ? Omit<N, "id"> : never) : never;
export type ParsedLine = { nodes: NodeDraft[]; outputs: { kind: LdOutputKind; var: string }[] };
export type LineResult = { ok: true; parsed: ParsedLine } | { ok: false; reason: string };

/**
 * One line of instructions in the standard's names, in the order they stand in the rung: `NO Start NC Stopp COIL Motor`,
 * `TON T1 2s COIL Lampa`, `GT AI0 5000 S Larm`, `CTU C1 5 Nollst`, `ADD A B Summa`, `MOVE 5 X`, `CALL Rutin1`, `RET`.
 */
export function parseInstructionLine(text: string): LineResult {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { ok: false, reason: "Skriv till exempel: NO Start NC Stopp COIL Motor" };
  const nodes: ParsedLine["nodes"] = [];
  const outputs: ParsedLine["outputs"] = [];
  let at = 0;
  const next = (what: string) => { const word = words[at]; at += 1; return word ?? `\0${what}`; };
  const missing = (word: string) => word.startsWith("\0");
  while (at < words.length) {
    const name = words[at].toUpperCase();
    at += 1;
    const fail = (reason: string): LineResult => ({ ok: false, reason: `${name}: ${reason}` });
    if (name === "NO" || name === "NC") {
      const tag = next("en tagg");
      if (missing(tag) || !isLdBit(tag)) return fail("behöver en tagg.");
      nodes.push({ kind: name === "NO" ? "no" : "nc", var: tag });
    } else if (name === "COIL" || name === "NCOIL" || name === "S" || name === "R") {
      const tag = next("en tagg");
      if (missing(tag) || !isLdName(tag)) return fail("behöver en tagg.");
      outputs.push({ kind: name === "COIL" ? "coil" : name === "NCOIL" ? "ncoil" : name === "S" ? "set" : "reset", var: tag });
    } else if (name === "TON" || name === "TOF" || name === "TP") {
      const block = next("ett namn"), time = next("en tid");
      if (missing(block) || !isLdName(block)) return fail("behöver ett namn.");
      const ptMs = missing(time) ? null : parseTimeLiteral(time.replace(/^T#/i, "").replace(",", "."));
      if (ptMs === null) return fail("behöver en tid som 2s eller 500ms.");
      nodes.push({ kind: name.toLowerCase() as "ton" | "tof" | "tp", name: block, ptMs });
    } else if (name === "CTU" || name === "CTD") {
      const block = next("ett namn"), pv = next("ett förval");
      if (missing(block) || !isLdName(block)) return fail("behöver ett namn.");
      if (missing(pv) || !/^-?\d+$/.test(pv)) return fail("behöver ett förval, ett heltal.");
      const aux = words[at] && isLdName(words[at]) && !isInstruction(words[at]) ? next("") : null;
      nodes.push({ kind: name === "CTU" ? "ctu" : "ctd", name: block, pv: Number(pv), aux });
    } else if (name === "R_TRIG" || name === "F_TRIG") {
      const block = next("ett namn");
      if (missing(block) || !isLdName(block)) return fail("behöver ett namn.");
      nodes.push({ kind: name.toLowerCase() as "r_trig" | "f_trig", name: block });
    } else if (name in CMP_BY_NAME) {
      const left = parseOperand(next("IN1")), right = parseOperand(next("IN2"));
      if (!left || !right) return fail("behöver IN1 och IN2.");
      nodes.push({ kind: "cmp", op: CMP_BY_NAME[name], left, right });
    } else if (name === "ADD" || name === "SUB" || name === "MUL" || name === "DIV") {
      const a = parseOperand(next("IN1")), b = parseOperand(next("IN2")), dest = next("OUT");
      if (!a || !b || missing(dest) || !isLdName(dest)) return fail("behöver IN1, IN2 och OUT.");
      nodes.push({ kind: "calc", op: name, a, b, dest });
    } else if (name === "MOVE") {
      const a = parseOperand(next("IN")), dest = next("OUT");
      if (!a || missing(dest) || !isLdName(dest)) return fail("behöver IN och OUT.");
      nodes.push({ kind: "calc", op: "MOVE", a, b: null, dest });
    } else if (name === "CALL") {
      const routine = next("en rutin");
      if (missing(routine) || !isLdName(routine)) return fail("behöver en rutin.");
      nodes.push({ kind: "call", routine });
    } else if (name === "RET") {
      nodes.push({ kind: "ret" });
    } else return { ok: false, reason: `Okänd instruktion: ${words[at - 1]}.` };
  }
  return { ok: true, parsed: { nodes, outputs } };
}
const isInstruction = (word: string) => /^(NO|NC|COIL|NCOIL|S|R|TON|TOF|TP|CTU|CTD|R_TRIG|F_TRIG|GT|GE|LT|LE|EQ|NE|ADD|SUB|MUL|DIV|MOVE|CALL|RET)$/i.test(word);
