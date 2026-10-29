"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, type AdminBooking, type AdminPermission, type AdminTeam, type AuditItem } from "@/lib/booking/admin-client";
import { ApiError, bookingApi, type SnapshotStall } from "@/lib/booking/client-api";
import styles from "../book-your-stall/booking.module.css";
import { formatIst } from "../book-your-stall/components/stall-status";

type Tab = "bookings" | "stalls" | "teams" | "audit";

const TABS: Array<{ id: Tab; label: string; needs: AdminPermission[] }> = [
  { id: "bookings", label: "Bookings", needs: ["reports.view", "booking.cancel"] },
  { id: "stalls", label: "Stalls", needs: ["inventory.manage"] },
  { id: "teams", label: "Teams", needs: ["teams.manage", "reports.view"] },
  { id: "audit", label: "Audit log", needs: ["reports.view"] },
];

interface Action {
  title: string;
  description: string;
  confirmLabel: string;
  allowForce?: boolean;
  run: (reason: string, force: boolean, requestId: string) => Promise<string>;
}

const errorText = (err: unknown) =>
  err instanceof ApiError ? `${err.message}${err.requestId && err.status >= 500 ? ` (Ref: ${err.requestId})` : ""}` : "Something went wrong.";

/**
 * Confirmation with a mandatory reason. The request id is fixed for the dialog,
 * so retries are idempotent. If the server asks for a fresh sign-in code
 * (step-up), it is collected here and the action is retried automatically.
 */
