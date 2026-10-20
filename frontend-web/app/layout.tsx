import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { OrganizerLogos } from "./organizer-logos";

export const metadata: Metadata = {
  title: "ISF · Startup Jathara @ Dandakaranya",
  description: "ISF – Startup Jathara @ Dandakaranya, 18–20 December 2026, GIET University, Gunupur, Odisha.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <header className="site-header">
          <div className="header-container">
            <div className="header-left">
              <Link href="/" className="brand-logo-group" aria-label="ISF Startup Jathara 2026">
                <div className="brand-logo-box">
                  <Image
                    src="/logos/isf-logo.webp"
                    alt="International Startup Foundation (ISF) Logo"
                    width={36}
                    height={36}
                    className="brand-logo-img"
                    priority
                  />
                </div>
                <div className="brand-text-col">
                  <span className="brand-title">ISF STARTUP JATHARA</span>
                  <span className="brand-sub">Dandakaranya 2026</span>
                </div>
              </Link>
            </div>

            <div className="header-right">
              <Link href="/register" className="nav-btn-register">
                <span>Register</span>
                <span className="btn-arrow">→</span>
              </Link>
            </div>
          </div>
        </header>

        <main className="main-content-wrap">{children}</main>

        <footer className="site-footer">
          <div className="footer-container">
            <OrganizerLogos layout="cards" title="Presented & Organised by" />
            <div className="footer-links">
              GIET University, Gunupur, Odisha · International Startup Foundation (ISF) · IncubateX Innovation
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
