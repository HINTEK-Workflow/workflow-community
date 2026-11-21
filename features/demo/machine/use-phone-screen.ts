"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(max-width: 767px)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};

/** A phone-wide screen (under 768 px). The PLC simulator is a computer's tool (2026-11-08): on a phone the demo says so instead of opening it. */
export const PHONE_SIMULATOR_TEXT = "PLC-simulatorn behöver en större skärm. Öppna demon på en dator för att prova den.";
export const usePhoneScreen = () => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
