"use client";
import { useEffect, useState } from "react";
import styles from "./email-verification.module.css";

interface Props {
  email: string;
  code: string;
  onCodeChange: (code: string) => void;
}

const RESEND_SECONDS = 30;
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

/**
 * "Send code" button and code box under the email field. The server binds the code to this
 * browser, so it must be entered here; registration is refused without it.
 */
export function EmailVerificationField({ email, code, onCodeChange }: Props) {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const normalised = email.trim().toLowerCase();
  const sentForThisEmail = sentTo !== null && sentTo === normalised;

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // A code belongs to one address: changing the email starts over.
  useEffect(() => {
    if (sentTo !== null && sentTo !== normalised) {
      setSentTo(null);
      setMessage(null);
      onCodeChange("");
    }
  }, [normalised, sentTo, onCodeChange]);

  async function sendCode() {
    if (!looksLikeEmail(normalised)) {
      setMessage({ kind: "error", text: "Enter your email address first." });
      return;
    }
    setSending(true);
    setMessage(null);
    try {
      const res = await fetch("/v1/auth/register/email-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: normalised }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ kind: "error", text: data?.error?.message ?? `Could not send the code (status ${res.status}). Please try again.` });
        return;
      }
      setSentTo(normalised);
      setCooldown(RESEND_SECONDS);
      setMessage({ kind: "ok", text: `We sent a 6-digit code to ${normalised}. It expires in 10 minutes.` });
    } catch {
      setMessage({ kind: "error", text: "We could not reach the server. Check your connection and try again." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={styles.box}>
      <div className={styles.row}>
        <button type="button" className={styles.send} onClick={sendCode} disabled={sending || cooldown > 0} data-testid="send-email-code">
          {sending ? "Sending…" : sentForThisEmail ? (cooldown > 0 ? `Resend code (${cooldown}s)` : "Resend code") : "Send verification code"}
        </button>
        <label className={styles.codeLabel}>
          <span>Email code *</span>
          <input
            className={styles.code}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6 digits"
            value={code}
            onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
            disabled={!sentForThisEmail}
            aria-label="Email verification code"
          />
        </label>
      </div>
      {message && (
        <p className={message.kind === "ok" ? styles.ok : styles.error} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
