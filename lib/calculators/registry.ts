import { cableAreaModule } from "./cable-area";
import { energyModule } from "./energy";
import { ohmModule } from "./ohm";
import { powerModule } from "./power";
import { shortCircuitModule } from "./short-circuit";
import type { CalcModule } from "./types";
import { unitsOf } from "./units";
import { voltageDropModule } from "./voltage-drop";

/**
 * The calculators the page offers (Räkneverktyg, 2026-10-07). A new tool is a new module file in this folder
 * and one line here; the page draws every module from its declaration (id, name, inputs, outputs, calculation, unit
 * check), so the page itself is never touched.
 */
export const CALCULATORS: readonly CalcModule[] = [powerModule, voltageDropModule, shortCircuitModule, cableAreaModule, ohmModule, energyModule];
export const DEFAULT_CALCULATOR = powerModule.id;
export const calculatorById = (id: string | null | undefined, modules: readonly CalcModule[] = CALCULATORS) => modules.find((tool) => tool.id === id);

/** What is wrong with a set of module declarations, for the tests (and for anyone adding a module). Empty when all is well. */
export function registryProblems(modules: readonly CalcModule[] = CALCULATORS): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const tool of modules) {
    if (!/^[a-z][a-z0-9-]*$/.test(tool.id)) problems.push(`${tool.id}: ogiltigt id`);
    if (ids.has(tool.id)) problems.push(`${tool.id}: id används två gånger`);
    ids.add(tool.id);
    if (!tool.name.trim() || !tool.summary.trim()) problems.push(`${tool.id}: namn och sammanfattning krävs`);
    if (!tool.help.length) problems.push(`${tool.id}: hjälptext saknas`);
    const inputIds = new Set<string>();
    for (const input of tool.inputs) {
      if (inputIds.has(input.id)) problems.push(`${tool.id}: indata ${input.id} finns två gånger`);
      inputIds.add(input.id);
      if (input.group && !tool.groups?.[input.group]) problems.push(`${tool.id}: ${input.id} har gruppen ${input.group} som inte finns`);
      if (input.kind === "number") {
        if (!unitsOf(input.dimension).length) problems.push(`${tool.id}: ${input.id} saknar enheter`);
        if (input.defaultUnit !== undefined && !unitsOf(input.dimension).includes(input.defaultUnit)) problems.push(`${tool.id}: ${input.id} har enheten ${input.defaultUnit} som inte hör till dimensionen`);
      }
    }
    const outputIds = new Set<string>();
    for (const output of tool.outputs) {
      if (outputIds.has(output.id)) problems.push(`${tool.id}: utdata ${output.id} finns två gånger`);
      outputIds.add(output.id);
    }
  }
  return problems;
}
