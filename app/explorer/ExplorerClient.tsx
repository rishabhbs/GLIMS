"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { StatusBadge, ClassificationBadge } from "../_components/StatusBadge";

type TaxCount = { key: string; label: string; count: number };
type Row = {
  id: string;
  entityType: string;
  title: string;
  claim: string;
  status: string;
  sourceClassification: string;
  confidence: number;
};

const STATUSES = ["candidate", "confirmed", "conflicted", "interpretation", "outdated", "archived", "invalidated"];

export function ExplorerClient({ taxonomy }: { taxonomy: TaxCount[] }) {
  const [type, setType] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"list" | "search">("list");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (type) params.set("type", type);
      if (status) params.append("status", status);
      const res = await fetch(`/api/items?${params.toString()}`);
      const data = await res.json();
      setMode(data.mode);
      setRows(data.results ?? []);
    } finally {
      setLoading(false);
    }
  }, [query, type, status]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <h1>Knowledge Explorer</h1>
      <p className="lead">Browse and search what the Brain knows. Searching uses hybrid (semantic + keyword) retrieval over items.</p>

      <div className="card">
        <input
          className="search"
          placeholder="Search knowledge…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="filters">
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All types</option>
            {taxonomy.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label} ({t.count})
              </option>
            ))}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h2>
        {mode === "search" ? "Search results" : "Items"} {loading ? "…" : `(${rows.length})`}
      </h2>
      <div className="card">
        {rows.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>Nothing yet. Add material under Knowledge, or adjust filters.</p>
        ) : (
          rows.map((r) => (
            <Link key={r.id} href={`/item/${r.id}`} className="row">
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 13, color: "var(--muted)" }}>{r.claim}</div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span className="badge">{r.entityType}</span>
                <ClassificationBadge classification={r.sourceClassification} />
                <StatusBadge status={r.status} />
              </div>
            </Link>
          ))
        )}
      </div>

      <style jsx>{`
        .search {
          width: 100%;
          background: var(--panel-2);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          padding: 10px 12px;
          font: inherit;
        }
        .filters { display: flex; gap: 10px; margin-top: 10px; }
        select {
          background: var(--panel-2);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text);
          padding: 8px 10px;
          font: inherit;
        }
        .row {
          display: flex;
          gap: 12px;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid var(--border);
        }
        .row:hover { background: var(--panel-2); }
      `}</style>
    </div>
  );
}
