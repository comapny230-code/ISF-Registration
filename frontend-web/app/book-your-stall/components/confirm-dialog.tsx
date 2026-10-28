"use client";
import { useEffect, useRef } from "react";
import styles from "../booking.module.css";

interface Props {
  stallCode: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation: focus starts on Confirm, Tab stays inside, Escape cancels. */
export function ConfirmDialog({ stallCode, busy, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

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
        <p id="confirm-description" className="muted small" style={{ margin: 0 }}>
          Your team can book one stall. After confirming you cannot change it yourself; only the organisers can cancel a booking.
        </p>
        <div className="actions" style={{ marginTop: 0 }}>
          <button ref={confirmRef} className="btn btn-primary" type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Confirming…" : "Confirm booking"}
          </button>
          <button ref={cancelRef} className="btn" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
