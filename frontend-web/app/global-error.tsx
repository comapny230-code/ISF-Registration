"use client";
import Link from "next/link";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "sans-serif", background: "#f7f9fa", color: "#1b2a26", margin: 0, padding: "40px 20px" }}>
        <div style={{ maxWidth: 540, margin: "60px auto", padding: 32, background: "#fff", borderRadius: 16, boxShadow: "0 4px 20px rgba(0,0,0,0.06)", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.8rem", marginBottom: 12 }}>Application Error</h1>
          <p style={{ color: "#5a6864", marginBottom: 24 }}>
            {error?.message || "An unexpected error occurred. Please refresh or try again."}
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button
              onClick={() => reset()}
              style={{ padding: "10px 20px", background: "#e87042", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: "bold" }}
            >
              Try Again
            </button>
            <a
              href="/"
              style={{ padding: "10px 20px", background: "#eef3f0", color: "#143e30", textDecoration: "none", borderRadius: 8, fontWeight: "bold" }}
            >
              Go to Home
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
