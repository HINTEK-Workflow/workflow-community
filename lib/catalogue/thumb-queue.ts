/**
 * Miniatyrernas kö (2026-10-18: "inget sparas på servern, API:et hämtar bild vid behov"): the Solar hits of a search ask
 * for their picture link when they come into view – one question per article, at most `parallel` at a time and at most
 * `perSearch` per search, no retry. A miss or an error is an empty answer (the space stays quiet). Pure, so it is tested
 * with an invented fetcher; nothing here calls Solar.
 */
export class ThumbQueue<T = string> {
  private on = false;
  enable(on: boolean) { this.on = on; }
  private asked = new Set<string>();
  private queue: { id: string; key: string; attempt: number }[] = [];
  private active = 0;
  private count = 0;
  private generation = 0;
  constructor(private ask: (key: string) => Promise<T | "">, private done: (id: string, picture: T | "") => void, private parallel = 4, private perSearch = 20, private retries = 0, private retryDelayMs = 1500) {}

  /** A new search: what was waiting is dropped and the counting starts over. */
  reset() { this.asked = new Set(); this.queue = []; this.count = 0; this.generation += 1; }

  /** The hit came into view; false when nothing is asked (off, already asked, over the limit). */
  want(id: string, key: string): boolean {
    if (!this.on || !key || this.asked.has(id) || this.count >= this.perSearch) return false;
    this.asked.add(id);
    this.count += 1;
    this.queue.push({ id, key, attempt: 0 });
    this.pump();
    return true;
  }

  private pump() {
    while (this.active < this.parallel && this.queue.length) {
      const next = this.queue.shift()!;
      this.active += 1;
      const generation = this.generation;
      this.ask(next.key).catch((): T | "" => "").then((url) => {
        // A miss or an error (Solar was slow, the server answered a flood with "not found") is asked once more a moment later.
        if (!url && next.attempt < this.retries && generation === this.generation) { window.setTimeout(() => { if (generation === this.generation) { this.queue.push({ ...next, attempt: next.attempt + 1 }); this.pump(); } }, this.retryDelayMs); return; }
        this.done(next.id, url);
      }).finally(() => { this.active -= 1; this.pump(); });
    }
  }
}
