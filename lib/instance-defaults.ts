// The defaults of a community installation. Set INSTANCE_NAME, INSTANCE_OPERATOR and INSTANCE_ADMIN_EMAIL in .env;
// without INSTANCE_ADMIN_EMAIL nobody can sign in (see README: npm run admin:create).
export const INSTANCE_DEFAULTS = {
  name: "Workflow",
  operator: "Workflow",
  operatorDomains: [] as string[],
  operatorSlugs: ["workflow"],
  adminEmail: "",
  adminName: "Administratör",
  supportEmail: "noreply@example.com",
  /** Om Workflow links here. Whoever changes the code and runs it for others sets INSTANCE_SOURCE_URL to their own copy. */
  sourceUrl: "https://github.com/HINTEK-Workflow/workflow-community",
  appUrl: "http://localhost:3000",
  /** A neutral icon (2026-11-10); the superadmin can upload the installation's own under Installation → Drift och säkerhet. */
  icons: {
    "32": "/icons/workflow-32.png?v=1", "192": "/icons/workflow-192.png?v=1", "512": "/icons/workflow-512.png?v=1",
    maskable: "/icons/workflow-maskable-512.png?v=1",
  },
  /** No loopback restriction: a self-hosted installation may try a production build on localhost. */
  loopbackTestDatabase: "",
  /** No servers expected: Drift och säkerhet shows the servers that write a status file (docs/drift/SERVERUPPDATERINGAR.md). */
  serverStatusHosts: [] as readonly string[],
  /** No limit on rows from price files: the installation pays for its own database (every file still has its own bounds). */
  catalogueRowLimit: null as number | null,
  /** No suggested Azure deployment: the owner enters their own under Tjänster och nycklar. */
  azurePreset: null,
} as const;
