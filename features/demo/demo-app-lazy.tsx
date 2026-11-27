"use client";

import dynamic from "next/dynamic";

// The demo (its in-browser backend and made-up company) is its own chunk, loaded only when the demo runs, not with
// every page of the app (quality check 2026-10-05, F9). It is still rendered on the server as before.
export const LazyDemoApp = dynamic(() => import("./demo-app").then((module) => module.DemoApp));
