-- The form editor (Daniel 2026-09-26, decision 2): basic details shown under Ny uppgift, versioned with every
-- publication. Additive with defaults: existing templates and published versions keep what they have, and adding a
-- column with a constant default does not fire the immutability trigger on "FormTemplateVersion".

ALTER TABLE "FormTemplate"
  ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "internalNote" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'file-spreadsheet',
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "allowStandalone" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowInProject" BOOLEAN NOT NULL DEFAULT true,
  ADD CONSTRAINT "FormTemplate_category_check" CHECK ("category" IN ('INSPECTION', 'SERVICE', 'SELF_CHECK', 'SAFETY', 'OTHER'));

ALTER TABLE "FormTemplateVersion"
  ADD COLUMN "displayName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "icon" TEXT NOT NULL DEFAULT 'file-spreadsheet',
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "allowStandalone" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowInProject" BOOLEAN NOT NULL DEFAULT true,
  -- A form must be usable somewhere; the editor and the API check this before publishing too.
  ADD CONSTRAINT "FormTemplateVersion_usage_check" CHECK ("allowStandalone" OR "allowInProject");
