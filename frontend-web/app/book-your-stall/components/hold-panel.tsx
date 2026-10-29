"use client";
import { useEffect, useRef, useState } from "react";
import type { HoldReservation } from "@/lib/booking/client-api";
import { formatCountdown, remainingMs } from "@/lib/booking/client-poller";
import styles from "../booking.module.css";

interface Props {
  hold: HoldReservation;
  /** serverNow − local receive time; the countdown displays the server's expiry. */
  offsetMs: number;
  busy: boolean;
  onConfirm: () => void;
  onRelease: () => void;
  onExpired: () => void;
}

/** Length of a hold as stated in the booking copy; it only scales the progress bar. */
const HOLD_MS = 5 * 60_000;

/** The team's live hold with a countdown. The server decides expiry; this only displays it. */
export function HoldPanel({ hold, offsetMs, busy, onConfirm, onRelease, onExpired }: Props) {
  const [left, setLeft] = useState(() => remainingMs(hold.expiresAt, offsetMs));
  const expiredFired = useRef(false);

  useEffect(() => {
    expiredFired.current = false;
    const tick = () => {
      const ms = remainingMs(hold.expiresAt, offsetMs);
      setLeft(ms);
      if (ms === 0 && !expiredFired.current) {
        expiredFired.current = true;
        onExpired();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [hold.expiresAt, offsetMs, onExpired]);

  return (
    <section className={`${styles.panel} ${styles.holdPanel}`} aria-labelledby="hold-title" data-testid="hold-panel">
      <h2 id="hold-title" className={styles.panelTitle}>
        Stall {hold.stallCode} is reserved for you
      </h2>
      <div>
        <div className={`${styles.countdown} ${left < 60_000 ? styles.countdownLow : ""}`} data-testid="countdown" aria-hidden="true">
          {formatCountdown(left)}
        </div>
        <div className={styles.timeBar} aria-hidden="true">
          <span className={left < 60_000 ? styles.timeBarLow : undefined} style={{ width: `${Math.min(100, (left / HOLD_MS) * 100)}%` }} />
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Time left to confirm. If you don't confirm in time, the stall is released for other teams.
        </p>
        <span className={styles.srOnly} aria-live="polite">
          {left === 0 ? "Your hold has expired." : left < 60_000 ? "Less than one minute left to confirm." : ""}
        </span>
      </div>
      <div className="actions" style={{ marginTop: 0 }}>
        <button className="btn btn-primary" type="button" onClick={onConfirm} disabled={busy || left === 0}>
          Confirm booking
        </button>
        <button className="btn" type="button" onClick={onRelease} disabled={busy || left === 0}>
          Choose another stall
        </button>
      </div>
    </section>
  );
}
