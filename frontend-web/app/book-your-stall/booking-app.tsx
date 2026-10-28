"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, bookingApi, type MyBooking, type Snapshot } from "@/lib/booking/client-api";
import { serverOffsetMs, StatusPoller } from "@/lib/booking/client-poller";
import styles from "./booking.module.css";
import { ConfirmDialog } from "./components/confirm-dialog";
import { HoldPanel } from "./components/hold-panel";
import { StallLegend, StallMap, StallPatterns } from "./components/stall-map";
import { StallList } from "./components/stall-list";
import { formatIst, hasGeometry, stallLabel } from "./components/stall-status";

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      if (err instanceof ApiError && err.status === 401) return toLogin();
      setNotice({ kind: "error", text: err instanceof ApiError ? err.message : "Could not load your booking status." });
    }
  }, []);

  useEffect(() => {
    if (window.matchMedia("(max-width: 640px)").matches) setView("list");
    const poller = new StatusPoller<Snapshot>({
      fetchSnapshot: bookingApi.snapshot,
      onSnapshot: (s, receivedAt) => {
        setSnapshot(s);
        setOffsetMs(serverOffsetMs(s.serverNow, receivedAt));
      },
      onError: (err) => {
        if (err instanceof ApiError && err.status === 401) toLogin();
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

  const placeHold = () =>
    run(async () => {
      const result = await bookingApi.hold(selectedId!);
      return { kind: "ok", text: `Stall ${result.stallCode} is held for you. Confirm it before the timer runs out.` };
    });

  const confirmBooking = () =>
    run(async () => {
      const result = await bookingApi.confirm(hold!.holdId, hold!.token);
      setConfirmOpen(false);
      return { kind: "ok", text: `Booked! Stall ${result.stallCode}, reference ${result.bookingRef}.` };
    }).finally(() => setConfirmOpen(false));

  const releaseHold = () =>
    run(async () => {
      const result = await bookingApi.release(hold!.holdId);
      return { kind: "ok", text: result.status === "released" ? "Hold released." : "Your hold had already expired." };
    });

  const onExpired = useCallback(() => {
    setNotice({ kind: "warn", text: "Your hold expired and the stall has been released. You can select a stall again." });
    void loadMe();
    void pollerRef.current?.refresh();
  }, [loadMe]);

  const signOut = async () => {
    await bookingApi.logout().catch(() => null);
    window.location.assign("/login");
  };

  const blocked = me ? eligibilityText(me) : null;
  const canHold = Boolean(me?.eligibility.canHold && !me.reservation && selected?.status === "available");

  return (
    <div className={styles.page}>
      <StallPatterns />
      <div className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>Book your stall</h1>
          <p className={styles.subtitle}>
            {me ? `${me.team.name} · ${me.team.track === "senior" ? "Senior" : "Junior"} track · ` : ""}
            Signed in as {displayName}
          </p>
        </div>
        <button className="btn" type="button" onClick={signOut}>
          Sign out
        </button>
      </div>

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
        <p className="muted">Loading the venue…</p>
      ) : snapshot.zones.length === 0 ? (
        <div className="notice notice-warn">The stall layout has not been published yet. Please check back later.</div>
      ) : (
        <>
          <div className={styles.toolbar}>
            <div className={styles.tabs} role="tablist" aria-label="Venue areas">
              {snapshot.zones.map((z) => (
                <button
                  key={z.code}
                  type="button"
                  role="tab"
                  className={styles.tab}
                  aria-selected={z.code === zoneCode}
                  onClick={() => setZoneCode(z.code)}
                >
                  {z.name}
                </button>
              ))}
            </div>
            {zoneHasMap && (
              <div className={styles.tabs} aria-label="View">
                <button type="button" className={styles.tab} aria-pressed={view === "map"} aria-selected={view === "map"} onClick={() => setView("map")}>
                  Map
                </button>
                <button type="button" className={styles.tab} aria-pressed={view === "list"} aria-selected={view === "list"} onClick={() => setView("list")}>
                  List
                </button>
              </div>
            )}
          </div>

          <div className={styles.layout}>
            <div style={{ display: "grid", gap: 12 }}>
              {zone && zoneHasMap && view === "map" ? (
                <div className={styles.mapWrap}>
                  <StallMap zone={zone} stalls={zoneStalls} selectedId={selectedId} onSelect={selectStall} />
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
              <StallLegend />
              {zone && zone.landmarks.length > 0 && (
                <details>
                  <summary className="small">Landmarks in {zone.name}</summary>
                  <ul className={styles.landmarks}>
                    {zone.landmarks.map((l) => (
                      <li key={l.label}>{l.label}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>

            <aside className={styles.aside} ref={asideRef}>
              {booking ? (
                <section className={styles.panel} data-testid="booking-panel">
                  <h2 className={styles.panelTitle}>Your stall is booked</h2>
                  <p style={{ margin: 0 }}>
                    Stall <strong>{booking.stallCode}</strong>
                  </p>
                  <p style={{ margin: 0 }}>
                    Reference <span className={styles.ref}>{booking.bookingRef}</span>
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
                      <p style={{ margin: 0 }}>
                        Status: <strong>{stallLabel(selected)}</strong>
                      </p>
                      <button className="btn btn-primary" type="button" onClick={placeHold} disabled={busy || !canHold}>
                        {busy ? "Holding…" : "Hold this stall for 5 minutes"}
                      </button>
                      <p className="muted small" style={{ margin: 0 }}>
                        A hold reserves the stall for five minutes while you confirm. Only one hold per team.
                      </p>
                    </>
                  ) : (
                    <p className="muted small" style={{ margin: 0 }}>
                      Choose an available stall on the map or in the list.
                    </p>
                  )}
                </section>
              )}
            </aside>
          </div>
        </>
      )}

      {confirmOpen && hold && (
        <ConfirmDialog stallCode={hold.stallCode} busy={busy} onConfirm={confirmBooking} onCancel={() => setConfirmOpen(false)} />
      )}
    </div>
  );
}
