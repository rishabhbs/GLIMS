"use client";

import { useEffect, useState, useCallback } from "react";
import { StatusBadge } from "../_components/StatusBadge";

type Job = {
  id: string;
  sourceTitle: string | null;
  sourceType: string;
  status: string;
  attempts: number;
  error: string | null;
  updatedAt: string;
};

type Tab = "text" | "note" | "url" | "file";

export function KnowledgeClient() {
  const [tab, setTab] = useState<Tab>("text");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    if (data.jobs) setJobs(data.jobs);
  }, []);

  useEffect(() => {
    loadJobs();
    const t = setInterval(loadJobs, 3000);
    return () => clearInterval(t);
  }, [loadJobs]);

  async function submitText(type: "text" | "note", title: string, text: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, title, text }),
      });
      const data = await res.json();
      setMsg(res.ok ? (data.duplicate ? "Already ingested (duplicate)." : "Queued for ingestion.") : `Error: ${data.error}`);
      loadJobs();
    } finally {
      setBusy(false);
    }
  }

  async function submitUrl(uri: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "url", uri, title: uri }),
      });
      const data = await res.json();
      setMsg(res.ok ? "URL queued for ingestion." : `Error: ${data.error}`);
      loadJobs();
    } finally {
      setBusy(false);
    }
  }

  async function submitFile(file: File, type: "pdf" | "image") {
    setBusy(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("type", type);
      form.set("title", file.name);
      const res = await fetch("/api/ingest", { method: "POST", body: form });
      const data = await res.json();
      setMsg(res.ok ? "File uploaded and queued." : `Error: ${data.error}`);
      loadJobs();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h1>Knowledge</h1>
      <p className="lead">Add material. Ingestion extracts atomic, typed knowledge with provenance.</p>

      <div className="card">
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {(["text", "note", "url", "file"] as Tab[]).map((t) => (
            <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
              {t === "file" ? "PDF / Image" : t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === "text" && <TextForm label="Document / text" onSubmit={(t, b) => submitText("text", t, b)} busy={busy} />}
        {tab === "note" && <TextForm label="Note" onSubmit={(t, b) => submitText("note", t, b)} busy={busy} />}
        {tab === "url" && <UrlForm onSubmit={submitUrl} busy={busy} />}
        {tab === "file" && <FileForm onSubmit={submitFile} busy={busy} />}

        {msg && <p style={{ color: "var(--muted)", marginTop: 10 }}>{msg}</p>}
      </div>

      <h2>Ingestion status</h2>
      <div className="card">
        {jobs.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>No ingestion jobs yet.</p>
        ) : (
          jobs.map((j) => (
            <div key={j.id} className="job-row">
              <div>
                <div>{j.sourceTitle ?? "(untitled)"}</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  {j.sourceType} · {new Date(j.updatedAt).toLocaleString()}
                  {j.error ? ` · ${j.error}` : ""}
                </div>
              </div>
              <StatusBadge status={j.status} />
            </div>
          ))
        )}
      </div>

      <style jsx>{`
        .tab {
          background: var(--panel-2);
          color: var(--muted);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 7px 12px;
          cursor: pointer;
        }
        .tab.active { color: var(--text); border-color: var(--accent); }
        .job-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 0;
          border-bottom: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}

function TextForm({ label, onSubmit, busy }: { label: string; onSubmit: (t: string, b: string) => void; busy: boolean }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input className="in" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="in" rows={6} placeholder={`${label} content…`} value={body} onChange={(e) => setBody(e.target.value)} />
      <button className="btn" disabled={busy || !body.trim()} onClick={() => onSubmit(title || "Untitled", body)}>
        {busy ? "Adding…" : "Add"}
      </button>
      <style jsx>{formStyles}</style>
    </div>
  );
}

function UrlForm({ onSubmit, busy }: { onSubmit: (u: string) => void; busy: boolean }) {
  const [url, setUrl] = useState("");
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input className="in" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <button className="btn" disabled={busy || !url.trim()} onClick={() => onSubmit(url)}>
        {busy ? "Fetching…" : "Add URL"}
      </button>
      <style jsx>{formStyles}</style>
    </div>
  );
}

function FileForm({ onSubmit, busy }: { onSubmit: (f: File, t: "pdf" | "image") => void; busy: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const type = file && file.type.startsWith("image/") ? "image" : "pdf";
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <input type="file" accept=".pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button className="btn" disabled={busy || !file} onClick={() => file && onSubmit(file, type)}>
        {busy ? "Uploading…" : `Upload ${type.toUpperCase()}`}
      </button>
      <style jsx>{formStyles}</style>
    </div>
  );
}

const formStyles = `
  .in {
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    padding: 9px 11px;
    font: inherit;
  }
  .btn {
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 8px;
    padding: 9px 16px;
    cursor: pointer;
    justify-self: start;
  }
  .btn:disabled { opacity: 0.5; cursor: default; }
`;
