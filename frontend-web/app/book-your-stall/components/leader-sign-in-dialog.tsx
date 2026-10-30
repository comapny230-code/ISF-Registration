"use client";
import { useEffect, useRef, useState } from "react";
import styles from "../booking.module.css";

interface Props {
  selectedStallCode?: string | null;
  onSuccess: (info: { displayName: string; email: string }) => void;
  onClose: () => void;
}

async function post(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: data as Record<string, any> };
}

function errorText(data: Record<string, any>, fallback: string): string {
  const err = data?.error;
  if (!err) return fallback;
  return err.requestId ? `${err.message} (Ref: ${err.requestId})` : err.message;
}

export function LeaderSignInDialog({ selectedStallCode, onSuccess, onClose }: Props) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (step === "code") {
      codeInputRef.current?.focus();
    }
  }, [step]);

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setError(null);
    const res = await post("/v1/auth/otp/request", { email: email.trim(), audience: "leader" });
    setBusy(false);
    if (!res.ok) {
      return setError(errorText(res.data, "Could not send a sign-in code. Please verify your email and try again."));
    }
    setInfo(res.data.message || "A 6-digit sign-in code has been sent to your email.");
    setCode("");
    setStep("code");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setBusy(true);
    setError(null);
    const res = await post("/v1/auth/otp/verify", { email: email.trim(), audience: "leader", code });
    setBusy(false);
    if (!res.ok) {
      return setError(errorText(res.data, "That code is invalid or has expired. Please try again."));
    }
    const displayName = res.data.principal?.displayName || "Team Leader";
    onSuccess({ displayName, email: email.trim() });
  }

  return (
    <div className={styles.dialogBackdrop} role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        className={styles.dialog}
        style={{ maxWidth: 440, width: "100%", margin: "16px" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h2 id="dialog-title" className={styles.panelTitle} style={{ margin: 0, fontSize: "1.4rem" }}>
              Team Leader Sign In
            </h2>
            {selectedStallCode && (
              <p style={{ margin: "4px 0 0", fontSize: "0.9rem", color: "var(--color-gold-deep)", fontWeight: 600 }}>
                Booking Stall {selectedStallCode}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              background: "transparent",
              border: "none",
              fontSize: "1.5rem",
              lineHeight: 1,
              cursor: "pointer",
              color: "#6b7280",
              padding: "4px 8px",
            }}
          >
            ×
          </button>
        </div>

        <p className="muted small" style={{ margin: "0 0 16px" }}>
          Only the registered team leader can book stalls. Enter your registration email to receive a secure one-time code.
        </p>

        {error && (
          <div className="notice notice-error small" role="alert" style={{ marginBottom: 14 }}>
            {error}
          </div>
        )}

        {step === "email" ? (
          <form onSubmit={requestCode} style={{ display: "grid", gap: 14 }}>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Registered Email Address</span>
              <input
                type="email"
                autoComplete="email"
                autoFocus
                required
                placeholder="leader@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: "1rem",
                }}
              />
            </label>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 4 }}>
              <button className="btn" type="button" onClick={onClose} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
                {busy ? "Sending Code…" : "Send One-Time Code"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={verifyCode} style={{ display: "grid", gap: 14 }}>
            {info && (
              <div className="notice notice-ok small" style={{ margin: 0 }}>
                {info}
              </div>
            )}
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontWeight: 600, fontSize: "0.9rem" }}>Enter 6-Digit OTP</span>
              <span className="hint" style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                Sent to <strong>{email}</strong>. Check spam if not received within 1 minute.
              </span>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                placeholder="123456"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid #d1d5db",
                  fontSize: "1.25rem",
                  letterSpacing: "0.25em",
                  textAlign: "center",
                  fontWeight: 700,
                }}
              />
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => requestCode()}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--color-forest)",
                    textDecoration: "underline",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Resend code
                </button>
                <span style={{ color: "#9ca3af" }}>•</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setError(null);
                    setStep("email");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--color-forest)",
                    textDecoration: "underline",
                    fontSize: "0.85rem",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  Change email
                </button>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn" type="button" onClick={onClose} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>
                  {busy ? "Verifying…" : "Verify & Book"}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
