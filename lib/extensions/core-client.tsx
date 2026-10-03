"use client";
// The open core's own views for Workflow AI, the API and MCP, connected apps and import (2026-10-03): the same in
// HINTEK's installation and in the community edition, so both extension sets hand them on unchanged.
import { AssistantPanel } from "@/features/ai/assistant-panel";
import { AiSharingPolicyPanel } from "@/features/ai/sharing-policy-panel";
import { ProviderAdministration } from "@/features/ai/provider-administration";
import { AiUsageAdministration } from "@/features/ai/usage-administration";
import { IntegrationKeys, ServerKeysAdministration } from "@/features/integrations/integration-keys";
import { MyAppConnections } from "@/features/oauth/my-connections";
import { ImportPage } from "@/features/import/import-page";
import { SummaryAssist } from "@/features/ai/summary-assist";
import { PlanningProposal, RiskMeasuresAssist, WorkOrderProposal } from "@/features/ai/proposals";
import { ProtocolReview } from "@/features/ai/review";
import { DailyDigestCard } from "@/features/ai/daily-digest-card";

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
};
