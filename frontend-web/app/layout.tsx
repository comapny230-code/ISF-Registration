import type { Metadata, Viewport } from "next";
import Link from "next/link";
import Image from "next/image";
import "./globals.css";
import { OrganizerLogos } from "./organizer-logos";

export const metadata: Metadata = {
  title: "ISF · Startup Jathara @ Dandakaranya",
  description: "ISF – Startup Jathara @ Dandakaranya, 18–20 December 2026, GIET University, Gunupur, Odisha.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
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
              <Link
                href="/"
                className="nav-btn-home"
                aria-label="Home"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
                <span>Home</span>
              </Link>
              <Link
                href="/book-your-stall"
                className="nav-btn-home"
                style={{ borderColor: "var(--color-forest)", color: "var(--color-forest)" }}
                aria-label="Book Your Stall"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                  <line x1="8" y1="21" x2="16" y2="21"/>
                  <line x1="12" y1="17" x2="12" y2="21"/>
                </svg>
                <span>Book Stall</span>
              </Link>
              <Link
                href="/register"
                className="nav-btn-register"
                aria-label="Register"
              >
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
