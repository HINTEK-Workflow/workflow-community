// PLC-simulatorn: the syntax tree of the ST dialect. Plain objects, so a compiled program can be inspected in a test.

export type StType = "BOOL" | "INT" | "REAL" | "TIME";
export const FB_KINDS = ["TON", "TOF", "TP", "R_TRIG", "F_TRIG", "CTU", "CTD", "PID"] as const;
export type FbKind = (typeof FB_KINDS)[number];
export const isFbKind = (name: string): name is FbKind => (FB_KINDS as readonly string[]).includes(name.toUpperCase());

export type Address = { dir: "I" | "Q"; size: "X" | "W"; byte: number; bit: number | null };
export const addressText = (address: Address) => `%${address.dir}${address.size}${address.byte}${address.bit === null ? "" : `.${address.bit}`}`;

export type Place = { line: number; col: number };

export type Literal = { kind: "lit"; type: StType; value: number | boolean } & Place;
export type Expr =
  | Literal
  | ({ kind: "var"; name: string } & Place)
  | ({ kind: "member"; object: string; field: string } & Place)
  | ({ kind: "unary"; op: "-" | "NOT"; expr: Expr } & Place)
  | ({ kind: "binary"; op: "OR" | "XOR" | "AND" | "=" | "<>" | "<" | ">" | "<=" | ">=" | "+" | "-" | "*" | "/" | "MOD"; left: Expr; right: Expr } & Place)
  | ({ kind: "fn"; name: string; args: Expr[] } & Place);

export type CaseValue = number | boolean | { from: number; to: number };
export type Stmt =
  | ({ kind: "assign"; target: string; expr: Expr } & Place)
  | ({ kind: "if"; branches: { cond: Expr; body: Stmt[] }[]; elseBody: Stmt[] | null } & Place)
  | ({ kind: "case"; expr: Expr; cases: { values: CaseValue[]; body: Stmt[] }[]; elseBody: Stmt[] | null } & Place)
  | ({ kind: "call"; name: string; args: { param: string; expr: Expr }[] } & Place)
  /** CALL Name; runs a routine of the program where it stands (2026-11-04). */
  | ({ kind: "callRoutine"; name: string } & Place)
  /** RETURN; ends the routine it stands in, or the cycle's program in the main part. */
  | ({ kind: "return" } & Place);

export type VarDecl = { name: string; type: StType | FbKind; address: Address | null; init: Literal | null } & Place;
export type Routine = { name: string; body: Stmt[] } & Place;
export type Program = { name: string | null; vars: VarDecl[]; body: Stmt[]; routines: Routine[] };
