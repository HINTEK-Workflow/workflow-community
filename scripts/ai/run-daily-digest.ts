import "dotenv/config";
import { digestJobToken } from "../../lib/ai/daily-digest";
import { swedishDayKey } from "../../lib/swedish-time";

// Once each night (plan 2026-10-01, fas 4): asks the running app to write the day's digest for every company that has
// chosen it and had activity. The app does the work (its own checks, credits and provider); this job only knocks,
// with a key derived from the server's secret for today. Prints counts only.
async function main() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET saknas.");
  const base = process.env.DIGEST_APP_URL || `http://127.0.0.1:${process.env.PORT || 3000}`;
  const day = process.argv[2];
  const response = await fetch(`${base}/api/ai/digest`, {
    method: "POST",
    headers: { authorization: `Bearer ${digestJobToken(secret, swedishDayKey(new Date()))}`, "content-type": "application/json" },
    body: JSON.stringify(day ? { day } : {}),
  });
  if (!response.ok) throw new Error(`Dagsammanställningen svarade ${response.status}.`);
  console.log(JSON.stringify(await response.json()));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "DailyDigestJobError");
  process.exitCode = 1;
});
