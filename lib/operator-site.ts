// The community edition has no operator website of its own beside Workflow: no extra demo link, referrer group or post
// theme. Replaces lib/operator-site.ts in the export.
import type { SeriesTheme } from "@/lib/schedule/themes";

export type OperatorSite = {
  key: string;
  via: string;
  hosts: readonly string[];
  label: string;
  startLabel: string;
  themes: readonly SeriesTheme[];
};

export const OPERATOR_SITE: OperatorSite | null = null;
