import { type Address, type CaseValue, type Expr, FB_KINDS, type FbKind, isFbKind, type Literal, type Program, type Routine, type Stmt, type StType, type VarDecl } from "./ast";
import { StError, tokenize, type Token } from "./lexer";

// PLC-simulatorn: a recursive-descent parser for the dialect, written from scratch. Grammar in our own words:
//   program   = [PROGRAM name] { VAR decl* END_VAR } stmt* { ROUTINE name stmt* END_ROUTINE } [END_PROGRAM]
//   decl      = name [AT address] ':' type [':=' literal] ';'
//   stmt      = assign | if | case | call | CALL name ';' | RETURN ';' | ';'
// ROUTINE, END_ROUTINE, CALL and RETURN (2026-11-04) mean what they say only where nothing else could stand: a program from before
// them with a variable called Call or Return reads as it did.
//   assign    = name ':=' expr ';'
//   if        = IF expr THEN stmt* { ELSIF expr THEN stmt* } [ELSE stmt*] END_IF ';'?
//   case      = CASE expr OF { values ':' stmt* } [ELSE stmt*] END_CASE ';'?
//   call      = name '(' [param ':=' expr {',' param ':=' expr}] ')' ';'
//   expr      = or; or = xor {OR xor}; xor = and {XOR and}; and = eq {AND eq}; eq = rel {(=|<>) rel}; rel = add {(<|>|<=|>=) add}
//   add       = mul {(+|-) mul}; mul = unary {(*|/|MOD) unary}; unary = (-|NOT) unary | primary
//   primary   = literal | name | name '.' field | name '(' args ')' | '(' expr ')'

