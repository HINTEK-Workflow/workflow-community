"use client";

import { createContext, useContext } from "react";
import { workViewDefaults, type WorkViewSetting } from "@/lib/workflow/work-view";
import type { ShellWorkProfile } from "@/lib/workflow/work-profile";

/**
 * The admin's default work view for the signed-in member (Arbetsvy, 2026-10-08), provided by the app shell. Null in
 * Local, the demo, under "Visa som" and for a member without a view. Display only: never read for what the person may do.
 */
export const WorkViewContext = createContext<WorkViewSetting | null>(null);

export const useWorkView = () => useContext(WorkViewContext);
export const useWorkViewDefaults = () => workViewDefaults(useContext(WorkViewContext));

/** Yrkesprofil (2026-11-01): what the admin chose and what is in force, from the shell. Null where there is none. Display only. */
export const WorkProfileContext = createContext<ShellWorkProfile | null>(null);
export const useWorkProfile = () => useContext(WorkProfileContext);
