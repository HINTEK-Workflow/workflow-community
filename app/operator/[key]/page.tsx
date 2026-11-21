import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OperatorApp } from "@/features/operator/operator-app";
import { DemoOperatorApp } from "@/features/operator/demo-operator-app";
import { currentOperator } from "@/lib/operator/session";
import { settingsByPageKey } from "@/lib/operator/settings-server";
import { operatorPageData } from "@/lib/operator/reports-server";
import { groupSignInReady, isOperatorMsError, OPERATOR_MS_ERRORS } from "@/lib/operator/microsoft-group";
import { isPageKey, OPERATOR_DEMO_KEY } from "@/lib/operator/rules";

export const dynamic = "force-dynamic";

/**
 * Operatörssidan (2026-10-30): /operator/<key>, the company's own address (a random key; Administration ›
 * Operatörskonton shows it and makes a new one). No side menu, no app shell, never indexed. `?maskin=<id>` opens a machine
 * from a QR code; `?niva=1|2|3` fixes the display level. /operator/demo is the public demo, answered in the browser.
 */
export const metadata: Metadata = { title: "Felanmälan", robots: { index: false, follow: false } };

type Search = { maskin?: string; niva?: string; fel?: string; demokoppling?: string };

export default async function OperatorRoute({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Search> }) {
  const { key } = await params;
  const search = await searchParams;
  const machine = typeof search.maskin === "string" ? search.maskin.slice(0, 120) : null;
  const niva = typeof search.niva === "string" ? search.niva : null;
  if (key === OPERATOR_DEMO_KEY) return <DemoOperatorApp machine={machine} niva={niva} connected={search.demokoppling === "1"} />;
  const settings = isPageKey(key) ? await settingsByPageKey(key) : null;
  if (!settings) notFound();
  const operator = await currentOperator();
  // A session of another company's page on this device does not count here: this page asks for its own sign-in.
  const initial = operator && operator.organizationId === settings.organizationId ? await operatorPageData(operator) : null;
  const microsoft = groupSignInReady({ enabled: settings.microsoftEnabled, tenantId: settings.microsoftTenantId, groupId: settings.microsoftGroupId, consentAt: settings.microsoftConsentAt });
  const error = search.fel && isOperatorMsError(search.fel) ? OPERATOR_MS_ERRORS[search.fel] : "";
  return <OperatorApp pageKey={key} company={settings.organization.name} initial={initial} microsoft={microsoft} error={error} machine={machine} niva={niva} />;
}
