export function isLegalDocumentRequired(
  type: "TERMS" | "PRIVACY" | "DPA" | "CREDIT_TERMS",
  storageMode: "LOCAL" | "HINTEK_CLOUD",
) {
  return (
    type === "TERMS" ||
    type === "PRIVACY" ||
    (type === "DPA" && storageMode === "HINTEK_CLOUD")
  );
}
