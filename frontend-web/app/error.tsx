"use client";
import { useEffect } from "react";
import Link from "next/link";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App Error Boundary caught:", error);
  }, [error]);

  return (
    <div className="container" style={{ maxWidth: 600, padding: "64px 20px", textAlign: "center" }}>
      <div className="card" style={{ padding: "40px 24px", display: "grid", gap: 16 }}>
        <div style={{ fontSize: "2.5rem" }}>⚠️</div>
        <h1 style={{ fontSize: "1.8rem", margin: 0, color: "var(--ink)" }}>Something went wrong</h1>
        <p className="muted" style={{ margin: "0 auto", maxWidth: 450 }}>
          An unexpected error occurred while loading this page. Please try again or return home.
          {error?.digest ? ` (Reference: ${error.digest})` : ""}
        </p>
        <div className="actions" style={{ justifyContent: "center", marginTop: 12 }}>
          <button className="btn btn-primary" onClick={() => reset()}>
            Try Again
          </button>
          <Link href="/" className="btn btn-secondary">
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