function ActionDialog({ action, adminEmail, onDone }: { action: Action; adminEmail: string; onDone: (message: string | null) => void }) {
  const requestId = useRef(crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState<"none" | "needed" | "sent">("none");
  const [code, setCode] = useState("");
  const first = useRef<HTMLTextAreaElement>(null);

  useEffect(() => first.current?.focus(), []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      onDone(await action.run(reason.trim(), force, requestId.current));
    } catch (err) {
      if (err instanceof ApiError && err.code === "REAUTH_REQUIRED") setReauth("needed");
      else setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.requestCode(adminEmail);
      setReauth("sent");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyAndRetry() {
    setBusy(true);
    setError(null);
    try {
      await adminApi.verifyCode(adminEmail, code);
      setReauth("none");
      setCode("");
    } catch (err) {
      setBusy(false);
      return setError(errorText(err));
    }
    await submit();
  }

  const reasonOk = reason.trim().length >= 10 && reason.trim().length <= 500;
  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && !busy && onDone(null)}>
      <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="action-title" onKeyDown={(e) => e.key === "Escape" && !busy && onDone(null)}>
        <h2 id="action-title" className={styles.panelTitle}>
          {action.title}
        </h2>
        <p className="muted small" style={{ margin: 0 }}>
          {action.description}
        </p>
        {error && (
          <div className="notice notice-error small" role="alert">
            {error}
          </div>
        )}
        {reauth === "none" ? (
          <>
            <label>
              Reason (recorded in the audit log)
              <textarea ref={first} rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
              <span className="hint">At least 10 characters.</span>
            </label>
            {action.allowForce && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 500 }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                Release a team&apos;s active hold if there is one
              </label>
            )}
            <div className="actions" style={{ marginTop: 0 }}>
              <button className="btn btn-primary" type="button" disabled={busy || !reasonOk} onClick={submit}>
                {busy ? "Working…" : action.confirmLabel}
              </button>
              <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <div style={{ display: "grid", gap: 10 }} data-testid="reauth">
            <div className="notice notice-warn small">For this action, confirm it is you with a new sign-in code.</div>
            {reauth === "needed" ? (
              <button className="btn btn-primary" type="button" disabled={busy} onClick={sendCode}>
                Send a code to {adminEmail}
              </button>
            ) : (
              <>
                <label>
                  6-digit code
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  />
                </label>
                <button className="btn btn-primary" type="button" disabled={busy || code.length !== 6} onClick={verifyAndRetry}>
                  Confirm and continue
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChangePasswordDialog({ onDone }: { onDone: (message: string | null) => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) return setError("New password must be at least 6 characters.");
    if (newPassword !== confirmPassword) return setError("New passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/v1/auth/admin/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || data?.error?.message || "Failed to update password.");
        setBusy(false);
        return;
      }
      onDone(data.message || "Password updated successfully.");
    } catch {
      setError("An unexpected network error occurred.");
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && !busy && onDone(null)}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <h2 className={styles.panelTitle}>Change Administrator Password</h2>
        {error && <div className="notice notice-error small">{error}</div>}
        <form onSubmit={submit} style={{ display: "grid", gap: 14, marginTop: 12 }}>
          <label>
            Current Password
            <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </label>
          <label>
            New Password (min 6 characters)
            <input type="password" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          <label>
            Confirm New Password
            <input type="password" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy || !currentPassword || newPassword.length < 6}>
              {busy ? "Saving…" : "Save Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function useList<T>(load: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null }>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const page = await load(null);
      setItems(page.items);
      setNext(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }, [load]);
  const more = async () => {
    if (!next) return;
    const page = await load(next);
    setItems((prev) => [...(prev ?? []), ...page.items]);
    setNext(page.nextCursor);
  };
  useEffect(() => {
    void reload();
  }, [reload]);
  return { items, next, error, reload, more };
}

const loadBookings = (cursor: string | null) => adminApi.bookings(cursor);
const loadAudit = (cursor: string | null) => adminApi.audit(cursor);

export function AdminApp({ displayName, adminEmail, permissions }: { displayName: string; adminEmail: string; permissions: AdminPermission[] }) {
  const tabs = TABS.filter((t) => t.needs.some((p) => permissions.includes(p)));
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [tab, setTab] = useState<Tab | null>(tabs[0]?.id ?? null);
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const can = (p: AdminPermission) => permissions.includes(p);

  const bookings = useList<AdminBooking>(loadBookings);
  const audit = useList<AuditItem>(loadAudit);
  const [approvalFilter, setApprovalFilter] = useState<string>("");
  const loadTeams = useCallback((cursor: string | null) => adminApi.teams(approvalFilter || null, cursor), [approvalFilter]);
  const teams = useList<AdminTeam>(loadTeams);
  const [unresolved, setUnresolved] = useState<{ ambiguousLeaders: number; nullEditionLeaders: number; leadersWithoutTeam: number } | null>(null);
  const [stalls, setStalls] = useState<SnapshotStall[] | null>(null);

  const reloadStalls = useCallback(async () => setStalls((await bookingApi.snapshot()).stalls), []);
  useEffect(() => {
    if (tab === "stalls") void reloadStalls();
    if (tab === "teams") void adminApi.teams(null, null).then((r) => setUnresolved(r.unresolved)).catch(() => null);
  }, [tab, reloadStalls]);

  const finish = (message: string | null) => {
    setAction(null);
    if (message) setNotice(message);
    void bookings.reload();
    void teams.reload();
    void audit.reload();
    void reloadStalls();
  };

  const signOut = async () => {
    await adminApi.logout().catch(() => null);
    window.location.assign("/admin/login");
  };

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>Stall booking administration</h1>
          <p className={styles.subtitle}>
            Signed in as {displayName} · {permissions.join(", ")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button className="btn" type="button" onClick={() => setShowChangePassword(true)}>
            Change Password
          </button>
          <button className="btn" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {showChangePassword && (
        <ChangePasswordDialog
          onDone={(msg) => {
            setShowChangePassword(false);
            if (msg) setNotice(msg);
          }}
        />
      )}

      {notice && (
        <div className="notice notice-ok" role="status" data-testid="admin-notice">
          {notice}
        </div>
      )}

      <div className={styles.tabs} role="tablist" aria-label="Administration areas">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className={styles.tab} aria-selected={t.id === tab} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bookings" && (
        <section className={styles.panel} aria-label="Bookings">
          {bookings.error && <div className="notice notice-error small">{bookings.error}</div>}
          <div style={{ overflowX: "auto" }}>
            <table className={styles.list}>
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Stall</th>
                  <th>Team</th>
                  <th>Leader</th>
                  <th>Status</th>
                  <th>
                    <span className={styles.srOnly}>Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(bookings.items ?? []).map((b) => (
                  <tr key={b.bookingId} data-booking-ref={b.bookingRef}>
                    <td className={styles.code}>{b.bookingRef}</td>
                    <td className={styles.code}>{b.stallCode}</td>
                    <td>
                      {b.teamName}
                      <div className="muted small">{b.track === "senior" ? "Senior" : "Junior"}</div>
                    </td>
                    <td>
                      {b.leaderName}
                      <div className="muted small">
                        {b.leaderEmail} · {b.leaderMobile}
                      </div>
                    </td>
                    <td className={styles.status}>
                      {b.status === "confirmed" ? `Booked ${formatIst(b.confirmedAt)}` : `Cancelled: ${b.cancelReason}`}
                    </td>
                    <td>
                      {b.status === "confirmed" && can("booking.cancel") && (
                        <button
                          type="button"
                          className={styles.listButton}
                          onClick={() =>
                            setAction({
                              title: `Cancel booking ${b.bookingRef}?`,
                              description: `Stall ${b.stallCode} becomes available to other teams immediately. The team may book again.`,
                              confirmLabel: "Cancel booking",
                              run: async (reason, _force, requestId) => {
                                await adminApi.cancel(b.bookingId, reason, requestId);
                                return `Booking ${b.bookingRef} cancelled.`;
                              },
                            })
                          }
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {bookings.items?.length === 0 && <p className="muted small">No bookings yet.</p>}
          {bookings.next && (
            <button className="btn" type="button" onClick={bookings.more}>
              Load more
            </button>
          )}
        </section>
      )}

      {tab === "stalls" && (
        <section className={styles.panel} aria-label="Stalls">
          <p className="muted small" style={{ margin: 0 }}>
            Disabling never cancels a booking; cancel the booking first. Unapproved inventory cannot be enabled here.
          </p>
          <table className={styles.list}>
            <thead>
              <tr>
                <th>Stall</th>
                <th>Status</th>
                <th>
                  <span className={styles.srOnly}>Action</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {(stalls ?? []).map((s) => (
                <tr key={s.id} data-stall-code={s.code}>
                  <td className={styles.code}>{s.code}</td>
                  <td className={styles.status}>{s.status}</td>
                  <td>
                    {s.status === "unavailable" ? (
                      <button
                        type="button"
                        className={styles.listButton}
                        onClick={() =>
                          setAction({
                            title: `Enable stall ${s.code}?`,
                            description: "The stall becomes available for booking again.",
                            confirmLabel: "Enable stall",
                            run: async (reason, _force, requestId) => {
                              await adminApi.availability(s.id, "enable", reason, false, requestId);
                              return `Stall ${s.code} enabled.`;
                            },
                          })
                        }
                      >
                        Enable
                      </button>
                    ) : s.status !== "booked" ? (
                      <button
                        type="button"
                        className={styles.listButton}
                        onClick={() =>
                          setAction({
                            title: `Disable stall ${s.code}?`,
                            description: "Teams will not be able to hold or book this stall until it is enabled again.",
                            confirmLabel: "Disable stall",
                            allowForce: s.status === "held",
                            run: async (reason, force, requestId) => {
                              await adminApi.availability(s.id, "disable", reason, force, requestId);
                              return `Stall ${s.code} disabled.`;
                            },
                          })
                        }
                      >
                        Disable
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === "teams" && (
        <section className={styles.panel} aria-label="Teams">
          {unresolved && (unresolved.ambiguousLeaders > 0 || unresolved.nullEditionLeaders > 0 || unresolved.leadersWithoutTeam > 0) && (
            <div className="notice notice-warn small">
              Needs a runbook: {unresolved.ambiguousLeaders} leader(s) registered in both tracks, {unresolved.nullEditionLeaders} without an
              edition, {unresolved.leadersWithoutTeam} without a team record.
            </div>
          )}
          <label style={{ maxWidth: 240 }}>
            Approval
            <select value={approvalFilter} onChange={(e) => setApprovalFilter(e.target.value)}>
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <div style={{ overflowX: "auto" }}>
            <table className={styles.list}>
              <thead>
                <tr>
                  <th>Team</th>
                  <th>Leader</th>
                  <th>Approval</th>
                  <th>Stall</th>
                  <th>
                    <span className={styles.srOnly}>Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {(teams.items ?? []).map((t) => (
                  <tr key={t.teamId} data-team-name={t.teamName}>
                    <td>
                      {t.teamName}
                      <div className="muted small">{t.track === "senior" ? "Senior" : "Junior"}</div>
                    </td>
                    <td>
                      {t.leaderName}
                      <div className="muted small">{t.leaderEmail}</div>
                    </td>
                    <td className={styles.status}>{t.approvalStatus}</td>
                    <td>{t.reservation ? `${t.reservation.stallCode} (${t.reservation.kind})` : "—"}</td>
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {can("teams.manage") &&
                        (["approved", "rejected", "pending"] as const)
                          .filter((s) => s !== t.approvalStatus)
                          .map((status) => (
                            <button
                              key={status}
                              type="button"
                              className={styles.listButton}
                              onClick={() =>
                                setAction({
                                  title: `${status === "approved" ? "Approve" : status === "rejected" ? "Reject" : "Reset"} ${t.teamName}?`,
                                  description:
                                    status === "rejected"
                                      ? "The team will not be able to hold or confirm. An existing booking is not cancelled automatically."
                                      : "This changes whether the team may book a stall.",
                                  confirmLabel: status === "approved" ? "Approve team" : status === "rejected" ? "Reject team" : "Reset to pending",
                                  run: async (reason, _force, requestId) => {
                                    await adminApi.approval(t.teamId, status, reason, requestId);
                                    return `${t.teamName}: ${status}.`;
                                  },
                                })
                              }
                            >
                              {status === "approved" ? "Approve" : status === "rejected" ? "Reject" : "Reset"}
                            </button>
                          ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {teams.next && (
            <button className="btn" type="button" onClick={teams.more}>
              Load more
            </button>
          )}
        </section>
      )}

      {tab === "audit" && (
        <section className={styles.panel} aria-label="Audit log">
          <div style={{ overflowX: "auto" }}>
            <table className={styles.list}>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Action</th>
                  <th>By</th>
                  <th>Team / stall</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(audit.items ?? []).map((a) => (
                  <tr key={a.id}>
                    <td className="small">{formatIst(a.occurredAt)}</td>
                    <td className={styles.code}>{a.action.replace(/_/g, " ")}</td>
                    <td>{a.actorName ?? a.actorType}</td>
                    <td>{[a.teamName, a.stallCode].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="small">{a.reason ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {audit.next && (
            <button className="btn" type="button" onClick={audit.more}>
              Load more
            </button>
          )}
        </section>
      )}

      {tabs.length === 0 && <div className="notice notice-warn">Your account has no administration permissions.</div>}
      {action && <ActionDialog action={action} adminEmail={adminEmail} onDone={finish} />}
    </div>
  );
}