const TYPES: readonly StType[] = ["BOOL", "INT", "REAL", "TIME"];

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}

  private get here() { return this.tokens[this.index]; }
  private at(text: string, kind?: Token["kind"]) { const token = this.here; return token.text === text && (kind === undefined || token.kind === kind); }
  private fail(message: string, token: Token = this.here): never { throw new StError(message, token.line, token.col); }
  private take() { const token = this.here; if (token.kind !== "end") this.index += 1; return token; }
  private expect(text: string, what = text) {
    if (!this.at(text)) this.fail(this.here.kind === "end" ? `Programmet slutar oväntat. Här väntades ${what}.` : `Här väntades ${what}, inte ${this.here.text}.`);
    return this.take();
  }
  private ident(what: string) {
    const token = this.here;
    if (token.kind !== "ident") this.fail(token.kind === "keyword" ? `${token.text} är ett reserverat ord och kan inte vara ${what}.` : `Här väntades ${what}.`);
    return this.take();
  }

  program(): Program {
    let name: string | null = null;
    if (this.at("PROGRAM", "keyword")) { this.take(); name = this.ident("programmets namn").text; }
    const vars: VarDecl[] = [];
    while (this.at("VAR", "keyword")) {
      this.take();
      while (!this.at("END_VAR", "keyword")) {
        if (this.here.kind === "end") this.fail("VAR saknar sitt END_VAR.");
        vars.push(this.decl());
      }
      this.take();
    }
    const body: Stmt[] = [];
    while (!this.at("END_PROGRAM", "keyword") && this.here.kind !== "end" && !this.atRoutine()) body.push(this.stmt());
    const routines: Routine[] = [];
    while (this.atRoutine()) {
      const start = this.take();
      const routine = this.ident("rutinens namn");
      const inner: Stmt[] = [];
      while (!this.atWord("END_ROUTINE")) {
        if (this.here.kind === "end") this.fail(`Rutinen ${routine.text} saknar sitt END_ROUTINE.`);
        inner.push(this.stmt());
      }
      this.take();
      if (this.at(";")) this.take();
      routines.push({ name: routine.text, body: inner, line: start.line, col: start.col });
    }
    if (this.at("END_PROGRAM", "keyword")) this.take();
    if (this.here.kind !== "end") this.fail(`Oväntat efter END_PROGRAM: ${this.here.text}`);
    return { name, vars, body, routines };
  }

  /** A word without a meaning of its own elsewhere: an identifier that reads as it. */
  private atWord(word: string) { return this.here.kind === "ident" && this.here.text.toUpperCase() === word; }
  private atRoutine() { return this.atWord("ROUTINE") && this.tokens[this.index + 1]?.kind === "ident"; }

  private decl(): VarDecl {
    const nameToken = this.ident("ett variabelnamn");
    let address: Address | null = null;
    if (this.at("AT", "keyword")) {
      this.take();
      const token = this.here;
      if (token.kind !== "address") this.fail("Efter AT väntades en adress, till exempel %IX0.0.");
      this.take();
      address = parseAddress(token.text, token);
    }
    this.expect(":", "ett kolon och variabelns typ");
    const typeToken = this.take();
    const upper = typeToken.text.toUpperCase();
    let type: StType | FbKind;
    if (typeToken.kind === "keyword" && (TYPES as readonly string[]).includes(upper)) type = upper as StType;
    else if (typeToken.kind === "ident" && isFbKind(upper)) type = upper as FbKind;
    else this.fail(`Okänd typ: ${typeToken.text}. Typer: BOOL, INT, REAL, TIME och blocken ${FB_KINDS.join(", ")}.`, typeToken);
    let init: Literal | null = null;
    if (this.at(":=")) {
      this.take();
      const value = this.unary();
      if (value.kind !== "lit") this.fail("Startvärdet måste vara en konstant.", typeToken);
      init = value;
    }
    this.expect(";", "ett semikolon");
    return { name: nameToken.text, type, address, init, line: nameToken.line, col: nameToken.col };
  }

  /** A statement never starts with a literal, so one marks the next CASE label. */
  private atCaseLabel() { return this.here.kind === "int" || this.at("-", "op") || this.at("TRUE", "keyword") || this.at("FALSE", "keyword"); }

  private block(stop: readonly string[], inCase = false): Stmt[] {
    const body: Stmt[] = [];
    while (!stop.some((word) => this.at(word, "keyword")) && !(inCase && this.atCaseLabel())) {
      if (this.here.kind === "end") this.fail(`Programmet slutar oväntat. Här väntades ${stop[stop.length - 1]}.`);
      body.push(this.stmt());
    }
    return body;
  }

  private stmt(): Stmt {
    const token = this.here;
    if (this.at(";")) { this.take(); return this.stmt(); }
    if (this.at("IF", "keyword")) {
      this.take();
      const branches: { cond: Expr; body: Stmt[] }[] = [];
      let cond = this.expr();
      this.expect("THEN");
      branches.push({ cond, body: this.block(["ELSIF", "ELSE", "END_IF"]) });
      while (this.at("ELSIF", "keyword")) {
        this.take();
        cond = this.expr();
        this.expect("THEN");
        branches.push({ cond, body: this.block(["ELSIF", "ELSE", "END_IF"]) });
      }
      let elseBody: Stmt[] | null = null;
      if (this.at("ELSE", "keyword")) { this.take(); elseBody = this.block(["END_IF"]); }
      this.expect("END_IF");
      if (this.at(";")) this.take();
      return { kind: "if", branches, elseBody, line: token.line, col: token.col };
    }
    if (this.at("CASE", "keyword")) {
      this.take();
      const expr = this.expr();
      this.expect("OF");
      const cases: { values: CaseValue[]; body: Stmt[] }[] = [];
      while (!this.at("ELSE", "keyword") && !this.at("END_CASE", "keyword")) {
        if (this.here.kind === "end") this.fail("CASE saknar sitt END_CASE.");
        const values: CaseValue[] = [this.caseValue()];
        while (this.at(",")) { this.take(); values.push(this.caseValue()); }
        this.expect(":", "ett kolon efter värdena");
        cases.push({ values, body: this.block(["ELSE", "END_CASE"], true) });
      }
      let elseBody: Stmt[] | null = null;
      if (this.at("ELSE", "keyword")) { this.take(); elseBody = this.block(["END_CASE"]); }
      this.expect("END_CASE");
      if (this.at(";")) this.take();
      return { kind: "case", expr, cases, elseBody, line: token.line, col: token.col };
    }
    if (token.kind === "keyword") this.fail(`Oväntat ord: ${token.text}.`);
    if (this.atWord("CALL") && this.tokens[this.index + 1]?.kind === "ident") {
      this.take();
      const routine = this.take();
      this.expect(";", "ett semikolon");
      return { kind: "callRoutine", name: routine.text, line: token.line, col: token.col };
    }
    if (this.atWord("RETURN") && this.tokens[this.index + 1]?.text === ";") { this.take(); this.take(); return { kind: "return", line: token.line, col: token.col }; }
    const name = this.ident("ett variabelnamn").text;
    if (this.at(":=")) {
      this.take();
      const expr = this.expr();
      this.expect(";", "ett semikolon");
      return { kind: "assign", target: name, expr, line: token.line, col: token.col };
    }
    if (this.at("(")) {
      this.take();
      const args: { param: string; expr: Expr }[] = [];
      while (!this.at(")")) {
        const param = this.ident("ett parameternamn").text.toUpperCase();
        this.expect(":=", "':=' efter parameterns namn");
        args.push({ param, expr: this.expr() });
        if (this.at(",")) this.take(); else if (!this.at(")")) this.fail("Här väntades , eller ).");
      }
      this.take();
      this.expect(";", "ett semikolon");
      return { kind: "call", name, args, line: token.line, col: token.col };
    }
    return this.fail(`Efter ${name} väntades := eller ett anrop med parenteser.`);
  }

  private caseValue(): CaseValue {
    const first = this.unary();
    if (first.kind !== "lit" || first.type === "TIME") this.fail("Ett CASE-värde måste vara ett heltal, TRUE eller FALSE.", this.here);
    if (this.at("..")) {
      this.take();
      const second = this.unary();
      if (typeof first.value !== "number" || second.kind !== "lit" || typeof second.value !== "number") this.fail("Ett intervall i CASE skrivs med två heltal: 1..5.", this.here);
      return { from: first.value, to: second.value };
    }
    return first.value;
  }

  expr(): Expr { return this.binaryChain(() => this.xor(), ["OR"]); }
  private xor(): Expr { return this.binaryChain(() => this.and(), ["XOR"]); }
  private and(): Expr { return this.binaryChain(() => this.equality(), ["AND"]); }
  private equality(): Expr { return this.binaryChain(() => this.relation(), ["=", "<>"]); }
  private relation(): Expr { return this.binaryChain(() => this.additive(), ["<", ">", "<=", ">="]); }
  private additive(): Expr { return this.binaryChain(() => this.multiplicative(), ["+", "-"]); }
  private multiplicative(): Expr { return this.binaryChain(() => this.unary(), ["*", "/", "MOD"]); }

  private binaryChain(next: () => Expr, ops: readonly string[]): Expr {
    let left = next();
    while (ops.includes(this.here.text) && (this.here.kind === "op" || this.here.kind === "keyword")) {
      const token = this.take();
      const right = next();
      left = { kind: "binary", op: token.text as Extract<Expr, { kind: "binary" }>["op"], left, right, line: token.line, col: token.col };
    }
    return left;
  }

  private unary(): Expr {
    const token = this.here;
    if (this.at("-", "op") || this.at("NOT", "keyword")) {
      this.take();
      const expr = this.unary();
      // A negative literal stays a literal, so it can stand as a start value or a CASE value.
      if (token.text === "-" && expr.kind === "lit" && typeof expr.value === "number") return { ...expr, value: -expr.value, line: token.line, col: token.col };
      return { kind: "unary", op: token.text as "-" | "NOT", expr, line: token.line, col: token.col };
    }
    return this.primary();
  }

  private primary(): Expr {
    const token = this.here;
    const place = { line: token.line, col: token.col };
    if (token.kind === "int") { this.take(); return { kind: "lit", type: "INT", value: token.value ?? 0, ...place }; }
    if (token.kind === "real") { this.take(); return { kind: "lit", type: "REAL", value: token.value ?? 0, ...place }; }
    if (token.kind === "time") { this.take(); return { kind: "lit", type: "TIME", value: token.value ?? 0, ...place }; }
    if (this.at("TRUE", "keyword") || this.at("FALSE", "keyword")) { this.take(); return { kind: "lit", type: "BOOL", value: token.text === "TRUE", ...place }; }
    if (this.at("(")) { this.take(); const inner = this.expr(); this.expect(")"); return inner; }
    if (token.kind === "address") this.fail("En adress används genom en variabel: deklarera den med AT i VAR.");
    if (token.kind === "ident") {
      this.take();
      if (this.at(".")) { this.take(); const field = this.ident("ett fältnamn, till exempel Q").text.toUpperCase(); return { kind: "member", object: token.text, field, ...place }; }
      if (this.at("(")) {
        this.take();
        const args: Expr[] = [];
        while (!this.at(")")) {
          args.push(this.expr());
          if (this.at(",")) this.take(); else if (!this.at(")")) this.fail("Här väntades , eller ).");
        }
        this.take();
        return { kind: "fn", name: token.text.toUpperCase(), args, ...place };
      }
      return { kind: "var", name: token.text, ...place };
    }
    return this.fail(token.kind === "end" ? "Programmet slutar mitt i ett uttryck." : `Oväntat: ${token.text}`);
  }
}

export function parseAddress(text: string, at: { line: number; col: number }): Address {
  const match = /^%([IQ])([XW])(\d+)(?:\.(\d+))?$/.exec(text.toUpperCase());
  if (!match) throw new StError("Adressen går inte att läsa.", at.line, at.col);
  const size = match[2] as "X" | "W";
  const bit = match[4] === undefined ? null : Number(match[4]);
  if (size === "X" && bit === null) throw new StError("En bitadress skrivs byte.bit, till exempel %IX0.3.", at.line, at.col);
  if (size === "W" && bit !== null) throw new StError("En ordadress har ingen bit: skriv %IW1.", at.line, at.col);
  if (bit !== null && bit > 7) throw new StError("Biten är 0–7.", at.line, at.col);
  return { dir: match[1] as "I" | "Q", size, byte: Number(match[3]), bit };
}

/** The source as a tree, or the first error. */
export function parseProgram(source: string): Program {
  return new Parser(tokenize(source)).program();
}
