/**
 * A source shown under an assistant answer. Since 2026-09-30 Workflow AI searches with the same search tool as the app,
 * the API and MCP (`/api/workflow-search` through `lib/tools`), so there is no AI-specific search any more.
 */
export type WorkflowSearchResult = {
  /** CONTROL, CUSTOMER, DOCUMENT, PROJECT, TASK … – shown as a link under the answer. */
  resourceType: string;
  resourceId: string;
  title: string;
  description: string;
  href: string;
  citationLabel: string;
};
