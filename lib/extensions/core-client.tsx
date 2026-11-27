"use client";
// The open core's own views for Workflow AI, the API and MCP, connected apps and import (2026-10-03): the same in
// Workflow's installation and in the community edition, so both extension sets hand them on unchanged.
// Laddtid på mobil (U1/T2, 2026-10-23): the whole pages and the assistant load when they are drawn, not with the app's
// first page (the assistant draws nothing while it is closed). The small buttons inside other pages stay, so nothing
// moves when a page is drawn.
import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import type { ClientExtensions } from "@/lib/extensions/types";
import { PartLoading, ViewLoading } from "@/features/kfid/view-loading";
import { SummaryAssist } from "@/features/ai/summary-assist";
import { PlanningProposal, RiskMeasuresAssist, WorkOrderProposal } from "@/features/ai/proposals";
import { ProtocolReview } from "@/features/ai/review";
import { DailyDigestCard } from "@/features/ai/daily-digest-card";

// The props as the extension type names them (a view with a default `= {}` would otherwise widen them).
type Props<K extends keyof ClientExtensions> = NonNullable<ClientExtensions[K]> extends ComponentType<infer P> ? P : never;
const AssistantPanel = dynamic<Props<"AssistantPanel">>(() => import("@/features/ai/assistant-panel").then((module) => module.AssistantPanel));
const AiSharingPolicyPanel = dynamic<Props<"SharingPolicyPanel">>(() => import("@/features/ai/sharing-policy-panel").then((module) => module.AiSharingPolicyPanel), { loading: PartLoading });
const ProviderAdministration = dynamic<Props<"ProviderAdministration">>(() => import("@/features/ai/provider-administration").then((module) => module.ProviderAdministration), { loading: PartLoading });
const AiUsageAdministration = dynamic<Props<"AiUsageAdministration">>(() => import("@/features/ai/usage-administration").then((module) => module.AiUsageAdministration), { loading: PartLoading });
const IntegrationKeys = dynamic<Props<"IntegrationKeys">>(() => import("@/features/integrations/connections").then((module) => module.ConnectionsPage), { loading: ViewLoading });
const ServerKeysAdministration = dynamic<Props<"ServerKeysAdministration">>(() => import("@/features/integrations/integration-keys").then((module) => module.ServerKeysAdministration), { loading: ViewLoading });
const MyAppConnections = dynamic<Props<"MyAppConnections">>(() => import("@/features/oauth/my-connections").then((module) => module.MyAppConnections), { loading: PartLoading });
// Fakturor (2026-11-04; in the core since 2026-11-10): the company's own invoices to its customers, in every edition.
const CustomerInvoices = dynamic<Props<"CustomerInvoices">>(() => import("@/features/customer-invoice/invoices-list").then((module) => module.CustomerInvoicesList), { loading: ViewLoading });
const CustomerInvoicesLink = dynamic(() => import("@/features/customer-invoice/invoices-list").then((module) => module.CustomerInvoicesLink));
const InvoiceFromBasis = dynamic<Props<"InvoiceFromBasis">>(() => import("@/features/customer-invoice/invoice-from-basis").then((module) => module.InvoiceFromBasis));
const InvoiceOfBasisStatus = dynamic<Props<"InvoiceOfBasisStatus">>(() => import("@/features/customer-invoice/invoice-from-basis").then((module) => module.InvoiceOfBasisStatus));
const CustomerInvoiceSettings = dynamic(() => import("@/features/customer-invoice/invoice-settings").then((module) => module.CustomerInvoiceSettings), { loading: PartLoading });
const CustomerInvoiceDisclosure = dynamic(() => import("@/features/customer-invoice/invoice-disclosure").then((module) => module.CustomerInvoiceDisclosure), { loading: PartLoading });
const CustomerInvoiceLinkView = dynamic<Props<"CustomerInvoiceLinkView">>(() => import("@/features/customer-invoice/link-view").then((module) => module.CustomerInvoiceLinkView), { loading: ViewLoading });
const ImportPage = dynamic<Props<"ImportPage">>(() => import("@/features/import/import-page").then((module) => module.ImportPage), { loading: ViewLoading });

export const coreClientExtensions = {
  AssistantPanel,
  SharingPolicyPanel: AiSharingPolicyPanel,
  ProviderAdministration,
  AiUsageAdministration,
  IntegrationKeys,
  ServerKeysAdministration,
  MyAppConnections,
  ImportPage,
  SummaryAssist,
  WorkOrderProposal,
  RiskMeasuresAssist,
  PlanningProposal,
  ProtocolReview,
  DailyDigestCard,
  CustomerInvoices,
  CustomerInvoicesLink,
  InvoiceFromBasis,
  InvoiceOfBasisStatus,
  CustomerInvoiceSettings,
  CustomerInvoiceDisclosure,
  CustomerInvoiceLinkView,
};
