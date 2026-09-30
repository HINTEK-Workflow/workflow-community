/**
 * The form builder's PDF in a new tab (2026-09-26): an ordinary form post with target="_blank", so the browser –
 * also on a phone – shows the PDF in its own viewer and the editor stays where it is. With `values` the PDF shows the
 * answers on screen in the builder's preview (2026-09-28); without them the server's example data. Nothing is stored.
 */
export function openFormPreviewPdf(input: { meta: unknown; document: unknown; values?: unknown; blank?: boolean; sample?: boolean }) {
  const form = window.document.createElement("form");
  form.method = "POST";
  form.action = "/api/forms/admin/preview";
  form.target = "_blank";
  const field = window.document.createElement("input");
  field.type = "hidden";
  field.name = "payload";
  field.value = JSON.stringify({ sample: true, ...input });
  form.append(field);
  window.document.body.append(form);
  form.submit();
  form.remove();
}
