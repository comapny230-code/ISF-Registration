"use client";
import { useEffect, useRef, useState } from "react";
import { formatCountdown, remainingMs } from "@/lib/booking/client-poller";
import styles from "../booking.module.css";

interface Props {
  stallCode: string;
  /** The reservation's server expiry; the dialog closes when the reservation ends. */
  expiresAt: string;
  offsetMs: number;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation: focus starts on Confirm, Tab stays inside, Escape cancels. */
export function ConfirmDialog({ stallCode, expiresAt, offsetMs, busy, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [left, setLeft] = useState(() => remainingMs(expiresAt, offsetMs));

  useEffect(() => {
    const id = setInterval(() => setLeft(remainingMs(expiresAt, offsetMs)), 250);
    return () => clearInterval(id);
  }, [expiresAt, offsetMs]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.();
  }, []);

  // The dialog can open while the hold request is still finishing (buttons disabled), and a
  // disabled button cannot take focus, so move focus to Confirm once it is enabled.
  const focused = useRef(false);
  useEffect(() => {
    if (!busy && !focused.current) {
      confirmRef.current?.focus();
      focused.current = true;
    }
  }, [busy]);

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-description"
        onKeyDown={(e) => {
          if (e.key === "Escape" && !busy) onCancel();
          if (e.key === "Tab") {
            const first = confirmRef.current;
            const last = cancelRef.current;
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last?.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <h2 id="confirm-title" className={styles.panelTitle}>
          Book stall {stallCode}?
        </h2>
        <p id="confirm-description" style={{ margin: 0 }}>
          This stall is reserved for you for <strong className={styles.dialogTime}>{formatCountdown(left)}</strong>. Confirm now to make it yours.
        </p>
        <p className="muted small" style={{ margin: 0 }}>
          Your team can book one stall. After confirming you cannot change it yourself; only the organisers can cancel a booking. If
          you choose Not now, the stall stays reserved until the time runs out.
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button ref={confirmRef} className="btn btn-primary" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Confirming…" : "Confirm booking"}
          </button>
          <button ref={cancelRef} className="btn" type="button" onClick={onCancel} disabled={busy}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
