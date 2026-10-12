import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Spectral, Hanken_Grotesk } from "next/font/google";
import { Nav } from "./_components/Nav";
import "./globals.css";

const spectral = Spectral({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-spectral",
  display: "swap",
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hanken",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LIMS Brain",
  description: "Persistent, evolving product knowledge system for Sampleify.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${spectral.variable} ${hanken.variable}`}>
      <body>
        <div className="app-shell">
          <aside className="sidebar">
            <div className="brand-mark" title="LIMS Brain">LB</div>
            <Nav />
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
