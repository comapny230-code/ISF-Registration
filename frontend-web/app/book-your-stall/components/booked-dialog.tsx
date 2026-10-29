"use client";
import { useEffect, useRef } from "react";
import { ARRANGEMENTS_CONTACT } from "@/lib/booking/contact";
import styles from "../booking.module.css";

interface Props {
  stallCode: string;
  bookingRef: string;
  downloading: boolean;
  onDownload: () => void;
  onClose: () => void;
}

/** Shown once, right after the server confirms a booking: the ticket and who to contact next. */
export function BookedDialog({ stallCode, bookingRef, downloading, onDownload, onClose }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const downloadRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    downloadRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`${styles.dialog} ${styles.bookedDialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booked-title"
        aria-describedby="booked-contact"
        data-testid="booked-dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") onClose();
          if (e.key === "Tab") {
            const first = downloadRef.current;
            const last = closeRef.current;
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
        <div className={styles.bookedCheck} aria-hidden="true">
          ✓
        </div>
        <h2 id="booked-title" className={styles.bookedTitle}>
          Stall {stallCode} is booked
        </h2>
        <p style={{ margin: 0 }}>
          Booking reference <span className={styles.ref}>{bookingRef}</span>
        </p>
        <div className={styles.contactCard} id="booked-contact">
          <p style={{ margin: 0 }}>
            Please contact <strong>{ARRANGEMENTS_CONTACT.name}</strong> for arrangements.
          </p>
          <p style={{ margin: 0 }}>
            <strong>Contact number: </strong>
            <a href={`tel:+91${ARRANGEMENTS_CONTACT.phone}`} className={styles.phone}>
              {ARRANGEMENTS_CONTACT.phone}
            </a>
          </p>
        </div>
        <div className={styles.dialogActions}>
          <button ref={downloadRef} className="btn btn-primary" type="button" onClick={onDownload} disabled={downloading}>
            {downloading ? "Preparing ticket…" : "Download ticket (PDF)"}
          </button>
          <button ref={closeRef} className="btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
