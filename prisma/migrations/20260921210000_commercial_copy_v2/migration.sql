UPDATE "SystemSettings"
SET commercial = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          COALESCE(commercial, '{}'::jsonb),
          '{localStorage,name}',
          to_jsonb('HINTEK Workflow Local'::text),
          true
        ),
        '{localStorage,description}',
        to_jsonb('Alla grundfunktioner, rapporter och PDF, utskrifter och export samt lokal datalagring.'::text),
        true
      ),
      '{cloudStorage,description}',
      to_jsonb('Molnlagring, automatisk backup, synkronisering och åtkomst från flera enheter.'::text),
      true
    ),
    '{aiUsage,billingLabel}',
    to_jsonb('AI används med förbetalda krediter'::text),
    true
  ),
  '{aiUsage,description}',
  to_jsonb('AI-assistent, AI-analyser, dokumentanalys, AI-agenter och framtida AI-funktioner.'::text),
  true
)
WHERE id = 'global';
