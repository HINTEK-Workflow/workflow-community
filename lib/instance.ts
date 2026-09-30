// Instance settings (Fas 1, 2026-09-30): who runs this installation, its name and which commercial parts are on.
// Read from the environment at run time, so one image serves any installation; the defaults are HINTEK's own
// installation, so workflow.hintek.se behaves exactly as before without new variables. Fas 2: billing, credits and the
// landing page live in ee/; without ee/ they are off whatever the variables say. Server-only values (the admin
// address) never reach the browser; the public part travels to client components through InstanceProvider.

import { EE_PRESENT } from "@ee/present";
import { INSTANCE_DEFAULTS } from "./instance-defaults";

export type InstanceFeatures = {
  /** Stripe subscriptions, checkout and invoices. */
  billing: boolean;
  /** Credits are required for paid actions; off = unlimited use. */
  credits: boolean;
  /** The operator's AI provider for interpretation and summaries; off = rule-based answers only. */
  ai: boolean;
  /** The public landing page and its inline editor. */
  landingEditor: boolean;
};

/** The part of the instance settings that may be sent to the browser. */
export type PublicInstance = {
  /** The product name shown in the shell, titles and e-mails, e.g. "HINTEK Workflow". */
  name: string;
  /** The operator's short name, used for its originals and assistant ("HINTEK Original", "HINTEK AI"). */
  operator: string;
  /** Organization domains and slugs that identify the operator's own organization. */
  operatorDomains: string[];
  operatorSlugs: string[];
  /** true for HINTEK Workflow, whose wordmark image may be shown. */
  defaultBrand: boolean;
  features: InstanceFeatures;
};

export type InstanceEnv = Record<string, string | undefined>;

export const DEFAULT_INSTANCE_NAME: string = INSTANCE_DEFAULTS.name;

export const text = (value: string | undefined, fallback: string) => value?.trim() || fallback;
const list = (value: string | undefined, fallback: string[]) => {
  const items = value?.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean) ?? [];
  return items.length ? items : fallback;
};
// A flag is on unless it says "false": the default installation keeps every part it has today.
const flag = (value: string | undefined) => value?.trim().toLowerCase() !== "false";

export function publicInstance(source: InstanceEnv = process.env): PublicInstance {
  const name = text(source.INSTANCE_NAME, DEFAULT_INSTANCE_NAME);
  return {
    name,
    operator: text(source.INSTANCE_OPERATOR, INSTANCE_DEFAULTS.operator),
    operatorDomains: list(source.INSTANCE_OPERATOR_DOMAINS, [...INSTANCE_DEFAULTS.operatorDomains]),
    operatorSlugs: list(source.INSTANCE_OPERATOR_SLUGS, [...INSTANCE_DEFAULTS.operatorSlugs]),
    // HINTEK's wordmark image belongs to HINTEK Workflow only; every other name is shown as text.
    defaultBrand: name === "HINTEK Workflow",
    features: {
      billing: EE_PRESENT && flag(source.BILLING_ENABLED),
      credits: EE_PRESENT && flag(source.CREDITS_ENABLED),
      ai: flag(source.AI_ENABLED),
      landingEditor: EE_PRESENT && flag(source.LANDING_EDITOR_ENABLED),
    },
  };
}
