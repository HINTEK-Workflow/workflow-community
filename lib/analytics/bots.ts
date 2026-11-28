/**
 * Link previews and search robots are not visits (2026-11-04): sharing a link in a chat makes the chat service fetch
 * the page. The User-Agent is looked at for this one question and never stored.
 */
const AUTOMATED = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|slack|discord|skype|curl|wget|python-requests|headless|lighthouse|monitor|uptime/i;
/**
 * The AI services' own robots (Growth Engine paket 2, 2026-11-28): some of them fetch a page for a person who asked the assistant
 * (ChatGPT-User, Claude-User, Perplexity-User, Meta-ExternalAgent) and have no "bot" in their name; none of them is a visit.
 */
export const AI_ROBOTS = ["gptbot", "oai-searchbot", "chatgpt-user", "claudebot", "claude-user", "claude-searchbot", "perplexitybot", "perplexity-user", "ccbot", "bytespider", "amazonbot", "meta-externalagent", "meta-externalfetcher"] as const;
const AI_ROBOT = new RegExp(AI_ROBOTS.map((name) => name.replace(/-/g, "\\-")).join("|"), "i");
export const isAutomatedVisitor = (userAgent: string | null | undefined) => !userAgent || AUTOMATED.test(userAgent) || AI_ROBOT.test(userAgent);
