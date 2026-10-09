"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/ask", label: "Ask" },
  { href: "/studio", label: "Studio" },
  { href: "/training", label: "Training" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/explorer", label: "Explorer" },
  { href: "/history", label: "History" },
  { href: "/admin", label: "Admin" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {nav.map((n) => {
        const active = pathname === n.href || pathname.startsWith(n.href + "/");
        return (
          <Link key={n.href} href={n.href} className={`nav-link ${active ? "active" : ""}`}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
