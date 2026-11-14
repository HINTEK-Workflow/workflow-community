"use client";

import { clientExtensions } from "@ee/client";

/** The form on /rapportera, from the commercial part (ee/); nothing without it (the page answers 404 there). */
export function ReportPageForm({ source, page }: { source?: "demo"; page?: string }) {
  const Form = clientExtensions.ReportForm;
  return Form ? <Form source={source} page={page} /> : null;
}
