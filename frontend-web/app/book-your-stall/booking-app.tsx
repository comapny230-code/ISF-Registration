"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, bookingApi, type MyBooking, type Snapshot } from "@/lib/booking/client-api";
import { serverOffsetMs, StatusPoller } from "@/lib/booking/client-poller";
import styles from "./booking.module.css";
import { ARRANGEMENTS_CONTACT } from "@/lib/booking/contact";
import { BookedDialog } from "./components/booked-dialog";
import { ConfirmDialog } from "./components/confirm-dialog";
import { HoldPanel } from "./components/hold-panel";
import { LeaderSignInDialog } from "./components/leader-sign-in-dialog";
import { StallLegend, StallMap, StallPatterns, ZOOM_LEVELS } from "./components/stall-map";
import { StallList } from "./components/stall-list";
import { formatIst, hasGeometry, stallLabel, stallMark } from "./components/stall-status";

type Notice = { kind: "ok" | "error" | "warn"; text: string } | null;

const LOGIN = "/login?next=/book-your-stall";

function eligibilityText(me: MyBooking): string | null {
  switch (me.eligibility.reason) {
    case "BOOKING_SUSPENDED":
      return "Stall booking is currently paused.";
    case "BOOKING_NOT_OPEN":
      return `Stall booking opens on ${formatIst(me.bookingWindow.opensAt)}.`;
    case "BOOKING_CLOSED":
      return "Stall booking has closed.";
    case "TRACK_NOT_ELIGIBLE":
      return "Stall booking is not open to your registration track.";
    case "PENDING_APPROVAL":
      return "Your team is awaiting approval by the organisers. You can view the map in the meantime.";
    case "TEAM_REJECTED":
      return "Your team is not eligible to book a stall. Please contact the organisers.";
    default:
      return null;
  }
}

