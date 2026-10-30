"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminApi,
  type AdminBooking,
  type AdminPermission,
  type AdminRegistrationItem,
  type AdminStats,
  type AdminTeam,
  type AdminUserItem,
  type AuditItem,
} from "@/lib/booking/admin-client";
import { ApiError, bookingApi, type SnapshotStall } from "@/lib/booking/client-api";
import styles from "../book-your-stall/booking.module.css";
import { formatIst } from "../book-your-stall/components/stall-status";

type Tab = "dashboard" | "registrations" | "stalls" | "bookings" | "admins" | "audit";

const TABS: Array<{ id: Tab; label: string; needs: AdminPermission[] }> = [
  { id: "dashboard", label: "Overview", needs: ["reports.view"] },
  { id: "registrations", label: "Registrations & Users", needs: ["teams.manage", "reports.view"] },
  { id: "stalls", label: "Stalls Inventory", needs: ["inventory.manage"] },
  { id: "bookings", label: "Bookings", needs: ["reports.view", "booking.cancel"] },
  { id: "admins", label: "Admins", needs: ["reports.view", "teams.manage"] },
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
              Mandatory reason for audit (10–500 characters)
              <textarea
                ref={first}
                required
                minLength={10}
                maxLength={500}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this action is being performed…"
              />
            </label>
            {action.allowForce && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer" }}>
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                Force (release any active hold immediately)
              </label>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
              <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
                Cancel
              </button>
              <button className="btn btn-primary" type="button" disabled={busy || !reasonOk} onClick={submit}>
                {busy ? "Working…" : action.confirmLabel}
              </button>
            </div>
          </>
        ) : (
          <div data-testid="reauth" style={{ display: "grid", gap: 12 }}>
            <div className="notice notice-warn small">
              This action requires step-up authentication. A code will be emailed to <strong>{adminEmail}</strong>.
            </div>
            {reauth === "sent" ? (
              <>
                <label>
                  6-digit code
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder="123456"
                  />
                </label>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
                    Cancel
                  </button>
                  <button className="btn btn-primary" type="button" disabled={busy || code.length !== 6} onClick={verifyAndRetry}>
                    {busy ? "Checking…" : "Verify and proceed"}
                  </button>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary" type="button" disabled={busy} onClick={sendCode}>
                  {busy ? "Sending…" : "Send confirmation code"}
                </button>
              </div>
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
    if (newPassword.length < 12) return setError("New password must be at least 12 characters.");
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
            New Password (min 12 characters)
            <input type="password" required minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </label>
          <label>
            Confirm New Password
            <input type="password" required minLength={12} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy || !currentPassword || newPassword.length < 12}>
              {busy ? "Saving…" : "Save Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateAdminDialog({ onDone }: { onDone: (message: string | null) => void }) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 12) return setError("Password must be at least 12 characters.");
    setBusy(true);
    setError(null);
    try {
      const res = await adminApi.createUser({
        email: email.trim(),
        displayName: displayName.trim(),
        password,
      });
      onDone(`Administrator ${res.admin.displayName} (${res.admin.email}) created successfully!`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && !busy && onDone(null)}>
      <div className={styles.dialog} role="dialog" aria-modal="true">
        <h2 className={styles.panelTitle}>Create New Administrator</h2>
        <p className="muted small" style={{ margin: "4px 0 12px" }}>
          Create a new administrator account. The new administrator will have full privileges to manage bookings, stalls, and teams.
        </p>
        {error && <div className="notice notice-error small">{error}</div>}
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <label>
            Full Name / Display Name
            <input
              type="text"
              required
              placeholder="e.g. John Doe"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </label>
          <label>
            Administrator Email
            <input
              type="email"
              required
              placeholder="admin@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label>
            Password (min 12 characters)
            <input
              type="password"
              required
              minLength={12}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy || !email || !displayName || password.length < 12}>
              {busy ? "Creating…" : "Create Administrator"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ViewRegistrationModal({ item, onClose }: { item: AdminRegistrationItem; onClose: () => void }) {
  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={styles.dialog} role="dialog" aria-modal="true" style={{ maxWidth: 650, maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div>
            <h2 className={styles.panelTitle} style={{ fontSize: "1.4rem" }}>
              {item.teamName}
            </h2>
            <span
              style={{
                display: "inline-block",
                padding: "2px 8px",
                borderRadius: 4,
                fontSize: "0.75rem",
                fontWeight: 600,
                background: item.track === "senior" ? "#eff6ff" : "#fdf4ff",
                color: item.track === "senior" ? "#1e40af" : "#86198f",
                marginTop: 4,
              }}
            >
              {item.track === "senior" ? "Senior Startup Track" : "Junior Student Innovator"}
            </span>
          </div>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", fontSize: "1.5rem", cursor: "pointer", color: "#6b7280" }}>
            ×
          </button>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "#f9fafb", padding: 12, borderRadius: 6, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <div>
              <span className="muted small">Team Leader:</span>
              <div style={{ fontWeight: 600 }}>{item.leaderName}</div>
            </div>
            <div>
              <span className="muted small">Email:</span>
              <div style={{ fontWeight: 600 }}>{item.email}</div>
            </div>
            <div>
              <span className="muted small">Mobile:</span>
              <div style={{ fontWeight: 600 }}>{item.mobile}</div>
            </div>
            <div>
              <span className="muted small">Alternate Mobile:</span>
              <div style={{ fontWeight: 600 }}>{item.altMobile || "—"}</div>
            </div>
            <div>
              <span className="muted small">Domain:</span>
              <div style={{ fontWeight: 600 }}>{item.domain}</div>
            </div>
            <div>
              <span className="muted small">Location:</span>
              <div style={{ fontWeight: 600 }}>{[item.city, item.state, item.country].filter(Boolean).join(", ")}</div>
            </div>
          </div>

          <div>
            <h4 style={{ margin: "0 0 6px", fontSize: "0.95rem" }}>Project Overview & Links</h4>
            <p style={{ margin: "0 0 8px", fontSize: "0.9rem", color: "#374151", whiteSpace: "pre-wrap" }}>
              {item.projectDetails || "No project description provided."}
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: "0.85rem" }}>
              {item.projectReportUrl && (
                <a href={item.projectReportUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-forest)", textDecoration: "underline" }}>
                  📄 View Project Report / Pitch Deck
                </a>
              )}
              {item.linkedinUrl && (
                <a href={item.linkedinUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-forest)", textDecoration: "underline" }}>
                  🔗 LinkedIn Profile
                </a>
              )}
            </div>
          </div>

          <div>
            <h4 style={{ margin: "0 0 6px", fontSize: "0.95rem" }}>Stall Reservation Status</h4>
            {item.reservation ? (
              <div style={{ background: "#ecfdf5", padding: 10, borderRadius: 6, border: "1px solid #a7f3d0" }}>
                <strong>Stall {item.reservation.stallCode}</strong> ({item.reservation.kind.toUpperCase()})
                {item.reservation.bookingRef && <span style={{ marginLeft: 8, color: "#065f46" }}>Ref: {item.reservation.bookingRef}</span>}
              </div>
            ) : (
              <div style={{ color: "#6b7280", fontStyle: "italic", fontSize: "0.9rem" }}>No stall booked yet.</div>
            )}
          </div>

          {item.members.length > 0 && (
            <div>
              <h4 style={{ margin: "0 0 8px", fontSize: "0.95rem" }}>Team Members ({item.members.length})</h4>
              <table className={styles.list}>
                <thead>
                  <tr>
                    <th>Member Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                  </tr>
                </thead>
                <tbody>
                  {item.members.map((m, idx) => (
                    <tr key={idx}>
                      <td><strong>{m.name}</strong></td>
                      <td>{m.email}</td>
                      <td>{m.phone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn" type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditRegistrationModal({
  item,
  onDone,
}: {
  item: AdminRegistrationItem;
  onDone: (msg: string | null) => void;
}) {
  const [teamName, setTeamName] = useState(item.teamName);
  const [leaderName, setLeaderName] = useState(item.leaderName);
  const [mobile, setMobile] = useState(item.mobile);
  const [altMobile, setAltMobile] = useState(item.altMobile || "");
  const [domain, setDomain] = useState(item.domain);
  const [city, setCity] = useState(item.city);
  const [state, setState] = useState(item.state);
  const [projectDetails, setProjectDetails] = useState(item.projectDetails || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateRegistration(item.id, {
        teamName,
        leaderName,
        mobile,
        altMobile: altMobile || mobile,
        domain,
        city,
        state,
        projectDetails,
      });
      onDone(`Team "${teamName}" updated successfully.`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && !busy && onDone(null)}>
      <div className={styles.dialog} role="dialog" aria-modal="true" style={{ maxWidth: 550, maxHeight: "90vh", overflowY: "auto" }}>
        <h2 className={styles.panelTitle}>Edit Team Registration</h2>
        {error && <div className="notice notice-error small">{error}</div>}
        <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 10 }}>
          <label>
            Team Name
            <input required value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          </label>
          <label>
            Leader Name
            <input required value={leaderName} onChange={(e) => setLeaderName(e.target.value)} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              Mobile
              <input required pattern="^[6-9]\d{9}$" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </label>
            <label>
              Alternate Mobile
              <input value={altMobile} onChange={(e) => setAltMobile(e.target.value)} />
            </label>
          </div>
          <label>
            Domain / Industry
            <input required value={domain} onChange={(e) => setDomain(e.target.value)} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              City
              <input required value={city} onChange={(e) => setCity(e.target.value)} />
            </label>
            <label>
              State
              <input required value={state} onChange={(e) => setState(e.target.value)} />
            </label>
          </div>
          <label>
            Project Details
            <textarea rows={3} value={projectDetails} onChange={(e) => setProjectDetails(e.target.value)} />
          </label>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Zones come from the database (snapshot), so every zone in the inventory can receive stalls. */
function AddStallModal({ zones, onDone }: { zones: Array<{ code: string; name: string }>; onDone: (msg: string | null) => void }) {
  const [zone, setZone] = useState(zones[0]?.code ?? "");
  const [code, setCode] = useState(zones[0] ? `${zones[0].code}-A01` : "");
  const [x, setX] = useState(20);
  const [y, setY] = useState(20);
  const [width, setWidth] = useState(10);
  const [depth, setDepth] = useState(10);
  const [rotation, setRotation] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.createStall({
        zone,
        code: code.trim(),
        x: Number(x),
        y: Number(y),
        width: Number(width),
        depth: Number(depth),
        rotation: Number(rotation),
      });
      onDone(`Stall ${code} added successfully to ${zone}.`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && !busy && onDone(null)}>
      <div className={styles.dialog} role="dialog" aria-modal="true" style={{ maxWidth: 450 }}>
        <h2 className={styles.panelTitle}>Add New Stall</h2>
        <p className="muted small" style={{ margin: "4px 0 12px" }}>
          Create a new 10x10 stall and add it to the venue layout.
        </p>
        {error && <div className="notice notice-error small">{error}</div>}
        <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
          <label>
            Venue Zone
            <select
              value={zone}
              onChange={(e) => {
                setZone(e.target.value);
                setCode(`${e.target.value}-A01`);
              }}
            >
              {zones.map((z) => (
                <option key={z.code} value={z.code}>
                  {z.name} ({z.code})
                </option>
              ))}
            </select>
          </label>
          <label>
            Stall Code (Format: PG-A01, BB-B01)
            <input required pattern="^[A-Z]{2}-[A-Z][0-9]{2}$" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              X Position (ft)
              <input type="number" required value={x} onChange={(e) => setX(Number(e.target.value))} />
            </label>
            <label>
              Y Position (ft)
              <input type="number" required value={y} onChange={(e) => setY(Number(e.target.value))} />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <label>
              Width (ft)
              <input type="number" required value={width} onChange={(e) => setWidth(Number(e.target.value))} />
            </label>
            <label>
              Depth (ft)
              <input type="number" required value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
            </label>
            <label>
              Rotation (°)
              <input type="number" required value={rotation} onChange={(e) => setRotation(Number(e.target.value))} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy || !code}>
              {busy ? "Adding…" : "Add Stall"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditStallModal({
  stall,
  onDone,
}: {
  stall: SnapshotStall;
  onDone: (msg: string | null) => void;
}) {
  const [code, setCode] = useState(stall.code);
  const [x, setX] = useState(stall.x ?? 0);
  const [y, setY] = useState(stall.y ?? 0);
  const [width, setWidth] = useState(stall.w);
  const [depth, setDepth] = useState(stall.d);
  const [rotation, setRotation] = useState(stall.rot ?? 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.updateStall(stall.id, {
        code: code.trim(),
        x: Number(x),
        y: Number(y),
        width: Number(width),
        depth: Number(depth),
        rotation: Number(rotation),
      });
      onDone(`Stall ${code} updated successfully.`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className={styles.backdrop} onClick={(e) => e.target === e.currentTarget && !busy && onDone(null)}>
      <div className={styles.dialog} role="dialog" aria-modal="true" style={{ maxWidth: 450 }}>
        <h2 className={styles.panelTitle}>Edit Stall {stall.code}</h2>
        {error && <div className="notice notice-error small">{error}</div>}
        <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 10 }}>
          <label>
            Stall Code
            <input required value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
          </label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label>
              X Position (ft)
              <input type="number" required value={x} onChange={(e) => setX(Number(e.target.value))} />
            </label>
            <label>
              Y Position (ft)
              <input type="number" required value={y} onChange={(e) => setY(Number(e.target.value))} />
            </label>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <label>
              Width (ft)
              <input type="number" required value={width} onChange={(e) => setWidth(Number(e.target.value))} />
            </label>
            <label>
              Depth (ft)
              <input type="number" required value={depth} onChange={(e) => setDepth(Number(e.target.value))} />
            </label>
            <label>
              Rotation (°)
              <input type="number" required value={rotation} onChange={(e) => setRotation(Number(e.target.value))} />
            </label>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn" type="button" disabled={busy} onClick={() => onDone(null)}>
              Cancel
            </button>
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save Changes"}
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
  const [showCreateAdmin, setShowCreateAdmin] = useState(false);
  const [showAddStall, setShowAddStall] = useState(false);
  const [editingStall, setEditingStall] = useState<SnapshotStall | null>(null);
  const [viewingReg, setViewingReg] = useState<AdminRegistrationItem | null>(null);
  const [editingReg, setEditingReg] = useState<AdminRegistrationItem | null>(null);

  const [tab, setTab] = useState<Tab>(tabs[0]?.id ?? "dashboard");
  const [action, setAction] = useState<Action | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const can = (p: AdminPermission) => permissions.includes(p);

  // Stats
  const [stats, setStats] = useState<AdminStats | null>(null);
  const reloadStats = useCallback(async () => {
    try {
      setStats(await adminApi.stats());
    } catch {
      // ignore
    }
  }, []);

  // Registrations
  const [registrations, setRegistrations] = useState<AdminRegistrationItem[] | null>(null);
  const [regSearch, setRegSearch] = useState("");
  const [regTrack, setRegTrack] = useState<string>("all");
  const reloadRegistrations = useCallback(async () => {
    try {
      const res = await adminApi.registrations();
      setRegistrations(res.registrations);
    } catch {
      // ignore
    }
  }, []);

  // Stalls
  const [stalls, setStalls] = useState<SnapshotStall[] | null>(null);
  const [zones, setZones] = useState<Array<{ code: string; name: string }>>([]);
  const [stallZoneFilter, setStallZoneFilter] = useState<string>("all");
  const [stallStatusFilter, setStallStatusFilter] = useState<string>("all");
  const [stallSearch, setStallSearch] = useState("");
  const reloadStalls = useCallback(async () => {
    const snapshot = await bookingApi.snapshot();
    setStalls(snapshot.stalls);
    setZones(snapshot.zones.map((z) => ({ code: z.code, name: z.name })));
  }, []);

  // Bookings & Audit
  const bookings = useList<AdminBooking>(loadBookings);
  const audit = useList<AuditItem>(loadAudit);

  // Admins
  const [adminUsers, setAdminUsers] = useState<AdminUserItem[] | null>(null);
  const reloadAdmins = useCallback(async () => {
    try {
      const res = await adminApi.users();
      setAdminUsers(res.users);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void reloadStats();
    void reloadRegistrations();
    void reloadStalls();
  }, [reloadStats, reloadRegistrations, reloadStalls]);

  useEffect(() => {
    if (tab === "dashboard") void reloadStats();
    if (tab === "registrations") void reloadRegistrations();
    if (tab === "stalls") void reloadStalls();
    if (tab === "admins") void reloadAdmins();
  }, [tab, reloadStats, reloadRegistrations, reloadStalls, reloadAdmins]);

  const finish = (message: string | null) => {
    setAction(null);
    if (message) setNotice(message);
    void reloadStats();
    void reloadRegistrations();
    void reloadStalls();
    void bookings.reload();
    void audit.reload();
    void reloadAdmins();
  };

  const signOut = async () => {
    await adminApi.logout().catch(() => null);
    window.location.assign("/admin/login");
  };

  // Export registrations CSV
  const exportRegistrationsCsv = () => {
    if (!registrations || registrations.length === 0) return;
    const headers = [
      "ID",
      "Track",
      "Team Name",
      "Leader Name",
      "Email",
      "Mobile",
      "Alternate Mobile",
      "Domain",
      "City",
      "State",
      "Country",
      "LinkedIn URL",
      "Project Report URL",
      "Members Count",
      "Assigned Stall",
      "Booking Reference",
      "Approval Status",
      "Registered At",
    ];

    const rows = registrations.map((r) => [
      r.id,
      r.track,
      `"${r.teamName.replace(/"/g, '""')}"`,
      `"${r.leaderName.replace(/"/g, '""')}"`,
      r.email,
      r.mobile,
      r.altMobile || "",
      `"${r.domain.replace(/"/g, '""')}"`,
      `"${r.city.replace(/"/g, '""')}"`,
      `"${r.state.replace(/"/g, '""')}"`,
      r.country,
      r.linkedinUrl || "",
      r.projectReportUrl || "",
      r.members.length,
      r.reservation?.stallCode || "",
      r.reservation?.bookingRef || "",
      r.approvalStatus,
      r.createdAt,
    ]);

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `isf-registrations-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Filtered registrations
  const filteredRegs = (registrations ?? []).filter((r) => {
    if (regTrack !== "all" && r.track !== regTrack) return false;
    if (!regSearch.trim()) return true;
    const q = regSearch.toLowerCase();
    return (
      r.teamName.toLowerCase().includes(q) ||
      r.leaderName.toLowerCase().includes(q) ||
      r.email.toLowerCase().includes(q) ||
      r.mobile.includes(q) ||
      r.domain.toLowerCase().includes(q) ||
      r.city.toLowerCase().includes(q) ||
      (r.reservation?.stallCode && r.reservation.stallCode.toLowerCase().includes(q))
    );
  });

  // Filtered stalls
  const filteredStalls = (stalls ?? []).filter((s) => {
    if (stallZoneFilter !== "all" && s.zone !== stallZoneFilter) return false;
    if (stallStatusFilter !== "all" && s.status !== stallStatusFilter) return false;
    if (!stallSearch.trim()) return true;
    return s.code.toLowerCase().includes(stallSearch.toLowerCase());
  });

  return (
    <div className={styles.page}>
      {/* Top Header */}
      <div className={styles.titleRow}>
        <div>
          <h1 className={styles.title}>Stall booking administration</h1>
          <p className={styles.subtitle}>
            Signed in as <strong>{displayName}</strong> ({adminEmail})
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn btn-primary" type="button" onClick={() => setShowCreateAdmin(true)}>
            + Create Admin
          </button>
          <button className="btn" type="button" onClick={() => setShowChangePassword(true)}>
            Change Password
          </button>
          <button className="btn" type="button" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>

      {/* Real-time Summary Cards */}
      {stats && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "14px 16px" }}>
            <span style={{ fontSize: "0.8rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 700 }}>
              Registered Users
            </span>
            <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "var(--color-forest)", margin: "4px 0" }}>
              {stats.registrations.totalUsers}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#4b5563" }}>
              {stats.registrations.totalTeams} Teams ({stats.registrations.totalMembers} Members)
            </div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "14px 16px" }}>
            <span style={{ fontSize: "0.8rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 700 }}>
              Registration Tracks
            </span>
            <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "#1e3a8a", margin: "4px 0" }}>
              {stats.registrations.seniorCount} / {stats.registrations.juniorCount}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#4b5563" }}>
              {stats.registrations.seniorCount} Startups · {stats.registrations.juniorCount} Students
            </div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "14px 16px" }}>
            <span style={{ fontSize: "0.8rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 700 }}>
              Stalls Booked & Held
            </span>
            <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "#d97706", margin: "4px 0" }}>
              {stats.stalls.booked} <span style={{ fontSize: "1rem", fontWeight: 500 }}>booked</span> / {stats.stalls.held} <span style={{ fontSize: "1rem", fontWeight: 500 }}>held</span>
            </div>
            <div style={{ fontSize: "0.8rem", color: "#4b5563" }}>
              Out of {stats.stalls.total} total stalls
            </div>
          </div>

          <div style={{ background: "#ffffff", border: "1px solid #e5e7eb", borderRadius: 8, padding: "14px 16px" }}>
            <span style={{ fontSize: "0.8rem", color: "#6b7280", textTransform: "uppercase", fontWeight: 700 }}>
              Stalls Left (Available)
            </span>
            <div style={{ fontSize: "1.7rem", fontWeight: 800, color: "#059669", margin: "4px 0" }}>
              {stats.stalls.available}
            </div>
            <div style={{ fontSize: "0.8rem", color: "#4b5563" }}>
              PG: {stats.stalls.byZone.PG?.available ?? 0} left · BB: {stats.stalls.byZone.BB?.available ?? 0} left
            </div>
          </div>
        </div>
      )}

      {/* Notices */}
      {notice && (
        <div className="notice notice-ok" role="status" data-testid="admin-notice">
          {notice}
        </div>
      )}

      {/* Tabs */}
      <div className={styles.tabs} role="tablist" aria-label="Administration areas">
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className={styles.tab} aria-selected={t.id === tab} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: OVERVIEW / DASHBOARD */}
      {tab === "dashboard" && stats && (
        <section className={styles.panel} aria-label="Overview">
          <h2 className={styles.panelTitle}>Event Summary & Live Statistics</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 10 }}>
            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: "1.05rem" }}>🎪 Stalls Inventory Breakdown</h3>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: "0.9rem" }}>
                <li><strong>Total Stalls:</strong> {stats.stalls.total} stalls across 2 zones</li>
                <li><strong>Stalls Booked (Confirmed):</strong> {stats.stalls.booked}</li>
                <li><strong>Stalls Held (Under Reservation):</strong> {stats.stalls.held}</li>
                <li><strong>Stalls Remaining / Left:</strong> <span style={{ color: "#059669", fontWeight: 700 }}>{stats.stalls.available} stalls</span></li>
                <li><strong>Disabled / Reserved:</strong> {stats.stalls.disabled}</li>
              </ul>
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #e5e7eb", fontSize: "0.85rem" }}>
                <div><strong>Playground GIET University (PG):</strong> {stats.stalls.byZone.PG?.total ?? 48} stalls ({stats.stalls.byZone.PG?.available ?? 0} left)</div>
                <div style={{ marginTop: 4 }}><strong>Basketball Ground / Rang Manch (BB):</strong> {stats.stalls.byZone.BB?.total ?? 50} stalls ({stats.stalls.byZone.BB?.available ?? 0} left)</div>
              </div>
            </div>

            <div style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 }}>
              <h3 style={{ margin: "0 0 10px", fontSize: "1.05rem" }}>👥 Registrations Overview</h3>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: "0.9rem" }}>
                <li><strong>Total Registered Users:</strong> {stats.registrations.totalUsers} people</li>
                <li><strong>Senior Startup Teams:</strong> {stats.registrations.seniorCount} teams</li>
                <li><strong>Junior Student Innovators:</strong> {stats.registrations.juniorCount} teams</li>
                <li><strong>Team Members Registered:</strong> {stats.registrations.totalMembers} members</li>
              </ul>
              <div style={{ marginTop: 14 }}>
                <button className="btn btn-primary" type="button" onClick={() => setTab("registrations")}>
                  View All Registrations →
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* TAB 2: REGISTRATIONS & USERS (FULL DETAILS + CRUD) */}
      {tab === "registrations" && (
        <section className={styles.panel} aria-label="Registrations">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 className={styles.panelTitle} style={{ margin: 0 }}>
                Registered Teams & Users ({filteredRegs.length})
              </h2>
              <p className="muted small" style={{ margin: 0 }}>
                Complete list of all registered startups and student innovators with contact details and stall status.
              </p>
            </div>
            <button className="btn" type="button" onClick={exportRegistrationsCsv} disabled={!registrations || registrations.length === 0}>
              📥 Export All to CSV
            </button>
          </div>

          {/* Filters Bar */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
            <input
              type="text"
              placeholder="Search by team, leader, email, phone, city…"
              value={regSearch}
              onChange={(e) => setRegSearch(e.target.value)}
              style={{ flex: "1 1 240px", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
            />
            <select
              value={regTrack}
              onChange={(e) => setRegTrack(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
            >
              <option value="all">All Tracks</option>
              <option value="senior">Senior Startup Track</option>
              <option value="junior">Junior Student Innovators</option>
            </select>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className={styles.list}>
              <thead>
                <tr>
                  <th>Team / Track</th>
                  <th>Leader Contact</th>
                  <th>Domain & Location</th>
                  <th>Members</th>
                  <th>Stall</th>
                  <th>Approval</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredRegs.map((r) => (
                  <tr key={r.id} data-team-name={r.teamName}>
                    <td>
                      <strong style={{ fontSize: "0.95rem" }}>{r.teamName}</strong>
                      <div className="muted small">{r.track === "senior" ? "Senior Startup" : "Junior Innovator"}</div>
                    </td>
                    <td>
                      <div>{r.leaderName}</div>
                      <div className="muted small">{r.email}</div>
                      <div className="small" style={{ color: "#065f46" }}>{r.mobile}</div>
                    </td>
                    <td>
                      <div>{r.domain}</div>
                      <div className="muted small">{[r.city, r.state].filter(Boolean).join(", ")}</div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600 }}>{r.members.length}</span> members
                    </td>
                    <td>
                      {r.reservation ? (
                        <span style={{ fontWeight: 600, color: "var(--color-forest)" }}>
                          {r.reservation.stallCode} ({r.reservation.kind})
                        </span>
                      ) : (
                        <span className="muted small">Not booked</span>
                      )}
                    </td>
                    <td className={styles.status}>{r.approvalStatus}</td>
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className={styles.listButton}
                        onClick={() => setViewingReg(r)}
                      >
                        View Details
                      </button>
                      <button
                        type="button"
                        className={styles.listButton}
                        onClick={() => setEditingReg(r)}
                      >
                        Edit
                      </button>
                      {r.teamId && can("teams.manage") &&
                        (["approved", "rejected", "pending"] as const)
                          .filter((s) => s !== r.approvalStatus)
                          .map((status) => (
                            <button
                              key={status}
                              type="button"
                              className={styles.listButton}
                              onClick={() =>
                                setAction({
                                  title: `${status === "approved" ? "Approve" : status === "rejected" ? "Reject" : "Reset"} ${r.teamName}?`,
                                  description: `Change team booking eligibility to ${status}.`,
                                  confirmLabel: status === "approved" ? "Approve team" : status === "rejected" ? "Reject team" : "Reset to pending",
                                  run: async (reason, _force, requestId) => {
                                    await adminApi.approval(r.teamId!, status, reason, requestId);
                                    return `${r.teamName}: ${status}.`;
                                  },
                                })
                              }
                            >
                              {status === "approved" ? "Approve" : status === "rejected" ? "Reject" : "Reset"}
                            </button>
                          ))}
                      <button
                        type="button"
                        className={styles.listButton}
                        style={{ color: "#991b1b" }}
                        onClick={() =>
                          setAction({
                            title: `Delete registration for ${r.teamName}?`,
                            description: `This permanently deletes the team registration for leader ${r.leaderName} (${r.email}). This cannot be undone.`,
                            confirmLabel: "Delete registration",
                            run: async () => {
                              await adminApi.deleteRegistration(r.id);
                              return `Deleted team ${r.teamName}.`;
                            },
                          })
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredRegs.length === 0 && <p className="muted small">No registrations match your search.</p>}
        </section>
      )}

      {/* TAB 3: STALLS INVENTORY (FULL CRUD + STATS) */}
      {tab === "stalls" && (
        <section className={styles.panel} aria-label="Stalls">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 className={styles.panelTitle} style={{ margin: 0 }}>
                Venue Stalls Inventory ({filteredStalls.length})
              </h2>
              <p className="muted small" style={{ margin: 0 }}>
                Manage stall status, add new stalls, edit coordinates, and manage availability.
              </p>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => setShowAddStall(true)}>
              + Add New Stall
            </button>
          </div>

          {/* Stalls filter bar */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", margin: "10px 0" }}>
            <input
              type="text"
              placeholder="Search stall code (e.g. PG-A01, BB-B12)…"
              value={stallSearch}
              onChange={(e) => setStallSearch(e.target.value)}
              style={{ flex: "1 1 200px", padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
            />
            <select
              value={stallZoneFilter}
              onChange={(e) => setStallZoneFilter(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
            >
              <option value="all">All Zones</option>
              <option value="PG">Playground GIET University (PG)</option>
              <option value="BB">Basketball Ground / Rang Manch (BB)</option>
            </select>
            <select
              value={stallStatusFilter}
              onChange={(e) => setStallStatusFilter(e.target.value)}
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid #d1d5db" }}
            >
              <option value="all">All Statuses</option>
              <option value="available">Available (Left)</option>
              <option value="booked">Booked</option>
              <option value="held">Held</option>
              <option value="unavailable">Unavailable / Disabled</option>
            </select>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className={styles.list}>
              <thead>
                <tr>
                  <th>Stall Code</th>
                  <th>Zone</th>
                  <th>Size</th>
                  <th>Coordinates (X, Y)</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredStalls.map((s) => (
                  <tr key={s.id} data-stall-code={s.code}>
                    <td className={styles.code}>
                      <strong>{s.code}</strong>
                    </td>
                    <td>{s.zone === "PG" ? "Playground (PG)" : "Basketball Ground (BB)"}</td>
                    <td>{s.w} × {s.d} ft</td>
                    <td className="small muted">
                      {s.x !== null ? `(${s.x}, ${s.y})` : "—"}
                    </td>
                    <td className={styles.status}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          background:
                            s.status === "available"
                              ? "#ecfdf5"
                              : s.status === "booked"
                              ? "#eff6ff"
                              : s.status === "held"
                              ? "#fef3c7"
                              : "#fef2f2",
                          color:
                            s.status === "available"
                              ? "#065f46"
                              : s.status === "booked"
                              ? "#1e40af"
                              : s.status === "held"
                              ? "#92400e"
                              : "#991b1b",
                        }}
                      >
                        {s.status === "available" ? "Available (Left)" : s.status}
                      </span>
                    </td>
                    <td style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className={styles.listButton}
                        onClick={() => setEditingStall(s)}
                      >
                        Edit
                      </button>
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
                      {s.status !== "booked" && (
                        <button
                          type="button"
                          className={styles.listButton}
                          style={{ color: "#991b1b" }}
                          onClick={() =>
                            setAction({
                              title: `Delete stall ${s.code}?`,
                              description: `This removes stall ${s.code} from the active venue inventory.`,
                              confirmLabel: "Delete stall",
                              run: async () => {
                                await adminApi.deleteStall(s.id);
                                return `Stall ${s.code} deleted.`;
                              },
                            })
                          }
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filteredStalls.length === 0 && <p className="muted small">No stalls match your filter.</p>}
        </section>
      )}

      {/* TAB 4: BOOKINGS */}
      {tab === "bookings" && (
        <section className={styles.panel} aria-label="Bookings">
          <h2 className={styles.panelTitle}>Stall Bookings</h2>
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
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(bookings.items ?? []).map((b) => (
                  <tr key={b.bookingId} data-booking-ref={b.bookingRef}>
                    <td className={styles.code}>{b.bookingRef}</td>
                    <td>{b.stallCode}</td>
                    <td>{b.teamName}</td>
                    <td>
                      {b.leaderName}
                      <div className="muted small">{b.leaderEmail}</div>
                    </td>
                    <td className={styles.status}>{b.status}</td>
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

      {/* TAB 5: ADMINS */}
      {tab === "admins" && (
        <section className={styles.panel} aria-label="Administrators">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div>
              <h2 className={styles.panelTitle} style={{ margin: 0 }}>
                Administrator Accounts
              </h2>
              <p className="muted small" style={{ margin: 0 }}>
                Manage event administrators and issue credentials.
              </p>
            </div>
            <button className="btn btn-primary" type="button" onClick={() => setShowCreateAdmin(true)}>
              + Create Administrator
            </button>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className={styles.list}>
              <thead>
                <tr>
                  <th>Display Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Permissions</th>
                </tr>
              </thead>
              <tbody>
                {(adminUsers ?? []).map((u) => (
                  <tr key={u.id}>
                    <td>
                      <strong>{u.displayName}</strong>
                    </td>
                    <td className={styles.code}>{u.email}</td>
                    <td>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: 4,
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          background: u.status === "active" ? "#ecfdf5" : "#fef2f2",
                          color: u.status === "active" ? "#065f46" : "#991b1b",
                        }}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="small">{formatIst(u.createdAt)}</td>
                    <td className="small muted">
                      {u.permissions && u.permissions.length > 0 ? u.permissions.join(", ") : "All"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* TAB 6: AUDIT LOG */}
      {tab === "audit" && (
        <section className={styles.panel} aria-label="Audit log">
          <h2 className={styles.panelTitle}>Audit Log</h2>
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

      {/* Modals & Dialogs */}
      {showCreateAdmin && (
        <CreateAdminDialog
          onDone={(msg) => {
            setShowCreateAdmin(false);
            if (msg) finish(msg);
          }}
        />
      )}

      {showChangePassword && (
        <ChangePasswordDialog
          onDone={(msg) => {
            setShowChangePassword(false);
            if (msg) finish(msg);
          }}
        />
      )}

      {showAddStall && (
        <AddStallModal
          zones={zones}
          onDone={(msg) => {
            setShowAddStall(false);
            if (msg) finish(msg);
          }}
        />
      )}

      {editingStall && (
        <EditStallModal
          stall={editingStall}
          onDone={(msg) => {
            setEditingStall(null);
            if (msg) finish(msg);
          }}
        />
      )}

      {viewingReg && (
        <ViewRegistrationModal
          item={viewingReg}
          onClose={() => setViewingReg(null)}
        />
      )}

      {editingReg && (
        <EditRegistrationModal
          item={editingReg}
          onDone={(msg) => {
            setEditingReg(null);
            if (msg) finish(msg);
          }}
        />
      )}

      {action && <ActionDialog action={action} adminEmail={adminEmail} onDone={finish} />}
    </div>
  );
}
