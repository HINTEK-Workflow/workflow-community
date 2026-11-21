/**
 * The company's data and the export (2026-11-04, owner's decision: the export is complete). Every Prisma model is in this
 * register, exactly once, with where it goes or why it stays out. tests/cloud-export-coverage.test.ts fails when a model is
 * missing here, so a new table cannot fall behind the export unnoticed.
 *
 *  hwf      the .hwf file (or the zip file in parts for a large company), under cloud-export.ts
 *  sales    the zip file of quotes, invoice bases and invoices, under cloud-export-sales.ts
 *  archive  the company archive (cloud-export-archive.ts): every column of the table as JSON, in parts, except what is secret.
 *           Local cannot use these tables yet; the archive is a readable copy, not a file Local opens.
 *  excluded not the company's own business data, with the reason
 *
 * A column whose name says it is secret (sealed, hash, token, secret, password, encrypted, key material) never leaves, unless
 * the entry lists it in `keep` (a checksum that proves content, not a credential).
 */
export type ArchiveTable = {
  status: "archive";
  /** The folder of the table in the archive. */
  folder: string;
  note: string;
  /** How a row belongs to the company: its own organizationId (default), or through a parent. */
  where?: (organizationId: string) => Record<string, unknown>;
  /** Columns left out although their name looks harmless. */
  omit?: string[];
  /** Columns with a secret-looking name that are not secret. */
  keep?: string[];
  /** The rows have a stored file (storagePath): the file goes into the archive too. */
  files?: boolean;
};
export type ExportEntry = ArchiveTable | { status: "hwf" | "sales"; note: string } | { status: "excluded"; reason: string };

const hwf = (note: string): ExportEntry => ({ status: "hwf", note });
const sales = (note: string): ExportEntry => ({ status: "sales", note });
const excluded = (reason: string): ExportEntry => ({ status: "excluded", reason });
const archive = (folder: string, note: string, extra: Partial<Omit<ArchiveTable, "status" | "folder" | "note">> = {}): ExportEntry => ({ status: "archive", folder, note, ...extra });
const through = (relation: string) => (organizationId: string) => ({ [relation]: { organizationId } });

const account = "A person's own account and login, not the company's business data; the person has their own access and erasure.";
const billing = "Workflow billing and credits (owner's decision: not exported).";
const secrets = "Keys, tokens or secrets; never exported.";
const shared = "Workflow's shared register, not the company's own data.";
const log = "Delivery or security log of the platform, with technical identifiers; not the company's business data.";

