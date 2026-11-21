"use client";

import { createContext, useCallback, useContext } from "react";
import { moduleInList, type ModuleKey } from "@/lib/workflow/modules";

/**
 * Företagets moduler (0.39.0): what is on in the company, from the app shell. Null (the demo, a page outside the shell) is everything
 * on. Display only: the server refuses a module that is off by itself, whatever a page shows.
 */
export const ModulesContext = createContext<readonly string[] | null>(null);
export const useModuleOn = (key: ModuleKey) => moduleInList(useContext(ModulesContext), key);
/** For a page that asks about several modules. */
export function useModules() {
  const modules = useContext(ModulesContext);
  return useCallback((key: ModuleKey) => moduleInList(modules, key), [modules]);
}
