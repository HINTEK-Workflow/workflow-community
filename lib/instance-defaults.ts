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
  appUrl: "http://localhost:3000",
  /** No loopback restriction: a self-hosted installation may try a production build on localhost. */
  loopbackTestDatabase: "",
} as const;