export const EXPORT_REGISTER: Record<string, ExportEntry> = {
  // People, login and security
  User: excluded(account), UserPasskey: excluded(secrets), WebAuthnChallenge: excluded(secrets), UserBackupCode: excluded(secrets),
  UserSession: excluded(secrets), AuthAccount: excluded(secrets), VerificationToken: excluded(secrets), PasswordResetToken: excluded(secrets),
  UserPreferences: excluded("A person's own settings."), NoticePreference: excluded("A person's own notice settings."),
  PushSubscription: excluded("A person's own device registration (push keys)."),
  SecurityEvent: excluded(log), RateLimitBucket: excluded("Technical rate-limit counter of the platform."), OrganizationInvitation: excluded("Invitations carry a one-time token; open invitations are not business data."),
  OAuthClient: excluded(secrets), OAuthAuthorizationCode: excluded(secrets), OAuthGrant: excluded(secrets), OAuthToken: excluded(secrets),
  IntegrationKey: excluded(secrets), OrganizationDataKey: excluded(secrets),
  OrganizationMember: archive("personer", "Staff list: role, working hours, permissions, with the person's name and e-mail joined from the user (no login data)."),
  Organization: excluded("The company row holds billing and platform state; the name and working hours are in foretag.json."),
  LocalWorkspaceBinding: excluded("Bookkeeping of earlier Cloud copies."), CloudImport: excluded("Bookkeeping of earlier re-imports."),
  LegalDocument: excluded(shared), LegalAcceptance: excluded("Workflow's evidence of the terms the company accepted."),
  CompanyClosure: excluded("The closure countdown of the platform."),
  AnalyticsCounter: excluded(shared), SystemSettings: excluded(shared), PdfTemplateOverride: excluded(shared), PlcDeviceDesign: excluded(shared), ServerJob: excluded(shared),
  // Min webbsida (2026-11-10): the company's own website. The connection holds the sealed application password (made again in
  // WordPress, never exported); the drafts and the backups of the company's pages are its own content and go in the archive.
  WebsiteConnection: excluded("The connection to the company's WordPress holds the sealed application password; it is made again in WordPress, never exported."),
  WebsitePageDraft: archive("webbsida-utkast", "Drafts of the company's own website pages (the block markup) saved in Workflow."),
  WebsitePageBackup: archive("webbsida-sakerhetskopior", "The company's website pages as they were before Workflow wrote them (Publicera, Återställ)."),
  // Facebook och Instagram (2026-11-10): the connection holds the sealed app secret and tokens (made again at Meta, never
  // exported); the posts are the company's own texts.
  WebsiteFont: excluded("Copies of the web fonts the company's site uses, read again from the site."),
  MetaConnection: excluded("The connection to the company's Meta app holds the sealed app secret and tokens; it is made again at Meta, never exported."),
  // LinkedIn (2026-11-11): the same – the connection holds the sealed client secret and tokens.
  LinkedInConnection: excluded("The connection to the company's LinkedIn app holds the sealed client secret and tokens; it is made again at LinkedIn, never exported."),
  // YouTube (2026-11-20): the connection likewise; the films' texts and choices are the company's own (the film files and cover
  // pictures stay in the file storage and are not part of the archive).
  YouTubeConnection: excluded("The connection to the company's Google API project holds the sealed client secret and tokens; it is made again at Google, never exported."),
  YouTubeVideo: archive("filmer", "The company's films for YouTube: titles, descriptions, tags, who may see them and the YouTube id, without the film file."),
  SocialPostImage: excluded("The posts' pictures: fetched or uploaded image bytes for publishing, not the company's own records; the posts themselves are exported (inlagg)."),
  SocialPost: archive("inlagg", "The company's posts for Facebook, Instagram and LinkedIn (drafts and what was published), without the picture (drawn from the texts)."),
  ScheduledPublish: excluded("Pending and past scheduled publications are working state for the publishing job (approved content snapshot, locks, retries); the posts and pages themselves are exported."),
  ContentSeries: excluded("A content series is a planning aid that produces ordinary posts; the posts are exported."),
  ContentSeriesItem: excluded("The slots of a content series point to ordinary posts, which are exported."),
  // Återkommande (2026-11-12): the company's own setting, weekdays and a clock time.
  PostingRhythm: archive("publiceringsrytm", "The company's publishing rhythm for posts (weekdays and a clock time)."),
  Mailing: excluded("Workflow's own mailings."), MailingRecipient: excluded("Workflow's own mailings."),
  // Följ nyhetsbrevet (2026-11-12): addresses from Workflow's own landing page, not any company's data.
  NewsletterSubscriber: excluded("Workflow's own newsletter subscribers from the landing page."),
  NoticeDelivery: excluded(log), RoundReminderDelivery: excluded(log),
  AdministrationEvent: archive("administrationshistorik", "The company's administration history (who changed what)."),

  // Workflow billing, credits and AI usage
  CreditWallet: excluded(billing), CreditLot: excluded(billing), CreditExpiryNotice: excluded(billing), CreditEntry: excluded(billing), CreditAllocation: excluded(billing),
  CreditPurchase: excluded(billing), BillingAdjustment: excluded(billing), CloudSubscription: excluded(billing), StripeCustomer: excluded(billing),
  BillingOrder: excluded(billing), BillingOrderItem: excluded(billing), BillingInvoice: excluded(billing), BillingNotice: excluded(billing), BankPayment: excluded(billing),
  BankPaymentAllocation: excluded(billing), CloudEntitlement: excluded(billing), BillingAuditEvent: excluded(billing), PaymentEvent: excluded(billing),
  OrganizationBillingPolicy: excluded(billing), PriceVersion: excluded(billing), PriceChangeNotice: excluded(billing),
  AiRun: excluded("AI usage and its credit cost (billing)."), AiRunEvent: excluded("AI usage log of the platform, with cost details."), AiRunCreditRelease: excluded(billing),
  AiConversation: excluded("A person's own AI chat; erased with the person. Owner to decide if chats should be exported."), AiMessage: excluded("Part of a person's AI chat."),
  AiProposal: excluded("Part of a person's AI chat."), AiMemory: excluded("AI memory (company and personal); not business records."),
  AiDailyDigest: excluded("Generated AI summary of facts that are exported in their own tables."),

  // Customers, projects, work orders, time and planning (the .hwf file)
  Customer: hwf("kunder"), CustomerFacility: hwf("platser"), Project: hwf("projekt"), ProjectEvent: hwf("with the project"), ProjectDecision: hwf("with the project"),
  WorkflowTask: hwf("uppgifter"), WorkflowTaskRevision: hwf("with the task"), WorkflowTimeEntry: hwf("with the task or project"), WorkflowTimeEntryEvent: hwf("tidhistorik"),
  PlannedActivity: hwf("planering"), PlannedActivityAssignment: hwf("with the activity"), PlannedActivityEvent: hwf("with the activity"),
  WorkflowTaskAttachment: hwf("bilagor, the files too"), Comment: hwf("kommentarer"),
  FormLimitProfile: hwf("gränsprofiler"), FormSchedule: hwf("driftronder"), CompanyReferenceValue: hwf("companyValues"),
  TimeType: archive("tidtyper", "Time types and payroll codes."),
  RoundOccurrenceOutcome: archive("rondutfall", "Done, skipped or moved round occurrences."),

  // Controls and forms
  Control: archive("kontroller", "Controls of the older control register (data, status, version)."),
  ControlRevision: archive("kontroller-versioner", "Earlier versions of a control.", { where: through("control") }),
  Attachment: archive("kontroller-bilagor", "Attachments of controls, with the files.", { files: true }),
  GeneratedResult: archive("kontroller-resultat", "Generated results of controls (text; files where stored).", { files: true }),
  ControlVisit: excluded("Who opened which control when; a reading log."),
  FormTemplate: archive("formular", "The company's own forms (not Workflow's built-in ones)."),
  FormTemplateVersion: archive("formular-versioner", "Published versions of the company's forms.", { where: through("template"), keep: ["hash"] }),
  FormTemplateEvent: archive("formular-historik", "History of the company's forms.", { where: through("template") }),
  ReportArchiveEntry: archive("rapportarkiv", "The report archive, with the saved report files.", { files: true }),
  ImportedFile: archive("importerade-filer", "Files uploaded for import, with the files.", { files: true }),
  WorkspaceSettings: archive("foretagsinstallningar", "The company's settings (name, contact, colours, rules). The logo file is not included."),

  // Absence, time periods and payroll
  Absence: archive("franvaro", "Absence per person (type, dates, status, source).", { keep: ["externalHash"] }),
  AbsenceEvent: archive("franvaro-historik", "History of each absence."),
  TimePeriod: archive("tidperioder", "Reported and approved time periods per person."),
  WorkScheduleEvent: archive("arbetstidshistorik", "History of changes to working hours."),
  PayrollIntegration: archive("lonesystem", "Payroll settings and code maps (the password or key lives in the key register and is not exported)."),
  IntegrationRun: archive("lonekorningar", "Payroll and absence import and export runs.", { keep: ["contentHash"] }),

  // Egenkontroll (the .hwf file, selfInspectionForExport)
  SelfInspectionProgram: hwf("selfInspection.program"), SelfInspectionSection: hwf("selfInspection.program"), SelfInspectionRole: hwf("selfInspection.program"),
  SelfInspectionRoleMember: hwf("selfInspection.program"), SelfInspectionCompetence: hwf("selfInspection.program.people"), SelfInspectionVersion: hwf("selfInspection.versions"),
  SelfInspectionReadConfirmation: hwf("selfInspection.confirmations"), SelfInspectionReview: hwf("selfInspection.reviews"),
  SelfInspectionDeviation: hwf("selfInspection.deviations (includes incidents)"),
  SelfInspectionDeviationAttachment: archive("avvikelse-bilder", "Photos on deviations and incidents; the .hwf file keeps no bytes.", { files: true }),
  SelfInspectionAssignment: hwf("selfInspection.assignments"), TaskRiskClass: hwf("selfInspection.riskClasses"),
  SelfInspectionCustomerRequirement: hwf("on the customer"),
  SelfInspectionCredential: hwf("selfInspection.credentials (not for a person who left)"),
  SelfInspectionCredentialFile: archive("behorighetsfiler", "Certificate files of staff who are still members.", { files: true, where: (organizationId) => ({ organizationId, credential: { leftAt: null } }) }),
  SelfInspectionCompetenceCard: hwf("selfInspection.competenceCards"), SelfInspectionCompetenceGroup: hwf("selfInspection.competenceGroups"),
  SelfInspectionCompetenceGroupMember: hwf("selfInspection.competenceGroups"), SelfInspectionCompetenceCardVersion: hwf("selfInspection.cardVersions"),
  Instrument: hwf("selfInspection.instruments"),

  // Articles, prices and purchases
  CatalogueSupplier: hwf("catalogue"), CatalogueArticle: hwf("catalogue"), CataloguePrice: hwf("catalogue"), CataloguePriceConfirmation: hwf("catalogue"),
  CatalogueImport: hwf("catalogue (finished price imports)"), CatalogueImportProfile: hwf("catalogue"), WholesalePrice: hwf("catalogue"),
  WholesaleImportSeen: hwf("catalogue"), CatalogueFilePrice: hwf("catalogue"),
  CatalogueRebate: archive("rabattbrev", "Discount letters (not in the .hwf catalogue)."),
  CatalogueProduct: excluded("Derived: rebuilt from the articles when they are imported."),
  CatalogueFavorite: archive("favoriter", "Favourite articles per person."),
  CatalogueList: archive("artikellistor", "The company's article lists."),
  CatalogueListLine: archive("artikellistor-rader", "Lines of the article lists."),
  Purchase: archive("inkop", "Purchases (number, status, links to project, customer, job)."),
  PurchaseLine: archive("inkop-rader", "Purchase lines (article, quantity, price, supplier, delivery)."),
  ExternalProductCache: excluded(shared), SolarCategory: excluded(shared), WholesaleArticle: excluded(shared), WholesaleRegisterSync: excluded(shared),

  // Quotes, invoice bases and invoices (the sales zip file)
  Quote: sales("offerter"), QuoteLine: sales("offerter"), QuoteResponse: sales("offerter (the customer's answer)"),
  QuoteLink: excluded("The customer's link: a token and the visitor's ip address."),
  InvoiceBasis: sales("fakturaunderlag"), InvoiceBasisSource: archive("fakturaunderlag-kallor", "Which time and material rows each invoice basis took."),
  CustomerInvoice: sales("fakturor (the identity number masked)"),
  CustomerInvoiceEvent: archive("fakturor-historik", "The log of each invoice."),
  CustomerInvoiceSeries: archive("fakturor-nummerserie", "Invoice number series and payment terms."),
  CustomerInvoiceLink: excluded("The customer's link: a token and the visitor's ip address."),

  // Personalliggare
  StaffRegisterPerson: archive("personalliggare-personer", "Staff register persons; the identity number only masked (the sealed number and its hash never leave)."),
  StaffRegisterEvent: archive("personalliggare-handelser", "Check-ins and check-outs; the identity number only masked."),

  // Machines, maintenance, store, operator page
  MachineSource: archive("maskinkallor", "Machine sources (the key's hash is not exported)."),
  MachineEvent: archive("maskinhandelser", "Events and alarms from the machines."),
  MachineAlarmOrder: archive("maskinlarm-arbetsorder", "Alarms turned into work orders."),
  MachineSuggestion: archive("maskinforslag", "Suggestions from the analysis and their decisions."),
  MachineSignal: archive("maskinsignaler", "Signals per source, last value."),
  MachineFormatProfile: archive("maskinformat", "Format profiles for the sources."),
  MachineRawSample: excluded("Short-lived raw samples kept to set up a source; not business records."),
  MachineRawDedupe: excluded("Technical de-duplication state."),
  MachineSignalRule: archive("maskinregler", "Rules on signals."),
  MachineRuleState: archive("maskinregler-lage", "Current state of the rules.", { where: through("rule") }),
  MachineAlarmContact: archive("larmkontakter", "Who is called for which machine."),
  MachineDaySummary: archive("maskindagar", "Per-day summaries of events, stops and stopped minutes."),
  MachinePart: archive("maskiner", "The machine tree."),
  MaintenancePlace: archive("underhallsplatser", "The maintenance place tree."),
  MachinePartImage: archive("maskinbilder", "Pictures of machines, with the files.", { files: true }),
  MachinePartArticle: archive("maskindelar", "Articles tied to machines."),
  StoreLocation: archive("lager-platser", "Store locations."), StoreItem: archive("lager-artiklar", "Store articles."),
  StoreBalance: archive("lager-saldon", "Store balances."), StoreTransaction: archive("lager-rorelser", "Store movements."),
  MaintenanceItem: archive("underhall", "Maintenance jobs and faults (cause, stop and restore times)."),
  MaintenancePlan: archive("underhallsplaner", "Maintenance plans (intervals in time or run hours)."),
  OperatorSettings: archive("operator-installningar", "Operator page settings."),
  OperatorAccount: archive("operator-konton", "Operator accounts by name (the password hash is not exported)."),
  OperatorAccountMachine: archive("operator-konton-maskiner", "Which machines each operator account sees."),
  OperatorSession: excluded(secrets),
  OperatorFaultReport: archive("operator-felanmalningar", "Fault reports from the operator page."),
  OperatorFaultPhoto: archive("operator-bilder", "Photos on fault reports, with the files.", { files: true }),
  // Tavlor och skärmar (2026-11-18): the boards, their published versions, their own tables and their pictures are the company's own
  // content and go in the archive.
  Board: archive("tavlor", "Boards with their draft layout."),
  BoardVersion: archive("tavlor-versioner", "Published, locked versions of the boards and the choice of names per card."),
  BoardDataSource: archive("tavlor-tabeller", "The boards' own tables: name and columns."),
  BoardDataRow: archive("tavlor-tabellrader", "The rows of the boards' own tables."),
  BoardImage: archive("tavlor-bilder", "Pictures on the boards' image cards, with the files.", { files: true }),
  BoardPlaylist: archive("tavlor-spellistor", "Playlists of boards shown in turn."),
  Screen: archive("skarmar", "Connected screens: name, place, settings and when last seen (the network's hash is not exported)."),
  BoardAccess: excluded("The screen keys and shared links: hashes of secrets and codes; screens are made again by connecting, links by sharing."),
  ScreenPairing: excluded("Ten-minute pairing requests of screens, with hashes of their codes and secrets; never exported."),
};

/** A column that must not leave unless the entry keeps it. */
export const SECRET_COLUMN = /sealed|secret|token|password|hash|encrypt|wrappedkey|cipher|salt|apikey|privatekey/i;
