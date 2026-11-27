// PLC-simulatorn: everything bound for the log, a file, a toast or an error text passes through here, so the source's key can
// never be shown. The key form is matched as well as the exact key, because a server text or a pasted body may hold another one.
const KEY_LIKE = /hwf_mch_[A-Za-z0-9_-]+/g;
export const MASKED_KEY = "hwf_mch_••••";
export const MASKED_VALUE = "••••••••••";

export function maskText(text: string, key?: string | null) {
  const exact = key ? text.split(key).join(MASKED_KEY) : text;
  return exact.replace(KEY_LIKE, MASKED_KEY);
}

/** A custom raw body or a settings file that holds something shaped like a key is refused, not cleaned: it should not exist at all. */
export const holdsKeyForm = (text: string) => /hwf_mch_[A-Za-z0-9_-]{8,}/.test(text);
