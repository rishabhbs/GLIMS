const STATUS_CLASS: Record<string, string> = {
  confirmed: "ok",
  candidate: "warn",
  conflicted: "danger",
  outdated: "warn",
  interpretation: "warn",
  archived: "",
  invalidated: "danger",
  unknown: "",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_CLASS[status] ?? ""}`}>{status}</span>;
}

export function ClassificationBadge({ classification }: { classification: string }) {
  const label =
    classification === "human" ? "human" : classification === "inferred" ? "inferred" : "extracted";
  return <span className="badge">{label}</span>;
}
