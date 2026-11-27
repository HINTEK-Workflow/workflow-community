/**
 * Link previews and search robots are not visits (2026-11-04): sharing a link in a chat makes the chat service fetch
 * the page. The User-Agent is looked at for this one question and never stored.
 */
const AUTOMATED = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|telegram|slack|discord|skype|curl|wget|python-requests|headless|lighthouse|monitor|uptime/i;
export const isAutomatedVisitor = (userAgent: string | null | undefined) => !userAgent || AUTOMATED.test(userAgent);
