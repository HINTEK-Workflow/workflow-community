"use client";

import { useEffect } from "react";

/** A tab opened by the page it came from may close itself; a tab opened any other way just stays, with its link. */
export function CloseThisTab() {
  useEffect(() => { if (window.opener) window.close(); }, []);
  return null;
}
