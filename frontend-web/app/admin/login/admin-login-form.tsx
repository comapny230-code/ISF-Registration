"use client";
import { useState } from "react";
import Link from "next/link";

interface Props {
  next: string;
}

export function AdminLoginForm({ next }: Props) {
  const [mode, setMode] = useState<"password" | "reset" | "otp">("password");

  // Password mode state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Reset password state
  const [resetEmail, setResetEmail] = useState("");
  const [resetStep, setResetStep] = useState<"request" | "confirm">("request");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // OTP mode state
  const [otpEmail, setOtpEmail] = useState("");
  const [otpStep, setOtpStep] = useState<"request" | "verify">("request");
  const [otpCode, setOtpCode] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // 1. Password Login Handler
  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/v1/auth/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || data?.error?.message || "Invalid administrator email or password.");
        setBusy(false);
        return;
      }

      setSuccess("Authentication successful! Redirecting to dashboard…");
      setTimeout(() => {
        window.location.assign(next);
      }, 500);
    } catch {
      setError("An unexpected network error occurred. Please try again.");
      setBusy(false);
    }
  }

  // 2. Reset Password Request Handler
  async function handleResetRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/v1/auth/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "request", email: resetEmail.trim() }),
      });

      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data?.message || data?.error?.message || "Failed to send reset code. Please check the email address.");
        return;
      }

      setSuccess(data.message || `A 6-digit reset code has been sent to ${resetEmail}.`);
      setResetStep("confirm");
    } catch {
      setError("Network error while requesting password reset. Please try again.");
      setBusy(false);
    }
  }

  // 3. Reset Password Confirm Handler
  async function handleResetConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 12) {
      setError("New password must be at least 12 characters long.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match.");
      return;
    }

    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/v1/auth/admin/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          action: "confirm",
          email: resetEmail.trim(),
          code: resetCode.trim(),
          newPassword,
        }),
      });

      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data?.message || data?.error?.message || "Invalid or expired reset code.");
        return;
      }

      setSuccess("Password updated successfully! You can now sign in with your new password.");
      setPassword(newPassword);
      setEmail(resetEmail);
      setTimeout(() => {
        setMode("password");
        setResetStep("request");
        setResetCode("");
        setNewPassword("");
        setConfirmPassword("");
      }, 1500);
    } catch {
      setError("Network error while updating password.");
      setBusy(false);
    }
  }

  // 4. OTP Request & Verify Handler
  async function handleOtpRequest(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/v1/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: otpEmail.trim(), audience: "admin" }),
      });
      const data = await res.json().catch(() => ({}));
      setBusy(false);
      if (!res.ok) {
        setError(data?.message || data?.error?.message || "Could not send code.");
        return;
      }
      setSuccess(data.message || `A verification code was sent to ${otpEmail}.`);
      setOtpStep("verify");
    } catch {
      setError("Network error sending OTP code.");
      setBusy(false);
    }
  }

  async function handleOtpVerify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/v1/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: otpEmail.trim(), audience: "admin", code: otpCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || data?.error?.message || "Invalid or expired code.");
        setBusy(false);
        return;
      }
      setSuccess("Sign-in successful! Redirecting to dashboard…");
      setTimeout(() => {
        window.location.assign(next);
      }, 500);
    } catch {
      setError("Network error verifying code.");
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "85vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 16px" }}>
      <div
        style={{
          width: "100%",
          maxWidth: 460,
          background: "#ffffff",
          borderRadius: 20,
          border: "1.5px solid #e4dcce",
          boxShadow: "0 20px 48px -12px rgba(20, 62, 48, 0.08), 0 2px 6px rgba(0,0,0,0.03)",
          overflow: "hidden",
        }}
      >
        {/* Header Ribbon */}
        <div
          style={{
            background: "linear-gradient(135deg, #143e30 0%, #1a5240 100%)",
            padding: "26px 28px 22px",
            color: "#ffffff",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "4px 12px",
              background: "rgba(255, 255, 255, 0.12)",
              borderRadius: 999,
              fontSize: 11.5,
              fontWeight: 700,
              fontFamily: "var(--font-mono, monospace)",
              letterSpacing: "0.05em",
              marginBottom: 10,
            }}
          >
            ISF STARTUP JATHARA 2026
          </div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "0 0 4px", color: "#ffffff" }}>
            Administrator Portal
          </h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.78)", margin: 0 }}>
            Organiser access for approvals, stalls & live monitoring
          </p>
        </div>

        {/* Tab Navigation */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            borderBottom: "1px solid #e8dfd3",
            background: "#faf7f2",
          }}
        >
          <button
            type="button"
            onClick={() => {
              setMode("password");
              setError(null);
              setSuccess(null);
            }}
            style={{
              padding: "12px 14px",
              background: mode === "password" ? "#ffffff" : "transparent",
              border: "none",
              borderBottom: mode === "password" ? "2.5px solid #143e30" : "none",
              color: mode === "password" ? "#143e30" : "#78716c",
              fontWeight: 800,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            Password Sign-In
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("reset");
              setError(null);
              setSuccess(null);
            }}
            style={{
              padding: "12px 14px",
              background: mode === "reset" ? "#ffffff" : "transparent",
              border: "none",
              borderBottom: mode === "reset" ? "2.5px solid #c25022" : "none",
              color: mode === "reset" ? "#c25022" : "#78716c",
              fontWeight: 800,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            Reset Password
          </button>
        </div>

        {/* Body Form */}
        <div style={{ padding: "28px" }}>
          {error && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                color: "#991b1b",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                marginBottom: 18,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
              role="alert"
            >
              <span>⚠</span>
              <span>{error}</span>
            </div>
          )}

          {success && (
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                color: "#166534",
                borderRadius: 10,
                padding: "10px 14px",
                fontSize: 12.5,
                fontWeight: 600,
                marginBottom: 18,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
              role="status"
            >
              <span>✓</span>
              <span>{success}</span>
            </div>
          )}

          {/* TAB 1: PASSWORD LOGIN */}
          {mode === "password" && (
            <form onSubmit={handlePasswordLogin} style={{ display: "grid", gap: 16 }}>
              <div>
                <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#1c1917", marginBottom: 6 }}>
                  Administrator Email
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  style={{
                    width: "100%",
                    padding: "11px 14px",
                    borderRadius: 10,
                    border: "1.5px solid #d6cfc7",
                    fontSize: 14,
                    outline: "none",
                    fontFamily: "inherit",
                  }}
                />
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: 12.5, fontWeight: 700, color: "#1c1917" }}>
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMode("reset");
                      setResetEmail(email);
                      setError(null);
                      setSuccess(null);
                    }}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#c25022",
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: "pointer",
                      padding: 0,
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div style={{ position: "relative" }}>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    style={{
                      width: "100%",
                      padding: "11px 40px 11px 14px",
                      borderRadius: 10,
                      border: "1.5px solid #d6cfc7",
                      fontSize: 14,
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "none",
                      border: "none",
                      color: "#78716c",
                      cursor: "pointer",
                      fontSize: 13,
                    }}
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? "🙈" : "👁"}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={busy || !email.trim() || !password}
                style={{
                  width: "100%",
                  padding: "13px",
                  borderRadius: 12,
                  border: "none",
                  background: "linear-gradient(135deg, #143e30 0%, #1e5c47 100%)",
                  color: "#ffffff",
                  fontSize: 14.5,
                  fontWeight: 800,
                  cursor: busy ? "not-allowed" : "pointer",
                  marginTop: 6,
                  transition: "all 0.2s",
                }}
              >
                {busy ? "Authenticating…" : "Sign In to Administration"}
              </button>

              <div style={{ textAlign: "center", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    setMode("otp");
                    setError(null);
                    setSuccess(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#57534e",
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Or sign in with a one-time email code
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: RESET PASSWORD */}
          {mode === "reset" && (
            <div>
              {resetStep === "request" ? (
                <form onSubmit={handleResetRequest} style={{ display: "grid", gap: 16 }}>
                  <p style={{ fontSize: 13, color: "#57534e", margin: "0 0 4px", lineHeight: "1.5" }}>
                    Enter your administrator email. We will send a 6-digit verification code to reset your password.
                  </p>
                  <div>
                    <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#1c1917", marginBottom: 6 }}>
                      Administrator Email
                    </label>
                    <input
                      type="email"
                      required
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      placeholder="admin@example.com"
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        borderRadius: 10,
                        border: "1.5px solid #d6cfc7",
                        fontSize: 14,
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy || !resetEmail.trim()}
                    style={{
                      width: "100%",
                      padding: "13px",
                      borderRadius: 12,
                      border: "none",
                      background: "linear-gradient(135deg, #c25022 0%, #e87042 100%)",
                      color: "#ffffff",
                      fontSize: 14.5,
                      fontWeight: 800,
                      cursor: busy ? "not-allowed" : "pointer",
                      marginTop: 4,
                    }}
                  >
                    {busy ? "Sending Code…" : "Send Password Reset Code"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleResetConfirm} style={{ display: "grid", gap: 14 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#1c1917", marginBottom: 6 }}>
                      6-Digit Verification Code
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={resetCode}
                      onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="123456"
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        borderRadius: 10,
                        border: "1.5px solid #d6cfc7",
                        fontSize: 18,
                        fontWeight: 800,
                        textAlign: "center",
                        letterSpacing: "4px",
                        outline: "none",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#1c1917", marginBottom: 6 }}>
                      New Password (min 12 characters)
                    </label>
                    <input
                      type="password"
                      required
                      minLength={12}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new secure password"
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        borderRadius: 10,
                        border: "1.5px solid #d6cfc7",
                        fontSize: 14,
                        outline: "none",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#1c1917", marginBottom: 6 }}>
                      Confirm New Password
                    </label>
                    <input
                      type="password"
                      required
                      minLength={12}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        borderRadius: 10,
                        border: "1.5px solid #d6cfc7",
                        fontSize: 14,
                        outline: "none",
                      }}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy || resetCode.length !== 6 || newPassword.length < 12}
                    style={{
                      width: "100%",
                      padding: "13px",
                      borderRadius: 12,
                      border: "none",
                      background: "linear-gradient(135deg, #c25022 0%, #e87042 100%)",
                      color: "#ffffff",
                      fontSize: 14.5,
                      fontWeight: 800,
                      cursor: busy ? "not-allowed" : "pointer",
                      marginTop: 4,
                    }}
                  >
                    {busy ? "Updating…" : "Confirm & Save New Password"}
                  </button>

                  <div style={{ textAlign: "center", marginTop: 4 }}>
                    <button
                      type="button"
                      onClick={() => setResetStep("request")}
                      style={{
                        background: "none",
                        border: "none",
                        color: "#57534e",
                        fontSize: 12,
                        cursor: "pointer",
                        textDecoration: "underline",
                      }}
                    >
                      Resend code or change email
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: OTP EMAIL CODE */}
          {mode === "otp" && (
            <div>
              {otpStep === "request" ? (
                <form onSubmit={handleOtpRequest} style={{ display: "grid", gap: 16 }}>
                  <p style={{ fontSize: 13, color: "#57534e", margin: "0 0 4px" }}>
                    Sign in with a temporary 6-digit code sent to your administrator email.
                  </p>
                  <div>
                    <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#1c1917", marginBottom: 6 }}>
                      Administrator Email
                    </label>
                    <input
                      type="email"
                      required
                      value={otpEmail}
                      onChange={(e) => setOtpEmail(e.target.value)}
                      placeholder="admin@example.com"
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        borderRadius: 10,
                        border: "1.5px solid #d6cfc7",
                        fontSize: 14,
                        outline: "none",
                      }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy || !otpEmail.trim()}
                    style={{
                      width: "100%",
                      padding: "13px",
                      borderRadius: 12,
                      border: "none",
                      background: "linear-gradient(135deg, #143e30 0%, #1e5c47 100%)",
                      color: "#ffffff",
                      fontSize: 14.5,
                      fontWeight: 800,
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    {busy ? "Sending…" : "Send One-Time Code"}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleOtpVerify} style={{ display: "grid", gap: 16 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#1c1917", marginBottom: 6 }}>
                      6-Digit Sign-in Code
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      placeholder="123456"
                      style={{
                        width: "100%",
                        padding: "11px 14px",
                        borderRadius: 10,
                        border: "1.5px solid #d6cfc7",
                        fontSize: 18,
                        fontWeight: 800,
                        textAlign: "center",
                        letterSpacing: "4px",
                        outline: "none",
                        fontFamily: "var(--font-mono, monospace)",
                      }}
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={busy || otpCode.length !== 6}
                    style={{
                      width: "100%",
                      padding: "13px",
                      borderRadius: 12,
                      border: "none",
                      background: "linear-gradient(135deg, #143e30 0%, #1e5c47 100%)",
                      color: "#ffffff",
                      fontSize: 14.5,
                      fontWeight: 800,
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    {busy ? "Verifying…" : "Verify & Sign In"}
                  </button>
                </form>
              )}
              <div style={{ textAlign: "center", marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => setMode("password")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#57534e",
                    fontSize: 12,
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  ← Back to Password Sign-In
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 28px",
            background: "#faf7f2",
            borderTop: "1px solid #e8dfd3",
            textAlign: "center",
            fontSize: 12,
            color: "#78716c",
          }}
        >
          <Link href="/" style={{ color: "#143e30", fontWeight: 700, textDecoration: "none" }}>
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
