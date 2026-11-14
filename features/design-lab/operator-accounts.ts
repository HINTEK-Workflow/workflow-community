/**
 * Operatörskonton (förslag, 2026-10-30) – example accounts only. Each account sees part of the maintenance
 * module's machine tree (never the customer place tree) and has only the Operatör role.
 */

export type OperatorAccount = {
  id: string;
  name: string;
  kind: "Terminal" | "E-post" | "Microsoft";
  scope: string;
  scopeLabel: string;
  parts: string[];
  status: "Aktiv" | "Spärrad";
};

/** What an account may see: a node of the machine tree and the parts under it. */
export const SCOPES = [
  { id: "r1", label: "Fabriken Mellanstad (hela)", parts: ["pump", "motor", "band"] },
  { id: "l2", label: "Linje 2", parts: ["pump", "motor", "band"] },
  { id: "p4", label: "Linje 2 › Press 4", parts: ["pump", "motor"] },
  { id: "r2", label: "Pumpstation 2", parts: ["p1"] },
];

export const OPERATOR_ACCOUNTS: OperatorAccount[] = [
  { id: "o1", name: "Press 4", kind: "Terminal", scope: "p4", scopeLabel: "Linje 2 › Press 4", parts: ["pump", "motor"], status: "Aktiv" },
  { id: "o2", name: "Linje 2", kind: "Terminal", scope: "l2", scopeLabel: "Linje 2", parts: ["pump", "motor", "band"], status: "Aktiv" },
  { id: "o3", name: "lisa.berg@exempelfabriken.se", kind: "E-post", scope: "r1", scopeLabel: "Fabriken Mellanstad", parts: ["pump", "motor", "band"], status: "Aktiv" },
  { id: "o4", name: "Avdelning Montering", kind: "Terminal", scope: "l2", scopeLabel: "Linje 2", parts: ["pump", "motor", "band"], status: "Spärrad" },
  { id: "o5", name: "Elin Ström (Microsoft)", kind: "Microsoft", scope: "r1", scopeLabel: "Fabriken Mellanstad", parts: ["pump", "motor", "band"], status: "Aktiv" },
];

export const PASSWORD_MIN = 8;
/** A few common passwords; the real check would also ask a list of leaked passwords. */
const COMMON = ["password", "lösenord", "12345678", "123456789", "qwerty123", "sommar2026", "vinter2026", "operator1"];
export function passwordProblem(value: string): string {
  if (value.length < PASSWORD_MIN) return `Minst ${PASSWORD_MIN} tecken.`;
  if (COMMON.includes(value.toLowerCase())) return "Lösenordet är för vanligt.";
  return "";
}
