import { checkUnit } from "./units";
import type { CalcInput, CalcModule, UnitIssue } from "./types";

/** The unit check every module gets: each unit chosen for a number input must belong to that input's dimension. */
export function unitCheckFor(inputs: readonly CalcInput[]): CalcModule["unitCheck"] {
  return (units) => inputs.flatMap((input): UnitIssue[] => {
    if (input.kind !== "number" || units[input.id] === undefined) return [];
    const message = checkUnit(input.dimension, units[input.id], input.label);
    return message ? [{ field: input.id, message }] : [];
  });
}

/** Declares a module; the unit check comes from its inputs unless the module adds its own. */
export function defineCalculator(tool: Omit<CalcModule, "unitCheck"> & { unitCheck?: CalcModule["unitCheck"] }): CalcModule {
  const own = tool.unitCheck;
  const standard = unitCheckFor(tool.inputs);
  return { ...tool, unitCheck: own ? (units) => [...standard(units), ...own(units)] : standard };
}
