import type { QuoteStatus } from "@/lib/quotes/model";

/** A quote's status as an indicator colour (features/workflow/indicator-tone.ts): the list, the quote page and level 1. */
export const quoteStatusTone = (status: QuoteStatus) => status === "ACCEPTED" ? "success" as const : status === "DECLINED" ? "danger" as const : status === "DRAFT" ? "warning" as const : status === "SENT" ? "info" as const : "neutral" as const;
