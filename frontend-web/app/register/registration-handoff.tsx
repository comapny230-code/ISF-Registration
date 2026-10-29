"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./handoff.module.css";

interface Props {
  /** Where to go next, as returned by the server ("/book-your-stall" or the sign-in page). */
  next: string;
  /** True when the server started a session, so booking opens without a sign-in code. */
  signedIn: boolean;
  teamName: string;
}

/** Long enough to read (and save) the registration details first. */
export const HANDOFF_DELAY_MS = 30_000;

const buttonLabel = (signedIn: boolean) => (signedIn ? "Book your stall now" : "Sign in to book your stall");

/**
 * A reminder popup shown 30 seconds after registration. It never navigates on its own:
 * the button goes to stall booking, the ✕ (or Escape) closes it and stays on this page.
 */
export function RegistrationHandoff({ next, signedIn, teamName }: Props) {
  const [open, setOpen] = useState(false);
  // Plays the closing animation before the popup is removed.
  const [closing, setClosing] = useState(false);
  const goRef = useRef<HTMLAnchorElement>(null);
  const close = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) setOpen(false);
    else setClosing(true);
  };

  useEffect(() => {
    const id = setTimeout(() => setOpen(true), HANDOFF_DELAY_MS);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (open) goRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className={`${styles.backdrop} ${closing ? styles.closing : ""}`}
      onClick={(e) => e.target === e.currentTarget && close()}
      onAnimationEnd={(e) => {
        if (closing && e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-title"
        aria-describedby="handoff-text"
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <button type="button" className={styles.close} aria-label="Close" onClick={close}>
          ✕
        </button>
        <div className={styles.check} aria-hidden="true">
          ✓
        </div>
        <h2 id="handoff-title" className={styles.title}>
          Registration successful — Book your stall now
        </h2>
        <p id="handoff-text" className={styles.text}>
          {signedIn
            ? `${teamName} is registered and you're signed in. Choose your stall whenever you're ready.`
            : `${teamName} is registered. Sign in with the code we email you, then choose your stall.`}
        </p>
        <a ref={goRef} className={styles.go} href={next} data-testid="book-now">
          {buttonLabel(signedIn)}
        </a>
        <p className={styles.auto}>You can also book later from the button at the bottom of this page.</p>
      </div>
    </div>
  );
}

/** 0 = free, 1 = booked, 2 = yours: a tiny picture of the venue map. */
const MINI_MAP = [0, 1, 0, 0, 1, 0, 1, 0, 0, 2, 0, 1, 0, 0, 1, 0, 0, 0];

/** Always visible at the bottom of the registration details: the clear next step. */
export function BookStallSection({ next, signedIn }: Omit<Props, "teamName">) {
  return (
    <section className={styles.section} aria-labelledby="book-stall-heading" data-testid="book-stall-section">
      <div className={styles.sectionBody}>
        <span className={styles.stepChip}>Step 2 of 2</span>
        <h2 id="book-stall-heading" className={styles.sectionTitle}>
          Next step: book your stall
        </h2>
        <p className={styles.sectionText}>
          Your registration is complete. Pick your exhibition stall on the venue map and confirm it. Each team can book one stall,
          so choose the spot you want.
        </p>
        <a className={styles.sectionButton} href={next} data-testid="book-stall-button">
          {buttonLabel(signedIn)}
          <svg className={styles.buttonIcon} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </a>
      </div>
      <div className={styles.miniMap} aria-hidden="true">
        {MINI_MAP.map((kind, i) => (
          <span key={i} className={`${styles.miniStall} ${kind === 1 ? styles.miniBooked : kind === 2 ? styles.miniYours : ""}`} />
        ))}
        <span className={styles.miniCaption}>Your stall is waiting</span>
      </div>
    </section>
  );
}
