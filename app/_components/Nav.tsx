"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const nav: { href: string; label: string; icon: ReactNode }[] = [
  { href: "/ask", label: "Ask", icon: <IconAsk /> },
  { href: "/studio", label: "Studio", icon: <IconStudio /> },
  { href: "/playground", label: "Play", icon: <IconPlayground /> },
  { href: "/saved", label: "Saved", icon: <IconSaved /> },
  { href: "/knowledge", label: "Know", icon: <IconKnowledge /> },
  { href: "/explorer", label: "Explore", icon: <IconExplorer /> },
  { href: "/history", label: "History", icon: <IconHistory /> },
  { href: "/admin", label: "Admin", icon: <IconAdmin /> },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="railnav">
      {nav.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link key={n.href} href={n.href} className={`rail-link ${active ? "active" : ""}`} title={n.label}>
            <span className="rail-icon">{n.icon}</span>
            <span className="rail-label">{n.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/* ── icons (inherit currentColor, 22px) ─────────────────────────────────── */
const S = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function IconAsk() {
  return (
    <svg {...S}><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 9 9 0 0 1-4-1L3 20l1-5a8.5 8.5 0 1 1 16-3.5Z" /></svg>
  );
}
function IconStudio() {
  return (
    <svg {...S}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 4v5" /></svg>
  );
}
function IconPlayground() {
  return (
    <svg {...S}><path d="M12 3v18M3 7l9 5 9-5" /><circle cx="12" cy="12" r="9" /></svg>
  );
}
function IconSaved() {
  return (
    <svg {...S}><path d="m12 17.3-6.2 3.7 1.6-7-5.4-4.7 7.1-.6L12 2l2.9 6.7 7.1.6-5.4 4.7 1.6 7z" /></svg>
  );
}
function IconKnowledge() {
  return (
    <svg {...S}><path d="M4 5a2 2 0 0 1 2-2h12v18H6a2 2 0 0 1-2-2V5Z" /><path d="M8 7h7M8 11h7" /></svg>
  );
}
function IconExplorer() {
  return (
    <svg {...S}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
  );
}
function IconHistory() {
  return (
    <svg {...S}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5M12 8v4l3 2" /></svg>
  );
}
function IconAdmin() {
  return (
    <svg {...S}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" transform="translate(0.5 0.5) scale(0.92)" /></svg>
  );
}
