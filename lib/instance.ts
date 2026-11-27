// Instance settings (Fas 1, 2026-09-30): who runs this installation, its name and which commercial parts are on.
// Read from the environment at run time, so one image serves any installation; the defaults are Workflow's own
// installation, so app.example.com behaves exactly as before without new variables. Fas 2: billing, credits and the
// landing page live in ee/; without ee/ they are off whatever the variables say. Server-only values (the admin
// address) never reach the browser; the public part travels to client components through InstanceProvider.

import { EE_PRESENT } from "@ee/present";
import { INSTANCE_DEFAULTS } from "./instance-defaults";
import { publicSite } from "./public-site";

export type InstanceFeatures = {
  /** Stripe subscriptions, checkout and invoices. */
  billing: boolean;
  /** Credits are required for paid actions; off = unlimited use. */
  credits: boolean;
  /** Workflow AI (ee/). AI_ENABLED=false keeps the rule-based answers but switches the AI model off. */
  ai: boolean;
  /** The API and MCP server with its keys (in the core and the community edition since 2026-10-03). */
  integrations: boolean;
  /** Sign-in with a Google account, with the installation's own Google keys (in the core since 2026-10-03). */
  googleSignIn: boolean;
  /** A "Visa demo" button on the login page (2026-09-30: only in the community edition). */
  demoOnLogin: boolean;
  /** The public landing page and its inline editor. */
  landingEditor: boolean;
  /**
   * Veckobrevet med versionsnyheterna (2026-10-06): the release notes are Workflow's, written for Cloud, so Community has no
   * weekly letter (2026-11-10); its own mailings stay.
   */
  releaseNewsletter: boolean;
  /**
   * Appikonen (2026-11-10): the superadmin may upload the installation's own icon. Community always; Workflow's
   * installation keeps its own icons (INSTANCE_OWN_ICON=true allows it there too, for trying it).
   */
  ownIcon: boolean;
};

/** The part of the instance settings that may be sent to the browser. */
export type PublicInstance = {
  /** The product name shown in the shell, titles and e-mails, e.g. "Workflow". */
  name: string;
  /** The operator's short name, used for its originals and assistant ("HINTEK Original", "Workflow AI"). */
  operator: string;
  /** Organization domains and slugs that identify the operator's own organization. */
  operatorDomains: string[];
  operatorSlugs: string[];
  /** true for Workflow, whose wordmark image may be shown. */
  defaultBrand: boolean;
  /** The separate public address of the landing page (PUBLIC_SITE_URL, lib/public-site.ts), or "" when there is none. */
  publicSiteUrl: string;
  /** This build has no commercial part (the Community edition): Om Workflow says its licence and where the source is. */
  community: boolean;
  /** Where this installation's source code can be had (INSTANCE_SOURCE_URL); "" when none is set. Only http(s). */
  sourceUrl: string;
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
    // Workflow's wordmark image belongs to Workflow only; every other name is shown as text.
    defaultBrand: EE_PRESENT && name === INSTANCE_DEFAULTS.name,
    publicSiteUrl: publicSite({ APP_URL: text(source.APP_URL, INSTANCE_DEFAULTS.appUrl), PUBLIC_SITE_URL: source.PUBLIC_SITE_URL })?.siteOrigin ?? "",
    community: !EE_PRESENT,
    sourceUrl: /^https?:\/\/\S+$/i.test(text(source.INSTANCE_SOURCE_URL, INSTANCE_DEFAULTS.sourceUrl)) ? text(source.INSTANCE_SOURCE_URL, INSTANCE_DEFAULTS.sourceUrl) : "",
    features: {
      billing: EE_PRESENT && flag(source.BILLING_ENABLED),
      credits: EE_PRESENT && flag(source.CREDITS_ENABLED),
      ai: flag(source.AI_ENABLED),
      integrations: true,
      googleSignIn: true,
      demoOnLogin: !EE_PRESENT,
      landingEditor: EE_PRESENT && flag(source.LANDING_EDITOR_ENABLED),
      releaseNewsletter: EE_PRESENT,
      ownIcon: !EE_PRESENT || source.INSTANCE_OWN_ICON?.trim().toLowerCase() === "true",
    },
  };
}
