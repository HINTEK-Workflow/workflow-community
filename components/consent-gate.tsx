"use client";

import { useEffect } from "react";
import { markMeasuredPage } from "@/lib/analytics/consent-client";

/**
 * Put on a public page whose visits are measured (the landing page, Skapa konto). While the page is shown the cookie
 * box blocks it until the visitor has answered; nothing is loaded or set before that (2026-10-07). Draws nothing.
 */
export function ConsentGate() {
  useEffect(() => markMeasuredPage(), []);
  return null;
}
