/**
 * Registration confirmation email. Every interpolated value is escaped (R-10) and
 * URLs are restricted to http(s). Content is otherwise unchanged; whether the
 * Aadhaar/PAN numbers should be emailed at all is organiser decision D-25.
 */
import { escapeHtml as e, safeHttpUrl } from "../html";
import type { RegistrationInput } from "./persist";

export function buildConfirmationEmail(input: RegistrationInput): { subject: string; html: string } {
  const junior = input.track === "junior";
  const team = input.teamName || input.fullName;

  const subject = junior
    ? `Welcome to ISF Startup Jathara 2026 - ${team} (Student Innovator) Registration Confirmed`
    : `Welcome to ISF Startup Jathara 2026 - ${team} Registration Confirmed`;
  const bannerTitle = junior ? "🎉 Student Innovator Registration Confirmed!" : "🎉 Startup Registration Confirmed!";
  const bannerDesc = junior
    ? `Dear <strong>${e(input.fullName)}</strong>, your student innovation credentials, project profile, and team members have been successfully saved to the summit database.`
    : `Dear <strong>${e(input.fullName)}</strong>, your startup credentials and team members have been successfully saved to the summit database.`;
  const profileTitle = junior ? "Student Innovator &amp; Team Profile" : "Team Leader &amp; Startup Profile";

  const photo = (url: string | null, size: number, alt: string, extra = "") => {
    const safe = url && safeHttpUrl(url);
    return safe
      ? `<img src="${safe}" alt="${e(alt)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;${extra}" />`
      : "";
  };

  const membersHtml =
    input.members.length === 0
      ? ""
      : `
      <div style="margin-top:20px;">
        <h4 style="margin:0 0 10px;color:#1e293b;font-size:14px;font-weight:700;">Registered Team Members (${input.members.length} / 5):</h4>
        <table style="width:100%;border-collapse:collapse;font-size:13px;color:#334155;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f1f5f9;text-align:left;">
              <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">#</th>
              <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Photo</th>
              <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Name</th>
              <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Email</th>
              <th style="padding:8px 12px;border-bottom:1px solid #e2e8f0;">Phone</th>
            </tr>
          </thead>
          <tbody>
            ${input.members
              .map(
                (m, i) => `
              <tr style="border-bottom:1px solid #f1f5f9;">
                <td style="padding:8px 12px;color:#64748b;">${i + 1}</td>
                <td style="padding:8px 12px;">${photo(m.photoUrl, 28, m.name, "vertical-align:middle;") || "—"}</td>
                <td style="padding:8px 12px;"><strong>${e(m.name)}</strong></td>
                <td style="padding:8px 12px;color:#2563eb;">${e(m.email)}</td>
                <td style="padding:8px 12px;">${e(m.phone)}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;

  const linkedin = safeHttpUrl(input.linkedinUrl);
  const report = input.projectReportUrl ? safeHttpUrl(input.projectReportUrl) : null;
  const leaderPhoto = photo(input.photoUrl, 60, "Photo", "border:2px solid #2563eb;");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:580px;margin:20px auto;padding:32px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
      <div style="margin-bottom:16px;">
        <span style="display:inline-block;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;text-transform:uppercase;letter-spacing:0.04em;">Dandakaranya Innovation Summit</span>
        <h2 style="color:#1d4ed8;margin:8px 0 4px;font-size:22px;font-weight:800;">ISF · Startup Jathara 2026</h2>
        <p style="color:#64748b;font-size:13px;margin:0;">GIET University, Gunupur, Odisha · 18–20 December 2026</p>
      </div>

      <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:16px;margin:16px 0 20px;">
        <h3 style="color:#065f46;font-size:16px;margin:0 0 6px;">${bannerTitle}</h3>
        <p style="color:#047857;font-size:13px;margin:0;line-height:1.4;">${bannerDesc}</p>
      </div>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:18px;margin:0 0 16px;font-size:13px;color:#334155;line-height:1.6;">
        <div style="font-size:14px;font-weight:700;color:#0f172a;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px;">${profileTitle}</div>
        ${leaderPhoto ? `<div style="margin-bottom:10px;">${leaderPhoto}</div>` : ""}
        <div style="margin-bottom:6px;"><strong>Team Lead Name:</strong> ${e(input.fullName)}</div>
        <div style="margin-bottom:6px;"><strong>${junior ? "Project / Team:" : "Startup / Team:"}</strong> ${e(input.teamName || "N/A")}</div>
        <div style="margin-bottom:6px;"><strong>Registered Email:</strong> ${e(input.email)}</div>
        <div style="margin-bottom:6px;"><strong>Primary Phone:</strong> ${e(input.mobile || "N/A")}</div>
        ${input.altMobile ? `<div style="margin-bottom:6px;"><strong>Alternate Phone:</strong> ${e(input.altMobile)}</div>` : ""}
        ${input.domain ? `<div style="margin-bottom:6px;"><strong>Domain / Sector:</strong> ${e(input.domain)}</div>` : ""}
        <div style="margin-bottom:6px;"><strong>Location:</strong> ${e([input.city, input.state, input.country].filter(Boolean).join(", "))}</div>
        ${linkedin ? `<div style="margin-bottom:6px;"><strong>LinkedIn:</strong> <a href="${linkedin}" target="_blank" style="color:#2563eb;text-decoration:none;">${linkedin}</a></div>` : ""}
        ${input.aadharNumber ? `<div style="margin-bottom:6px;"><strong>Aadhaar Number:</strong> ${e(input.aadharNumber.replace(/(\d{4})(?=\d)/g, "$1 "))}</div>` : ""}
        ${input.panNumber ? `<div style="margin-bottom:6px;"><strong>PAN Number:</strong> ${e(input.panNumber)}</div>` : ""}
        ${report ? `<div style="margin-bottom:6px;"><strong>Project Report Document:</strong> <a href="${report}" target="_blank" style="color:#2563eb;font-weight:600;text-decoration:underline;">View Uploaded Report Document ↗</a></div>` : ""}
        ${
          input.projectDetails
            ? `<div style="margin-top:12px;padding-top:10px;border-top:1px dashed #cbd5e1;">
                 <div style="font-weight:700;color:#0f172a;margin-bottom:4px;">Project / Venture Summary:</div>
                 <p style="margin:0;color:#475569;font-size:12.5px;line-height:1.6;white-space:pre-wrap;">${e(input.projectDetails)}</p>
               </div>`
            : ""
        }
      </div>

      ${membersHtml}

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px;margin:20px 0;text-align:center;">
        <p style="color:#166534;font-size:14px;margin:0;font-weight:600;">Your registration has been successfully received. The ISF Committee will contact you with further summit schedule details.</p>
      </div>

      <p style="color:#94a3b8;font-size:11px;margin:0;border-top:1px solid #f1f5f9;padding-top:14px;text-align:center;">
        Startup Jathara 2026 · Organised by International Startup Foundation (ISF) &amp; GIET University.
      </p>
    </div>`;

  return { subject, html };
}
