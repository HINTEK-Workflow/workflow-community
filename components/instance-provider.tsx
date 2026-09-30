"use client";

import { createContext, useContext } from "react";
import { publicInstance, type PublicInstance } from "@/lib/instance";

// The installation's public settings (Fas 1, 2026-09-30), read on the server in the root layout and handed to client
// components here; without a provider (tests, isolated renders) the defaults of HINTEK's own installation apply.
const InstanceContext = createContext<PublicInstance>(publicInstance({}));

export function InstanceProvider({ value, children }: { value: PublicInstance; children: React.ReactNode }) {
  return <InstanceContext.Provider value={value}>{children}</InstanceContext.Provider>;
}

export function useInstance(): PublicInstance {
  return useContext(InstanceContext);
}
