"use client";
import { useState } from "react";

type Audience = "leader" | "admin";

interface Props {
  audience: Audience;
  title: string;
  intro: string;
  /** Where to send the user after signing in. */
  next: string;
  nextLabel: string;
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

export function SignInForm({ audience, title, intro, next, nextLabel }: Props) {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");

  async function requestCode(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post("/v1/auth/otp/request", { email, audience });
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data, "Could not send a code. Please try again."));
    setInfo(res.data.message);
    setCode("");
    setStep("code");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await post("/v1/auth/otp/verify", { email, audience, code });
    setBusy(false);
    if (!res.ok) return setError(errorText(res.data, "That code did not work. Please try again."));
    const name = res.data.principal?.displayName || "";
    setDisplayName(name);
    if (next) {
      window.location.assign(next);
      return;
    }
    setStep("done");
  }

  return (
    <section className="container" style={{ maxWidth: 480, padding: "48px 20px" }}>
      <div className="card" style={{ display: "grid", gap: 16 }}>
        <div>
          <h1 style={{ fontSize: "1.6rem", marginBottom: 6 }}>{title}</h1>
          <p className="muted small">{intro}</p>
        </div>

        {error && (
          <div className="notice notice-error small" role="alert">
            {error}
          </div>
        )}

        {step === "email" && (
          <form onSubmit={requestCode} style={{ display: "grid", gap: 14 }}>
            <label>
              Email address
              <span className="hint">Use the email address you registered with.</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn btn-primary" type="submit" disabled={busy || !email.trim()}>
                {busy ? "Sending…" : "Send sign-in code"}
              </button>
            </div>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verifyCode} style={{ display: "grid", gap: 14 }}>
            {info && <div className="notice notice-ok small">{info}</div>}
            <label>
              6-digit code
              <span className="hint">The code expires in 10 minutes. Check your spam folder if it has not arrived.</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </label>
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn btn-primary" type="submit" disabled={busy || code.length !== 6}>
                {busy ? "Checking…" : "Sign in"}
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => requestCode()}>
                Send a new code
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => setStep("email")}>
                Use another email
              </button>
            </div>
          </form>
        )}

        {step === "done" && (
          <div style={{ display: "grid", gap: 14 }}>
            <div className="notice notice-ok">You are signed in{displayName ? ` as ${displayName}` : ""}.</div>
            <div className="actions" style={{ marginTop: 0 }}>
              <a className="btn btn-primary" href={next}>
                {nextLabel}
              </a>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