export function BookingApp({ displayName }: { displayName: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [offsetMs, setOffsetMs] = useState(0);
  const [me, setMe] = useState<MyBooking | null>(null);
  const [zoneCode, setZoneCode] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "list">("map");
  const [zoomIndex, setZoomIndex] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Set only from a successful confirmation response, so failures never show it.
  const [justBooked, setJustBooked] = useState<{ stallCode: string; bookingRef: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [currentDisplayName, setCurrentDisplayName] = useState(displayName);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pollerRef = useRef<StatusPoller<Snapshot> | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);

  /** Selecting a stall on a phone brings its actions (above the list) into view. */
  const selectStall = useCallback((stallId: string) => {
    setSelectedId(stallId);
    if (window.matchMedia("(max-width: 900px)").matches) {
      asideRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, []);

  const toLogin = () => window.location.assign(LOGIN);

  const loadMe = useCallback(async () => {
    try {
      setMe(await bookingApi.me());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        return;
      }
      setNotice({ kind: "error", text: err instanceof ApiError ? err.message : "Could not load your booking status." });
    }
  }, []);

  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setView("list");
    const poller = new StatusPoller<Snapshot>({
      fetchSnapshot: bookingApi.snapshot,
      onSnapshot: (s, receivedAt) => {
        setSnapshot(s);
        setLoadError(null);
        setOffsetMs(serverOffsetMs(s.serverNow, receivedAt));
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 401) {
          setMe(null);
        } else {
          setLoadError("Unable to load the venue map. Please retry or check back shortly.");
        }
      },
    });
    pollerRef.current = poller;
    poller.start();
    void loadMe();

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        poller.start();
        void poller.refresh();
        void loadMe();
      } else {
        poller.stop();
      }
    };
    const onOnline = () => {
      void poller.refresh();
      void loadMe();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, [loadMe]);

  const hold = me?.reservation?.kind === "hold" ? me.reservation : null;
  const booking = me?.reservation?.kind === "booking" ? me.reservation : null;

  // Expiry changes status without any write, so poll right after the hold's expiry.
  useEffect(() => {
    if (hold) pollerRef.current?.refreshAt(Date.parse(hold.expiresAt) - offsetMs + 250);
  }, [hold, offsetMs]);

  // Open on the first area that has an approved map; otherwise the first area.
  useEffect(() => {
    if (zoneCode || !snapshot?.zones.length) return;
    const mapped = snapshot.zones.find((z) => snapshot.stalls.some((s) => s.zone === z.code && hasGeometry(s)));
    setZoneCode((mapped ?? snapshot.zones[0]).code);
  }, [snapshot, zoneCode]);

  const zone = snapshot?.zones.find((z) => z.code === zoneCode) ?? null;
  const zoneStalls = useMemo(() => (snapshot?.stalls ?? []).filter((s) => s.zone === zoneCode), [snapshot, zoneCode]);
  const zoneHasMap = zoneStalls.some(hasGeometry);
  const selected = snapshot?.stalls.find((s) => s.id === selectedId) ?? null;
  const freeByZone = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of snapshot?.stalls ?? []) if (s.status === "available") counts.set(s.zone, (counts.get(s.zone) ?? 0) + 1);
    return counts;
  }, [snapshot]);

  const refreshAll = async () => {
    await Promise.all([loadMe(), pollerRef.current?.refresh()]);
  };

  async function run(action: () => Promise<Notice>) {
    setBusy(true);
    setNotice(null);
    try {
      setNotice(await action());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      if (err instanceof ApiError && err.outcomeUnknown) {
        setNotice({
          kind: "warn",
          text: `We could not confirm whether that worked, so we refreshed your status below.${err.requestId ? ` (Ref: ${err.requestId})` : ""}`,
        });
      } else {
        setNotice({ kind: "error", text: err instanceof ApiError ? err.message : "Something went wrong. Please try again." });
      }
    } finally {
      // Always re-read the authoritative state after an action (spec §4.4).
      await refreshAll();
      setBusy(false);
    }
  }

  // "Book my stall" reserves the stall for the hold period at once (others see it on
  // hold) and asks the leader to confirm. Dismissing the question keeps the reservation
  // until it expires; confirming within that time makes the booking.
  const bookStall = () =>
    run(async () => {
      const result = await bookingApi.hold(selectedId!);
      setConfirmOpen(true);
      return { kind: "ok", text: `Stall ${result.stallCode} is reserved for you for 5 minutes. Confirm to make it yours.` };
    });

  const confirmBooking = () =>
    run(async () => {
      const result = await bookingApi.confirm(hold!.holdId, hold!.token);
      setConfirmOpen(false);
      setJustBooked({ stallCode: result.stallCode, bookingRef: result.bookingRef });
      return { kind: "ok", text: `Booked! Stall ${result.stallCode}, reference ${result.bookingRef}.` };
    }).finally(() => setConfirmOpen(false));

  const releaseHold = () =>
    run(async () => {
      const result = await bookingApi.release(hold!.holdId);
      return { kind: "ok", text: result.status === "released" ? "Stall released. You can choose another stall." : "Your reservation had already expired." };
    });

  const onExpired = useCallback(() => {
    setConfirmOpen(false);
    setNotice({ kind: "warn", text: "Your hold expired because the booking was not confirmed within 5 minutes. The stall is free again; you can choose a stall again." });
    void loadMe();
    void pollerRef.current?.refresh();
  }, [loadMe]);

  const downloadTicket = async () => {
    setDownloading(true);
    try {
      await bookingApi.downloadTicket();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setNotice({ kind: "error", text: err instanceof ApiError ? err.message : "Could not download the ticket. Please try again." });
    } finally {
      setDownloading(false);
    }
  };

  const signOut = async () => {
    await bookingApi.logout().catch(() => null);
    window.location.assign("/login");
  };

  const blocked = me ? eligibilityText(me) : null;
  const canHold = Boolean(me?.eligibility.canHold && !me.reservation && selected?.status === "available");

  // Where the team is in choose → book → confirm (4 = booked).
  const step = booking ? 4 : hold ? 3 : selected ? 2 : 1;
  const steps = ["Choose a stall", "Click Book my stall", "Confirm within 5 minutes"];

  return (
    <>
      <StallPatterns />
      <header className={styles.hero}>
        <div className={styles.heroInner}>
          {me ? (
            <>
              <div>
                <h1 className={styles.heroTitle}>Book your stall</h1>
                <p className={styles.heroTeam}>
                  <strong>{me.team.name}</strong>
                  <span className={styles.trackPill}>{me.team.track === "senior" ? "Senior track" : "Junior track"}</span>
                </p>
                <p className={styles.heroMeta}>
                  Signed in as {currentDisplayName || displayName || me.team.name}
                  {me?.bookingWindow.closesAt ? `. Booking closes ${formatIst(me.bookingWindow.closesAt)}.` : ""}
                </p>
              </div>
              <button className={styles.heroButton} type="button" onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <div>
                <h1 className={styles.heroTitle}>Select & Book Your Stall</h1>
                <p className={styles.heroMeta}>
                  Explore available stalls on the interactive venue map. Select an available stall and sign in as your registered Team Leader to secure your booking.
                </p>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setSignInOpen(true)}
                  className="btn btn-primary"
                  style={{ padding: "8px 16px", cursor: "pointer" }}
                >
                  Sign In as Leader
                </button>
                <a href="/register" className="btn btn-secondary" style={{ padding: "8px 16px", textDecoration: "none" }}>
                  Register Team
                </a>
              </div>
            </>
          )}
        </div>
        <ol className={styles.steps} aria-label="Booking steps">
          {steps.map((label, i) => {
            const n = i + 1;
            const state = n < step ? "done" : n === step ? "current" : "todo";
            return (
              <li key={label} className={styles.step} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                <span className={styles.stepDot} aria-hidden="true">
                  {state === "done" ? "✓" : n}
                </span>
                {label}
              </li>
            );
          })}
        </ol>
      </header>

      <div className={styles.page}>
        {notice && (
          <div
            className={`notice ${notice.kind === "ok" ? "notice-ok" : notice.kind === "warn" ? "notice-warn" : "notice-error"}`}
            role={notice.kind === "error" ? "alert" : "status"}
            data-testid="notice"
          >
            {notice.text}
          </div>
        )}
        {blocked && !me?.reservation && (
          <div className="notice notice-warn" role="status" data-testid="eligibility">
            {blocked}
          </div>
        )}

        {!snapshot ? (
          loadError ? (
            <div className="notice notice-warn" role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" }}>
              <span>{loadError}</span>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  setLoadError(null);
                  void pollerRef.current?.refresh();
                }}
              >
                Retry
              </button>
            </div>
          ) : (
            <p className="muted">Loading the venue…</p>
          )
        ) : snapshot.zones.length === 0 || snapshot.stalls.length === 0 ? (
          // Zones can exist before any stall is loaded (inventory awaiting organiser approval).
          <div className="notice notice-warn" data-testid="layout-pending">
            The stall layout has not been published yet. Please check back later.
          </div>
        ) : (
          <>
            <div className={styles.toolbar}>
              <div className={styles.areaTabs} role="tablist" aria-label="Venue areas">
                {snapshot.zones.map((z) => (
                  <button
                    key={z.code}
                    type="button"
                    role="tab"
                    className={styles.areaTab}
                    aria-selected={z.code === zoneCode}
                    onClick={() => setZoneCode(z.code)}
                  >
                    <span className={styles.areaName}>{z.name}</span>
                    <span className={styles.areaCount}>{freeByZone.get(z.code) ?? 0} free</span>
                  </button>
                ))}
              </div>
              {zoneHasMap && (
                <div className={styles.viewControls}>
                  {view === "map" && (
                    <div className={styles.segment} role="group" aria-label="Zoom">
                      <button type="button" aria-label="Zoom out" disabled={zoomIndex === 0} onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}>
                        −
                      </button>
                      <button
                        type="button"
                        aria-label="Zoom in"
                        disabled={zoomIndex === ZOOM_LEVELS.length - 1}
                        onClick={() => setZoomIndex((i) => Math.min(ZOOM_LEVELS.length - 1, i + 1))}
                      >
                        +
                      </button>
                    </div>
                  )}
                  <div className={styles.segment} role="group" aria-label="View">
                    <button type="button" aria-pressed={view === "map"} onClick={() => setView("map")}>
                      Map
                    </button>
                    <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
                      List
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.layout}>
              <div className={styles.stage}>
                {zone && zoneHasMap && view === "map" ? (
                  <div className={styles.mapWrap}>
                    <StallMap zone={zone} stalls={zoneStalls} selectedId={selectedId} onSelect={selectStall} zoom={ZOOM_LEVELS[zoomIndex]} />
                  </div>
                ) : (
                  <div className={styles.panel}>
                    {!zoneHasMap && (
                      <p className="muted small" style={{ margin: 0 }} data-testid="layout-pending">
                        The exact layout of this area is still awaiting organiser approval, so stalls are listed without a map.
                      </p>
                    )}
                    <StallList stalls={zoneStalls} selectedId={selectedId} onSelect={selectStall} caption={`Stalls in ${zone?.name ?? "this area"}`} />
                  </div>
                )}
                <div className={styles.mapFooter}>
                  <StallLegend />
                  {zone && zone.landmarks.length > 0 && (
                    <details className={styles.landmarkDetails}>
                      <summary>Landmarks in {zone.name}</summary>
                      <ul className={styles.landmarks}>
                        {zone.landmarks.map((l) => (
                          <li key={l.label}>{l.label}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              </div>

              <aside className={styles.aside} ref={asideRef}>
                {booking ? (
                  <section className={`${styles.panel} ${styles.ticket}`} data-testid="booking-panel">
                    <h2 className={styles.panelTitle}>Your stall is booked</h2>
                    <div className={styles.ticketStall}>
                      <span className={styles.ticketLabel}>Stall</span>
                      <strong>{booking.stallCode}</strong>
                    </div>
                    <div className={styles.ticketCut} aria-hidden="true" />
                    <p style={{ margin: 0 }}>
                      <span className={styles.ticketLabel}>Reference</span>
                      <br />
                      <span className={styles.ref}>{booking.bookingRef}</span>
                    </p>
                    <button className={`btn ${styles.ticketButton}`} type="button" onClick={downloadTicket} disabled={downloading}>
                      {downloading ? "Preparing ticket…" : "Download ticket (PDF)"}
                    </button>
                    <p className={styles.ticketContact}>
                      Please contact {ARRANGEMENTS_CONTACT.name} for arrangements.
                      <br />
                      Contact number:{" "}
                      <a href={`tel:+91${ARRANGEMENTS_CONTACT.phone}`} className={styles.ticketPhone}>
                        {ARRANGEMENTS_CONTACT.phone}
                      </a>
                    </p>
                    <p className="muted small" style={{ margin: 0 }}>
                      Keep this reference. To change or cancel a booking, contact the organisers.
                    </p>
                  </section>
                ) : hold ? (
                  <HoldPanel
                    hold={hold}
                    offsetMs={offsetMs}
                    busy={busy}
                    onConfirm={() => setConfirmOpen(true)}
                    onRelease={releaseHold}
                    onExpired={onExpired}
                  />
                ) : (
                  <section className={styles.panel} aria-labelledby="selection-title" data-testid="selection-panel">
                    <h2 id="selection-title" className={styles.panelTitle}>
                      {selected ? `Stall ${selected.code}` : "Select a stall"}
                    </h2>
                    {selected ? (
                      <>
                        <p className={styles.chip} data-status={selected.status}>
                          {stallMark(selected) && <span aria-hidden="true">{stallMark(selected)}</span>}
                          <span>
                            Status: <strong>{stallLabel(selected)}</strong>
                          </span>
                        </p>
                        <dl className={styles.facts}>
                          <div>
                            <dt>Area</dt>
                            <dd>{snapshot.zones.find((z) => z.code === selected.zone)?.name ?? selected.zone}</dd>
                          </div>
                          <div>
                            <dt>Size</dt>
                            <dd>
                              {selected.w} × {selected.d} ft
                            </dd>
                          </div>
                        </dl>
                        {me ? (
                          <button className={`btn btn-primary ${styles.bigButton}`} type="button" onClick={bookStall} disabled={busy || !canHold}>
                            {busy ? "Reserving…" : "Book my stall"}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setSignInOpen(true)}
                            className={`btn btn-primary ${styles.bigButton}`}
                          >
                            Sign in as Leader to Book Stall {selected.code}
                          </button>
                        )}
                        <p className="muted small" style={{ margin: 0 }}>
                          The stall is kept for you for 5 minutes while you confirm. Your team can book one stall.
                        </p>
                      </>
                    ) : (
                      <p className="muted small" style={{ margin: 0 }}>
                        Choose a white stall on the map or in the list.{" "}
                        {zone ? `${freeByZone.get(zone.code) ?? 0} stalls are free in ${zone.name}.` : ""}
                      </p>
                    )}
                  </section>
                )}
              </aside>
            </div>
          </>
        )}

        {justBooked && (
          <BookedDialog
            stallCode={justBooked.stallCode}
            bookingRef={justBooked.bookingRef}
            downloading={downloading}
            onDownload={downloadTicket}
            onClose={() => setJustBooked(null)}
          />
        )}

        {confirmOpen && hold && (
          <ConfirmDialog
            stallCode={hold.stallCode}
            expiresAt={hold.expiresAt}
            offsetMs={offsetMs}
            busy={busy}
            onConfirm={confirmBooking}
            onCancel={() => setConfirmOpen(false)}
          />
        )}

        {signInOpen && (
          <LeaderSignInDialog
            selectedStallCode={selected?.code}
            onSuccess={async ({ displayName: name }) => {
              setCurrentDisplayName(name);
              setSignInOpen(false);
              await Promise.all([loadMe(), pollerRef.current?.refresh()]);
              setNotice({
                kind: "ok",
                text: `Signed in successfully as ${name}! You can now reserve and book your stall.`,
              });
            }}
            onClose={() => setSignInOpen(false)}
          />
        )}
      </div>
    </>
  );
}
