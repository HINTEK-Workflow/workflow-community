/**
 * Torrkörning för de schemalagda jobben (T5, 2026-10-24): `npm run <jobb> -- --dry-run` shows what the job would delete or
 * send without doing it. An argument the job does not know stops it before anything runs, so a misspelt `--dryrun` never
 * becomes a real run.
 */
export const DRY_RUN_FLAG = "--dry-run";

/** The job's own arguments (after `tsx script.ts`): whether it is a dry run; anything else is refused. */
export function jobArguments(args: readonly string[], job: string): { dryRun: boolean } {
  const unknown = args.filter((arg) => arg !== DRY_RUN_FLAG);
  if (unknown.length) throw new Error(`${job}: okänt argument ${unknown.join(" ")} – bara ${DRY_RUN_FLAG} finns. Inget har körts.`);
  return { dryRun: args.includes(DRY_RUN_FLAG) };
}

/** The prefix of every line the job prints; a dry run says so on every line. */
export const jobPrefix = (job: string, dryRun: boolean) => dryRun ? `${job} (provkörning)` : job;
