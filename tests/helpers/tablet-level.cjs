// Shared helper for the browser tests: the ordinary pages on a tablet.
// A tablet starts in its own app view since 2026-11-23 (appkänslan, produktägarens beslut; lib/workflow/detail-level.ts
// defaultDetailLevels). A test that checks the ordinary pages on a tablet says so with `tabletOrdinaryPages(context)`: on every
// page the context opens, whenever the shell puts a tablet in its app view (`data-form="tablet"`, also after a resize) it gets
// Lagom (visning 2, the tablet's default before 2026-11-23) for this visit – the same event the settings send
// (DETAIL_LEVEL_EVENT), so nothing is saved and no other test is touched. A person who has saved Lagom or Allt keeps it.
async function tabletOrdinaryPages(context) {
  await context.addInitScript(() => {
    const watch = () => {
      const root = document.documentElement;
      const decide = () => {
        if (root.dataset.shell === "ready" && root.dataset.form === "tablet") window.dispatchEvent(new CustomEvent("hintek:detail-level", { detail: { phone: 1, tablet: 2, desktop: 3 } }));
      };
      decide();
      new MutationObserver(decide).observe(root, { attributes: true, attributeFilter: ["data-shell", "data-form"] });
    };
    if (document.documentElement) watch(); else document.addEventListener("DOMContentLoaded", watch, { once: true });
  });
}

module.exports = { tabletOrdinaryPages };
