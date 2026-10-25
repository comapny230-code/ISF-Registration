"use client";
import { useState, useRef, useMemo } from "react";

type CategoryId =
  | "startup_founder"
  | "student_innovator";

interface CategoryMeta {
  id: CategoryId;
  title: string;
  badge: string;
  trackCode: string;
  desc: string;
  teamLabel: string;
  themeColor: string;
  gradient: string;
  accentBg: string;
  borderColor: string;
  tag: string;
  passType: string;
  perks: Array<{ title: string; desc: string }>;
}

const CATEGORIES: CategoryMeta[] = [
  {
    id: "startup_founder",
    title: "Startup Leader",
    badge: "Startup Founders & Co-Founders",
    trackCode: "Track 01",
    desc: "Founders & startups with market-ready products, MVPs, or high-growth ventures seeking seed funding, angel roundtables & GCC connects.",
    teamLabel: "Startup / Company Name",
    themeColor: "#e87042",
    gradient: "linear-gradient(135deg, #c25022 0%, #e87042 50%, #d68c45 100%)",
    accentBg: "linear-gradient(135deg, rgba(232, 112, 66, 0.08) 0%, rgba(214, 140, 69, 0.04) 100%)",
    borderColor: "#e87042",
    tag: "₹1 Cr+ Pitch Stage · VC Speed Dating",
    passType: "FOUNDER · VIP ALL-ACCESS",
    perks: [
      {
        title: "₹1 Cr+ Pitch & Seed Arena",
        desc: "Compete for equity-free grants and venture incubation fast-track.",
      },
      {
        title: "1-on-1 VC Speed Dating",
        desc: "Private pitch slots with 50+ tier-1 institutional & angel funds.",
      },
      {
        title: "Exhibition Demo Kiosk & VIP Pass",
        desc: "Dedicated demo table in Startup Expo + access to founder networking dinners.",
      },
    ],
  },
  {
    id: "student_innovator",
    title: "Student Innovator",
    badge: "Student Innovators & College Labs",
    trackCode: "Track 02",
    desc: "Undergraduates, researchers & college teams showcasing working hardware/software tech prototypes, robotics, or scientific innovations.",
    teamLabel: "Project / Team Name",
    themeColor: "#143e30",
    gradient: "linear-gradient(135deg, #0d281e 0%, #143e30 50%, #256f57 100%)",
    accentBg: "linear-gradient(135deg, rgba(20, 62, 48, 0.08) 0%, rgba(37, 111, 87, 0.04) 100%)",
    borderColor: "#1b5341",
    tag: "Prototype Arena · Student Idea Grants",
    passType: "INNOVATOR · PROTOTYPE PASS",
    perks: [
      {
        title: "Prototype Demo Desk",
        desc: "Showcase working hardware & software prototypes to premier juries.",
      },
      {
        title: "Student Idea Grants",
        desc: "Eligible for prototype improvement grants, patent advice & fab lab access.",
      },
      {
        title: "Founder Mentorship Track",
        desc: "Masterclasses with serial tech founders, unicorn builders & industry chiefs.",
      },
    ],
  },
];

// Exact 9 Focus Sectors / Innovation Domains
const FOCUS_SECTORS = [
  "Agritech & Food Safety",
  "Defence/Aerospace & Deep Tech",
  "Life Sciences & Healthcare",
  "Infrastructure",
  "Clean Energy & Water Safety",
  "AI & Quantum Technology",
  "Fintech/Edutech/Tribaltech",
  "Women Empowerment & Social Inclusion",
  "Innovation",
];

export interface TeamMemberInput {
  id: string;
  name: string;
  photoUrl: string;
  phone: string;
  email: string;
}

// Client-side image compressor
function compressImageFile(file: File, maxWidth = 460, quality = 0.85): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Please select a valid image file (JPG, PNG, WEBP)."));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
        } else {
          if (height > maxWidth) {
            width = Math.round((width * maxWidth) / height);
            height = maxWidth;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("Failed to process image."));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file."));
    reader.readAsDataURL(file);
  });
}

// Universal LinkedIn / URL normalizer
export function normalizeLinkedInUrl(input: string): string {
  let val = (input || "").trim();
  if (!val) return "";
  if (/^https?:\/\//i.test(val)) return val;
  if (val.startsWith("//")) return `https:${val}`;
  if (/^([a-z0-9-]+\.)?linkedin\.com/i.test(val)) return `https://${val}`;
  if (/^in\/[a-zA-Z0-9_\-%\.]+/i.test(val)) return `https://www.linkedin.com/${val}`;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}/.test(val)) return `https://${val}`;
  const cleanUsername = val.replace(/^@/, "");
  return `https://www.linkedin.com/in/${cleanUsername}`;
}

// Universal E.164 phone normalizer
export function normalizeMobileNumber(input: string): string | null {
  if (!input) return null;
  let s = String(input).trim().replace(/[\s\-().]/g, "");
  if (!s) return null;

  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^[6-9]\d{9}$/.test(s)) return `+91${s}`;
  if (/^0[6-9]\d{9}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(s)) return `+${s}`;
  if (/^\d{10}$/.test(s)) return `+91${s}`;
  if (/^0\d{10}$/.test(s)) return `+91${s.slice(1)}`;
  if (/^91\d{10}$/.test(s)) return `+${s}`;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  if (/^[1-9]\d{7,14}$/.test(s)) return `+${s}`;
  return null;
}

export default function RegisterPage() {
  const [category, setCategory] = useState<CategoryId>("startup_founder");
  const [teamName, setTeamName] = useState("");
  const [fullName, setFullName] = useState("");
  const [leadPhoto, setLeadPhoto] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [altMobile, setAltMobile] = useState("");
  const [domain, setDomain] = useState("Agritech & Food Safety");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [country, setCountry] = useState("India");
  const [linkedinUrl, setLinkedinUrl] = useState("");
  const [projectDetails, setProjectDetails] = useState("");
  const [projectReportUrl, setProjectReportUrl] = useState("");
  const [projectReportFile, setProjectReportFile] = useState<{ name: string; dataUrl: string; size: string } | null>(null);
  const [aadharNumber, setAadharNumber] = useState("");
  const [panNumber, setPanNumber] = useState("");

  // Team members (1 to 5 members)
  const [members, setMembers] = useState<TeamMemberInput[]>([
    { id: "1", name: "", photoUrl: "", phone: "", email: "" },
  ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFormError(msg: string) {
    setError(msg);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 400, behavior: "smooth" });
    }
  }

  const [registered, setRegistered] = useState<{
    email: string;
    fullName: string;
    category: string;
    role: string;
    teamName: string;
    leadPhoto: string;
    domain?: string;
    projectDetails?: string;
    projectReportUrl?: string;
    aadharNumber?: string;
    panNumber?: string;
    linkedinUrl?: string;
    members: TeamMemberInput[];
  } | null>(null);

  const activeCategory = CATEGORIES.find((c) => c.id === category) || CATEGORIES[0];
  const isStartupLeader = category === "startup_founder";
  const isStudentInnovator = category === "student_innovator";
  const isStartupOrInnovator = isStartupLeader || isStudentInnovator;

  // Real-time word counter for ~200 words project details
  const projectWordCount = useMemo(() => {
    if (!projectDetails.trim()) return 0;
    return projectDetails.trim().split(/\s+/).filter(Boolean).length;
  }, [projectDetails]);

  // Aadhaar formatter (XXXX XXXX XXXX)
  function handleAadharChange(val: string) {
    const digits = val.replace(/\D/g, "").slice(0, 12);
    const formatted = digits.replace(/(\d{4})(?=\d)/g, "$1 ");
    setAadharNumber(formatted);
  }

  // PAN formatter (ABCDE1234F)
  function handlePanChange(val: string) {
    const clean = val.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 10);
    setPanNumber(clean);
  }

  // Project report file handler (PDF, DOCX, etc.)
  const reportFileInputRef = useRef<HTMLInputElement>(null);
  function handleReportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setError("Project report document must be under 20 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2) + " MB";
      setProjectReportFile({
        name: file.name,
        dataUrl: reader.result as string,
        size: sizeMb,
      });
      setError(null);
    };
    reader.onerror = () => setError("Failed to read report file.");
    reader.readAsDataURL(file);
  }

  // Real-time completion progress calculation
  const progressPercent = useMemo(() => {
    let score = 5;
    if (category) score += 10;
    if (teamName.trim()) score += 10;
    if (fullName.trim()) score += 10;
    if (projectDetails.trim()) score += 15;
    if (email.trim() && email.includes("@")) score += 10;
    if (mobile.trim()) score += 10;
    if (leadPhoto) score += 10;
    if (aadharNumber.trim().replace(/[\s-]/g, "").length === 12) score += 10;
    if (projectReportFile || projectReportUrl) score += 10;
    if (members.length > 0 && members[0].name.trim()) score += 10;
    return Math.min(score, 100);
  }, [category, teamName, fullName, projectDetails, email, mobile, leadPhoto, aadharNumber, projectReportFile, projectReportUrl, members]);


  // Lead photo upload handler
  const leadFileInputRef = useRef<HTMLInputElement>(null);
  async function handleLeadPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFile(file);
      setLeadPhoto(dataUrl);
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Failed to process photo.");
    }
  }

  // Member photo upload
  async function handleMemberPhotoChange(memberId: string, file: File) {
    try {
      const dataUrl = await compressImageFile(file);
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, photoUrl: dataUrl } : m))
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message || "Failed to process member photo.");
    }
  }

  // Add team member (max 5)
  function handleAddMember() {
    if (members.length >= 5) {
      setError("Maximum 5 team members are allowed per delegate team.");
      return;
    }
    const newId = String(Date.now());
    setMembers((prev) => [
      ...prev,
      { id: newId, name: "", photoUrl: "", phone: "", email: "" },
    ]);
  }

  // Remove team member (min 1)
  function handleRemoveMember(memberId: string) {
    if (members.length <= 1) {
      setError("At least one team member detail is required.");
      return;
    }
    setMembers((prev) => prev.filter((m) => m.id !== memberId));
  }

  // Update member field
  function handleMemberFieldChange(
    memberId: string,
    field: "name" | "phone" | "email",
    value: string
  ) {
    setMembers((prev) =>
      prev.map((m) => (m.id === memberId ? { ...m, [field]: value } : m))
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normEmail = email.trim().toLowerCase();
    if (!normEmail || !normEmail.includes("@")) {
      handleFormError("Please provide a valid official email address.");
      return;
    }
    if (!fullName.trim()) {
      handleFormError("Please enter your full name.");
      return;
    }

    if (isStartupOrInnovator) {
      if (!teamName.trim()) {
        handleFormError("Please enter your Startup / Project Team Name.");
        return;
      }
      if (!leadPhoto) {
        handleFormError("Please upload the Team Lead Photograph for summit pass accreditation.");
        return;
      }
      if (!mobile.trim()) {
        handleFormError("Please enter your Primary Phone Number.");
        return;
      }
      const normMobile = normalizeMobileNumber(mobile);
      if (!normMobile) {
        handleFormError("Please enter a valid Primary Phone Number (e.g. 10-digit mobile number or +91 98765 43210).");
        return;
      }
      setMobile(normMobile);

      if (!altMobile.trim()) {
        handleFormError("Please enter an Alternate Phone Number.");
        return;
      }
      if (!domain.trim()) {
        handleFormError("Please select a Focus Sector / Innovation Domain.");
        return;
      }
      if (!projectDetails.trim()) {
        handleFormError("Please enter your Project / Venture details (~200 words).");
        return;
      }
      if (!aadharNumber.trim()) {
        handleFormError("Please enter your 12-digit Aadhaar Card number.");
        return;
      }
      const cleanAadhar = aadharNumber.replace(/[\s-]/g, "");
      if (cleanAadhar.length !== 12 || !/^\d{12}$/.test(cleanAadhar)) {
        handleFormError("Please enter a valid 12-digit Aadhaar Card number (e.g. 1234 5678 9012).");
        return;
      }
      if (panNumber.trim()) {
        const cleanPan = panNumber.trim().toUpperCase();
        if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleanPan)) {
          handleFormError("Please enter a valid 10-character PAN Card number (e.g. ABCDE1234F) or leave blank.");
          return;
        }
      }
      if (!city.trim()) {
        handleFormError("Please enter your City.");
        return;
      }
      if (!state.trim()) {
        handleFormError("Please enter your State.");
        return;
      }
      if (!country.trim()) {
        handleFormError("Please enter your Country.");
        return;
      }

      const formattedLinkedin = normalizeLinkedInUrl(linkedinUrl);
      if (!formattedLinkedin) {
        handleFormError("Please enter your LinkedIn Profile / URL.");
        return;
      }
      setLinkedinUrl(formattedLinkedin);

      if (members.length === 0) {
        handleFormError("Please provide details for at least 1 team member (max 5 members).");
        return;
      }
      for (let i = 0; i < members.length; i++) {
        const m = members[i];
        if (!m.name.trim()) {
          handleFormError(`Please enter the full name for Member #${i + 1}.`);
          return;
        }
        if (!m.photoUrl) {
          handleFormError(`Please upload a photo for Member #${i + 1} (${m.name || "Member"}).`);
          return;
        }
        if (!m.phone.trim()) {
          handleFormError(`Please enter a phone number for Member #${i + 1} (${m.name}).`);
          return;
        }
        const normMemberPhone = normalizeMobileNumber(m.phone);
        if (!normMemberPhone) {
          handleFormError(`Please enter a valid phone number for Member #${i + 1} (${m.name}) (e.g. 10-digit mobile number or +91 98765 43210).`);
          return;
        }
        if (!m.email.trim() || !m.email.includes("@")) {
          handleFormError(`Please enter a valid email address for Member #${i + 1} (${m.name}).`);
          return;
        }
      }
    }

    setBusy(true);

    try {
      const finalLinkedin = normalizeLinkedInUrl(linkedinUrl);
      const finalMobile = normalizeMobileNumber(mobile) || mobile.trim();
      const finalAltMobile = normalizeMobileNumber(altMobile) || altMobile.trim();
      const formattedMembers = members.map((m) => ({
        ...m,
        phone: normalizeMobileNumber(m.phone) || m.phone.trim(),
      }));

      const res = await fetch("/v1/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          teamName: teamName.trim(),
          organisationName: null,
          fullName: fullName.trim(),
          photoUrl: leadPhoto || null,
          domain: domain.trim(),
          projectDetails: projectDetails.trim(),
          projectReport: projectReportFile ? projectReportFile.dataUrl : (projectReportUrl.trim() || null),
          aadharNumber: aadharNumber.trim() ? aadharNumber.replace(/[\s-]/g, "") : null,
          panNumber: panNumber.trim() ? panNumber.trim().toUpperCase() : null,
          city: city.trim(),
          state: state.trim(),
          country: country.trim(),
          linkedinUrl: finalLinkedin || null,
          members: formattedMembers,
          email: normEmail,
          mobile: finalMobile,
          altMobile: finalAltMobile || null,
          password,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMsg = data.detail || data.message || "Registration failed. Please verify your details.";
        handleFormError(errorMsg);
        setBusy(false);
        return;
      }

      setRegistered({
        email: normEmail,
        fullName: fullName.trim(),
        category: activeCategory.title,
        role: data.role || "startup_team_leader",
        teamName: teamName.trim(),
        leadPhoto,
        domain: domain.trim(),
        projectDetails: projectDetails.trim(),
        projectReportUrl: data.user?.projectReportUrl || (projectReportFile ? projectReportFile.name : (projectReportUrl.trim() || undefined)),
        aadharNumber: aadharNumber.trim() || undefined,
        panNumber: panNumber.trim() ? panNumber.trim().toUpperCase() : undefined,
        linkedinUrl: finalLinkedin || undefined,
        members: formattedMembers,
      });

      if (typeof window !== "undefined") {
        window.scrollTo({ top: 60, behavior: "smooth" });
      }
    } catch (err: any) {
      console.error("[REGISTRATION FATAL]", err);
      handleFormError(err.message || "An unexpected network or server error occurred.");
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------- Confirmed State View
  if (registered) {
    return (
      <div className="confirmed-view-wrap">
        <style jsx>{`
          .confirmed-view-wrap {
            max-width: 820px;
            margin: 30px auto 60px;
            padding: 0 16px;
          }
          .success-badge-card {
            background: #ffffff;
            border-radius: 28px;
            padding: 40px 32px;
            text-align: center;
            border: 1px solid #e8dfd3;
            box-shadow: 0 20px 50px -10px rgba(20, 62, 48, 0.12);
            position: relative;
            overflow: hidden;
          }
          .success-badge-card::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 6px;
            background: linear-gradient(90deg, #e87042, #d6b25e, #143e30);
          }
          .check-icon-circle {
            width: 72px;
            height: 72px;
            background: linear-gradient(135deg, #143e30 0%, #256f57 100%);
            color: #ffffff;
            font-size: 32px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
            margin: 0 auto 18px;
            box-shadow: 0 10px 24px -6px rgba(20, 62, 48, 0.35);
          }
          .avatar-preview-img {
            width: 96px;
            height: 104px;
            border-radius: 18px;
            object-fit: cover;
            border: 3px solid #ffffff;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
            margin: 0 auto 16px;
            display: block;
          }
          .confirmed-title {
            font-family: var(--font-serif);
            font-size: clamp(24px, 4vw, 32px);
            font-weight: 800;
            color: #1c1917;
            margin: 0 0 8px;
          }
          .confirmed-sub {
            font-size: 15px;
            color: #57534e;
            margin: 0 auto 24px;
            line-height: 1.55;
            max-width: 600px;
          }
          .status-ribbon {
            background: #faf7f2;
            border: 1px solid #e8dfd3;
            border-radius: 14px;
            padding: 12px 18px;
            margin-bottom: 24px;
            display: inline-flex;
            align-items: center;
            gap: 10px;
            font-size: 13.5px;
            color: #143e30;
            font-weight: 700;
          }
          .info-table-box {
            background: #fcfbf8;
            border: 1px solid #e8dfd3;
            border-radius: 20px;
            padding: 22px;
            margin-bottom: 26px;
            text-align: left;
          }
          .info-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 10px 0;
            border-bottom: 1px solid #ede7db;
            font-size: 14px;
          }
          .info-row:last-child {
            border-bottom: none;
          }
          .info-label {
            color: #78716c;
            font-weight: 600;
          }
          .info-val {
            color: #1c1917;
            font-weight: 700;
          }
          .members-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 13px;
          }
          .members-table th {
            background: #ede7db;
            padding: 8px 10px;
            text-align: left;
            color: #44403c;
            font-weight: 700;
            border-radius: 6px;
          }
          .members-table td {
            padding: 9px 10px;
            border-top: 1px solid #e8dfd3;
          }
          .members-table-wrap {
            width: 100%;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }
          .btn-login-cta {
            background: linear-gradient(135deg, #e87042 0%, #c25022 100%);
            color: #ffffff;
            border: none;
            padding: 15px 28px;
            border-radius: 14px;
            font-size: 15px;
            font-weight: 700;
            cursor: pointer;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            box-shadow: 0 10px 24px -5px rgba(232, 112, 66, 0.4);
            transition: all 0.2s ease;
          }
          .btn-login-cta:hover {
            transform: translateY(-2px);
            box-shadow: 0 14px 30px -4px rgba(232, 112, 66, 0.5);
          }
          @media (max-width: 640px) {
            .confirmed-view-wrap {
              padding: 0 10px;
              margin: 16px auto 30px;
            }
            .success-badge-card {
              padding: 24px 14px;
              border-radius: 20px;
            }
            .info-table-box {
              padding: 14px 12px;
              border-radius: 14px;
            }
            .info-row {
              flex-direction: column;
              align-items: flex-start;
              gap: 4px;
              padding: 8px 0;
            }
            .info-val {
              word-break: break-word;
            }
          }
        `}</style>

        <div className="success-badge-card">
          <div className="check-icon-circle">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          {registered.leadPhoto && (
            <img
              src={registered.leadPhoto}
              alt="Team Lead"
              className="avatar-preview-img"
            />
          )}
          <h1 className="confirmed-title">Summit Accreditation Confirmed!</h1>
          <p className="confirmed-sub">
            Your {registered.category} credentials have been verified and saved to the official <strong>ISF Startup Jathara 2026</strong> summit registry.
          </p>

          <div className="status-ribbon">
            <span>Pass Type: <strong>{activeCategory.passType}</strong> · 18–20 Dec 2026</span>
          </div>

          <div className="info-table-box">
            {registered.teamName && (
              <div className="info-row">
                <span className="info-label">
                  {isStudentInnovator ? "Project / Team Name:" : "Startup / Company Name:"}
                </span>
                <span className="info-val">{registered.teamName}</span>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">Lead Founder / Innovator:</span>
              <span className="info-val">{registered.fullName}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Official Email:</span>
              <span className="info-val">{registered.email}</span>
            </div>
            {registered.domain && (
              <div className="info-row">
                <span className="info-label">Focus Sector:</span>
                <span className="info-val">{registered.domain}</span>
              </div>
            )}
            {registered.aadharNumber && (
              <div className="info-row">
                <span className="info-label">Aadhaar Card:</span>
                <span className="info-val">{registered.aadharNumber}</span>
              </div>
            )}
            {registered.panNumber && (
              <div className="info-row">
                <span className="info-label">PAN Card:</span>
                <span className="info-val">{registered.panNumber}</span>
              </div>
            )}
            {registered.projectReportUrl && (
              <div className="info-row">
                <span className="info-label">Project Report:</span>
                <span className="info-val">
                  {registered.projectReportUrl.startsWith("http") ? (
                    <a href={registered.projectReportUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#e87042", fontWeight: 700, textDecoration: "underline" }}>
                      View Uploaded Document ↗
                    </a>
                  ) : (
                    <span>{registered.projectReportUrl}</span>
                  )}
                </span>
              </div>
            )}
            {registered.projectDetails && (
              <div style={{ marginTop: 12, padding: "12px 14px", background: "#f5eee4", borderRadius: 10, textAlign: "left" }}>
                <span className="info-label" style={{ display: "block", marginBottom: 4, fontWeight: 700 }}>
                  Project / Venture Details:
                </span>
                <p style={{ margin: 0, fontSize: 13, color: "#44403c", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
                  {registered.projectDetails}
                </p>
              </div>
            )}
            <div className="info-row">
              <span className="info-label">Accreditation Track:</span>
              <span className="info-val" style={{ color: activeCategory.themeColor }}>{registered.category}</span>
            </div>
            <div className="info-row">
              <span className="info-label">Summit Pass Status:</span>
              <span className="info-val" style={{ color: "#143e30" }}>Active · RFID / Badge Ready</span>
            </div>

            {registered.members.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <span className="info-label" style={{ fontWeight: 700, color: "#1c1917", display: "block", marginBottom: 6 }}>
                  Accredited Team Members ({registered.members.length} / 5):
                </span>
                <div className="members-table-wrap">
                  <table className="members-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Photo</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Phone</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registered.members.map((m, idx) => (
                        <tr key={m.id || idx}>
                          <td>{idx + 1}</td>
                          <td>
                            {m.photoUrl ? (
                              <img
                                src={m.photoUrl}
                                alt={m.name}
                                style={{ width: 30, height: 30, borderRadius: 6, objectFit: "cover" }}
                              />
                            ) : (
                              <span style={{ fontSize: 10, color: "#a8a29e", fontWeight: 600 }}>N/A</span>
                            )}
                          </td>
                          <td style={{ fontWeight: 600 }}>{m.name}</td>
                          <td style={{ color: "#e87042" }}>{m.email}</td>
                          <td>{m.phone}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <div style={{ background: "#faf7f2", border: "1.5px solid #e8dfd3", borderRadius: 16, padding: "16px 20px", marginBottom: 24, textAlign: "left" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1c1917" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <strong style={{ color: "#1c1917", fontSize: 14.5 }}>Registration Complete</strong>
            </div>
            <p style={{ margin: 0, fontSize: 13.5, color: "#57534e", lineHeight: 1.5 }}>
              Your registration details have been saved. You will be contacted by the ISF team with further details about your summit pass and schedule.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- Interactive Main Registration Form
  return (
    <div className="jathara-portal-page">
      <style jsx>{`
        .jathara-portal-page {
          width: 100%;
        }

        /* Hero Banner Section */
        .summit-hero-banner {
          position: relative;
          padding: 48px 20px 32px;
          text-align: center;
          max-width: 960px;
          margin: 0 auto;
        }
        .hero-content {
          position: relative;
          z-index: 10;
          max-width: 860px;
          margin: 0 auto;
        }
        .hero-eyebrow-pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          background: rgba(255, 255, 255, 0.88);
          border: 1px solid rgba(226, 222, 214, 0.9);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          padding: 6px 18px;
          border-radius: 999px;
          font-family: var(--font-mono);
          font-size: 11.5px;
          font-weight: 700;
          letter-spacing: 0.05em;
          text-transform: uppercase;
          color: #143e30;
          margin-bottom: 16px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.03);
        }
        .hero-h1 {
          font-family: var(--font-serif);
          font-size: clamp(28px, 4.8vw, 44px);
          font-weight: 900;
          color: #1c1917;
          letter-spacing: -0.025em;
          line-height: 1.15;
          margin: 0 0 10px;
        }
        .hero-terracotta {
          color: #e87042;
        }
        .hero-tagline {
          font-family: var(--font-serif);
          font-size: clamp(16px, 2.2vw, 20px);
          font-weight: 600;
          color: #143e30;
          margin: 0 0 10px;
        }
        .hero-lead {
          font-size: 14px;
          color: #57534e;
          max-width: 660px;
          margin: 0 auto;
          line-height: 1.6;
        }

        /* Main Registration Container */
        .portal-form-container {
          max-width: 1140px;
          margin: 20px auto 60px;
          padding: 0 16px;
          position: relative;
          z-index: 20;
        }

        .portal-card-main {
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
          border-radius: 28px;
          padding: 36px 32px;
          border: 1px solid rgba(228, 220, 206, 0.85);
          box-shadow: 0 20px 48px -12px rgba(20, 62, 48, 0.07), 0 1px 3px rgba(0, 0, 0, 0.03);
        }

        /* Progress Completion Bar */
        .progress-box {
          background: #faf7f2;
          border: 1px solid #e8dfd3;
          border-radius: 16px;
          padding: 14px 20px;
          display: flex;
          align-items: center;
          gap: 18px;
          margin-bottom: 28px;
        }
        .progress-meta-col {
          flex: 1;
        }
        .progress-title-flex {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
          font-weight: 800;
          color: #143e30;
          letter-spacing: 0.04em;
          margin-bottom: 6px;
          font-family: var(--font-mono);
        }
        .progress-bg-track {
          width: 100%;
          height: 8px;
          background: #ede7db;
          border-radius: 999px;
          overflow: hidden;
        }
        .progress-bar-fill {
          height: 100%;
          border-radius: 999px;
          background: linear-gradient(90deg, #e87042 0%, #d6b25e 50%, #143e30 100%);
          transition: width 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .progress-chip {
          font-size: 11.5px;
          font-weight: 800;
          color: #e87042;
          background: #faeee8;
          border: 1px solid #f5dfce;
          padding: 5px 12px;
          border-radius: 10px;
          font-family: var(--font-mono);
          white-space: nowrap;
        }

        /* Section Headings */
        .step-heading-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin: 32px 0 18px;
          padding-bottom: 12px;
          border-bottom: 1px solid #ede7db;
        }
        .step-heading-bar:first-of-type {
          margin-top: 0;
        }
        .step-heading-title {
          font-family: var(--font-serif);
          font-size: 18px;
          font-weight: 800;
          color: #103327;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .step-tag-pill {
          font-size: 11.5px;
          font-weight: 700;
          color: #143e30;
          background: #f7f4ec;
          border: 1px solid #e2d8c7;
          padding: 4px 10px;
          border-radius: 8px;
          font-family: var(--font-mono);
        }

        /* STEP 1: Track Cards (Exact Netlify Sector Card style) */
        .tracks-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 20px;
          margin-bottom: 24px;
        }
        .track-card {
          background: #ffffff;
          border-radius: 24px;
          padding: 24px 20px;
          border: 1.5px solid #e4dcce;
          cursor: pointer;
          transition: all 0.28s cubic-bezier(0.4, 0, 0.2, 1);
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          text-align: left;
          position: relative;
          overflow: hidden;
          box-shadow: 0 4px 18px -4px rgba(20, 62, 48, 0.05);
        }
        .track-card::before {
          content: "";
          position: absolute;
          inset-x: 0;
          top: 0;
          height: 3px;
          background: transparent;
          transition: background 0.3s ease;
        }
        .track-card:hover {
          transform: translateY(-3px);
          border-color: #be9740;
          box-shadow: 0 16px 36px -8px rgba(20, 62, 48, 0.12);
        }
        .track-card.active {
          border-color: var(--active-border);
          background: var(--active-bg);
          box-shadow: 0 16px 40px -10px var(--active-glow);
          transform: translateY(-2px);
        }
        .track-card.active::before {
          background: linear-gradient(90deg, transparent, var(--active-border), transparent);
        }
        .track-top-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .track-index-pill {
          width: 32px;
          height: 32px;
          border-radius: 10px;
          background: #faf7f2;
          color: #103327;
          border: 1px solid #e8dfd3;
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 800;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .track-card.active .track-index-pill {
          background: var(--active-border);
          color: #ffffff;
          border-color: var(--active-border);
        }
        .track-code-pill {
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 999px;
          background: #f7f4ec;
          color: #143e30;
          border: 1px solid #e2d8c7;
        }
        .track-card.active .track-code-pill {
          background: var(--active-border);
          color: #ffffff;
          border-color: var(--active-border);
        }
        .track-title {
          font-family: var(--font-serif);
          font-size: 18px;
          font-weight: 800;
          color: #103327;
          margin: 0 0 6px;
          line-height: 1.25;
        }
        .track-badge-sub {
          font-size: 11.5px;
          font-weight: 700;
          color: #e87042;
          margin: 0 0 8px;
        }
        .track-desc {
          font-size: 12.5px;
          color: #55635e;
          line-height: 1.5;
          margin: 0 0 16px;
        }
        .track-tag-badge {
          font-size: 11px;
          font-weight: 700;
          padding: 5px 10px;
          border-radius: 8px;
          background: #faf7f2;
          border: 1px solid #ede7db;
          color: #1c1917;
          display: inline-block;
          margin-top: auto;
        }
        .track-card.active .track-tag-badge {
          border-color: var(--active-border);
          color: var(--active-border);
          background: #ffffff;
        }

        /* Track Dynamic Perks Matrix (Clean Minimal Numbered Cards) */
        .perks-strip-matrix {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 14px;
          margin-bottom: 30px;
          padding: 16px;
          border-radius: 20px;
          background: rgba(250, 247, 242, 0.75);
          border: 1px solid rgba(223, 214, 196, 0.8);
          backdrop-filter: blur(8px);
        }
        .perk-card-box {
          background: rgba(255, 255, 255, 0.92);
          border-radius: 14px;
          padding: 14px 16px;
          border: 1px solid rgba(232, 223, 211, 0.9);
          display: flex;
          gap: 12px;
          align-items: flex-start;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
        }
        .perk-number-badge {
          width: 26px;
          height: 26px;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: 800;
          flex-shrink: 0;
          background: #faeee8;
          color: #c25022;
          font-family: var(--font-mono);
        }
        .perk-text-wrap h4 {
          margin: 0 0 3px;
          font-family: var(--font-serif);
          font-size: 13.5px;
          font-weight: 700;
          color: #1c1917;
        }
        .perk-text-wrap p {
          margin: 0;
          font-size: 11.5px;
          color: #57534e;
          line-height: 1.45;
        }

        /* Two-Column Layout: Form Fields + Live Summit Badge Mockup */
        .form-and-badge-grid {
          display: grid;
          grid-template-columns: 1fr 310px;
          gap: 28px;
          align-items: start;
        }

        /* Form Subcards (Frosted Glass) */
        .form-panel-card {
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(10px);
          border: 1px solid #e8dfd3;
          border-radius: 20px;
          padding: 24px;
          margin-bottom: 22px;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
        }
        .panel-heading {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 18px;
        }
        .panel-badge {
          font-size: 11.5px;
          font-weight: 700;
          padding: 4px 10px;
          border-radius: 999px;
          display: inline-block;
          font-family: var(--font-mono);
          background: #f7f4ec;
          color: #143e30;
          border: 1px solid #e2d8c7;
        }
        .panel-title {
          font-family: var(--font-serif);
          font-size: 14.5px;
          font-weight: 700;
          color: #1c1917;
        }

        /* Inputs & Form Groups (Clean minimal styling) */
        .form-grid-fields {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }
        .field-full-width {
          grid-column: 1 / -1;
        }
        .form-group-item {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .form-label-row {
          font-size: 12.5px;
          font-weight: 700;
          color: #292524;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .field-req-mark {
          color: #c25022;
          font-weight: bold;
        }
        .input-icon-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
        }
        .input-text-ctrl {
          width: 100%;
          padding: 11px 14px;
          border-radius: 12px;
          border: 1.5px solid #dfd6c4;
          font-size: 13.5px;
          color: #1c1917;
          outline: none;
          background: rgba(255, 255, 255, 0.96);
          transition: border-color 0.2s ease, box-shadow 0.2s ease;
          box-sizing: border-box;
          font-family: var(--font-sans);
        }
        .input-text-ctrl:focus {
          border-color: #e87042;
          box-shadow: 0 0 0 3px rgba(232, 112, 66, 0.15);
        }
        .btn-pwd-peek {
          position: absolute;
          right: 12px;
          background: none;
          border: none;
          color: #57534e;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        /* Password Strength Meter */
        .strength-meter-row {
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .strength-bars-track {
          display: flex;
          gap: 4px;
          flex: 1;
        }
        .strength-bar-unit {
          height: 4px;
          border-radius: 2px;
          flex: 1;
          background: #ede7db;
          transition: background 0.3s;
        }
        .strength-feedback-text {
          font-size: 11px;
          font-weight: 700;
        }

        /* Live Summit Pass Badge Mockup (Right Column) */
        .live-badge-container {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(12px);
          border: 2px solid #dfd6c4;
          border-radius: 24px;
          padding: 22px 18px;
          box-shadow: 0 14px 34px -8px rgba(20, 62, 48, 0.08);
          text-align: center;
          position: sticky;
          top: 80px;
        }
        .badge-slot-hanger {
          width: 50px;
          height: 9px;
          background: #78716c;
          border-radius: 5px;
          margin: 0 auto 12px;
        }
        .badge-summit-header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 11px;
          font-weight: 900;
          font-family: var(--font-serif);
          color: #103327;
          letter-spacing: 0.05em;
          margin-bottom: 14px;
        }
        .badge-photo-target {
          width: 96px;
          height: 104px;
          border-radius: 16px;
          background: #f7f4ec;
          border: 2px dashed #be9740;
          margin: 0 auto 14px;
          overflow: hidden;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .badge-photo-target:hover {
          border-color: #e87042;
          transform: scale(1.02);
        }
        .badge-photo-render {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        .badge-attendee-name {
          font-family: var(--font-serif);
          font-size: 16px;
          font-weight: 800;
          color: #1c1917;
          margin: 0 0 2px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .badge-company-name {
          font-size: 12px;
          color: #57534e;
          margin: 0 0 10px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .badge-category-strip {
          font-size: 10.5px;
          font-weight: 800;
          padding: 6px 12px;
          border-radius: 8px;
          color: #ffffff;
          background: var(--badge-accent);
          margin-bottom: 12px;
          letter-spacing: 0.04em;
          font-family: var(--font-mono);
        }
        .badge-photo-btn {
          background: #f7f4ec;
          color: #1c1917;
          border: 1px solid #dfd6c4;
          padding: 7px 14px;
          border-radius: 10px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          width: 100%;
          margin-bottom: 12px;
          transition: all 0.2s;
        }
        .badge-photo-btn:hover {
          background: #ede7db;
        }
        .badge-barcode-pattern {
          font-family: monospace;
          font-size: 13px;
          color: #a8a29e;
          letter-spacing: 3px;
          border-top: 1px dashed #dfd6c4;
          padding-top: 8px;
        }
        .badge-footer-date {
          font-size: 10px;
          color: #78716c;
          font-weight: 700;
          display: block;
          margin-top: 4px;
          letter-spacing: 0.05em;
        }

        /* STEP 3: Multi-Member Cards (Startups & Students) */
        .team-members-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
          margin-bottom: 24px;
        }
        .member-form-card {
          background: rgba(255, 255, 255, 0.92);
          backdrop-filter: blur(10px);
          border: 1.5px solid #e8dfd3;
          border-radius: 18px;
          padding: 20px;
          transition: all 0.2s ease;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
        }
        .member-form-card:hover {
          border-color: #dfd6c4;
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.04);
        }
        .member-card-title-bar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 14px;
        }
        .member-number-badge {
          background: #faf7f2;
          color: #103327;
          font-size: 11.5px;
          font-weight: 700;
          padding: 3px 10px;
          border-radius: 6px;
          border: 1px solid #e8dfd3;
          font-family: var(--font-mono);
        }
        .btn-delete-member {
          background: #faeee8;
          border: 1px solid #f5dfce;
          color: #c25022;
          font-size: 11.5px;
          font-weight: 600;
          padding: 3px 10px;
          border-radius: 6px;
          cursor: pointer;
        }
        .member-row-layout {
          display: flex;
          gap: 18px;
          align-items: flex-start;
        }
        .member-photo-pick {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          width: 80px;
          flex-shrink: 0;
        }
        .member-avatar-square {
          width: 72px;
          height: 72px;
          border-radius: 14px;
          background: #faf7f2;
          border: 1.5px dashed #be9740;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          cursor: pointer;
          transition: border-color 0.2s;
        }
        .member-avatar-square:hover {
          border-color: #e87042;
        }
        .member-inputs-flex {
          flex: 1;
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
          gap: 12px;
        }
        .btn-add-team-slot {
          background: #ffffff;
          border: 2px dashed #e87042;
          color: #e87042;
          padding: 13px 20px;
          border-radius: 14px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: all 0.2s ease;
        }
        .btn-add-team-slot:hover:not(:disabled) {
          background: #faeee8;
          transform: translateY(-1px);
        }
        .btn-add-team-slot:disabled {
          border-color: #dfd6c4;
          color: #a8a29e;
          cursor: not-allowed;
        }

        /* Trust & Security Banner */
        .trust-seal-box {
          background: rgba(242, 247, 244, 0.85);
          backdrop-filter: blur(8px);
          border: 1px solid #c8d1cd;
          border-radius: 16px;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          gap: 14px;
          margin: 18px 0 24px;
        }
        .trust-seal-head {
          font-family: var(--font-serif);
          font-size: 13.5px;
          font-weight: 700;
          color: #103327;
          margin: 0;
        }
        .trust-seal-text {
          font-size: 11.5px;
          color: #256f57;
          margin: 2px 0 0;
          line-height: 1.45;
        }

        /* Error Notification */
        .error-alert-box {
          background: #faeee8;
          border: 1px solid #f5dfce;
          color: #c25022;
          border-radius: 14px;
          padding: 13px 18px;
          font-size: 13.5px;
          font-weight: 600;
          margin-bottom: 20px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        /* Grand Submit CTA */
        .btn-submit-summit {
          width: 100%;
          background: linear-gradient(135deg, #e87042 0%, #d95d2c 50%, #c25022 100%);
          color: #ffffff;
          border: none;
          padding: 17px 30px;
          border-radius: 16px;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          transition: all 0.25s ease;
          box-shadow: 0 10px 25px -5px rgba(232, 112, 66, 0.4);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .btn-submit-summit:hover:not(:disabled) {
          transform: translateY(-2px);
          box-shadow: 0 14px 32px -4px rgba(232, 112, 66, 0.5);
        }
        .btn-submit-summit:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        @media (max-width: 1040px) {
          .form-and-badge-grid {
            grid-template-columns: 1fr;
            gap: 24px;
          }
          .badge-preview-column {
            width: 100%;
            max-width: 320px;
            margin: 0 auto 24px;
          }
          .live-badge-container {
            position: static;
            max-width: 320px;
            width: 100%;
            margin: 0 auto;
          }
          .perks-strip-matrix {
            grid-template-columns: 1fr;
            gap: 10px;
          }
        }

        @media (max-width: 768px) {
          .tracks-grid {
            grid-template-columns: 1fr;
            gap: 14px;
          }
          .form-grid-fields {
            grid-template-columns: 1fr;
            gap: 14px;
          }
          .summit-hero-banner {
            padding: 32px 14px 20px;
          }
          .hero-h1 {
            font-size: clamp(24px, 5.5vw, 34px);
          }
          .hero-tagline {
            font-size: 16px;
          }
          .hero-lead {
            font-size: 13px;
          }
          .portal-form-container {
            padding: 0 12px;
            margin: 14px auto 36px;
          }
          .portal-card-main {
            padding: 24px 16px;
            border-radius: 20px;
          }
          .form-panel-card {
            padding: 18px 14px;
            border-radius: 16px;
          }
          .progress-box {
            flex-direction: column;
            align-items: stretch;
            gap: 10px;
            padding: 12px 16px;
          }
          .step-heading-bar {
            flex-wrap: wrap;
            gap: 8px;
          }
          .step-heading-title {
            font-size: 16px;
          }
        }

        @media (max-width: 520px) {
          .portal-form-container {
            padding: 0 8px;
            margin: 10px auto 30px;
          }
          .portal-card-main {
            padding: 18px 12px;
            border-radius: 16px;
          }
          .form-panel-card {
            padding: 14px 10px;
            border-radius: 14px;
          }
          .track-card {
            padding: 18px 14px;
            border-radius: 18px;
          }
          .member-row-layout {
            flex-direction: column;
            align-items: center;
            gap: 12px;
          }
          .member-photo-pick {
            width: 100%;
          }
          .member-inputs-flex {
            width: 100%;
            grid-template-columns: 1fr;
          }
          .trust-seal-box {
            flex-direction: column;
            text-align: center;
            padding: 12px;
          }
          .btn-submit-summit {
            padding: 14px 18px;
            font-size: 14.5px;
          }
        }
      `}</style>

      {/* Hero Header Section */}
      <section className="summit-hero-banner" aria-label="Summit Introduction and Official Accreditation">
        <div className="hero-content">
          <div className="hero-eyebrow-pill">
            GIET University · Gunupur, Odisha · 18–20 December 2026
          </div>

          <h1 className="hero-h1">
            ISF STARTUP JATHARA <span className="hero-terracotta">2026</span>
          </h1>

          <p className="hero-tagline">Where Grassroots Bharat Meets Venture Capital.</p>

          <p className="hero-lead">
            Official Summit Accreditation & Registration Portal for startup leaders and student innovators. Pitch in ₹1 Cr+ grant arenas, meet 50+ tier-1 VCs & GCC leaders, and secure your official summit pass.
          </p>
        </div>
      </section>

      {/* Main Registration Portal Form Card */}
      <div className="portal-form-container">
        <div className="portal-card-main">
          {/* Real-time Completion Progress Bar */}
          <div className="progress-box">
            <div className="progress-meta-col">
              <div className="progress-title-flex">
                <span>ACCREDITATION PROGRESS</span>
                <span>{progressPercent}% COMPLETE</span>
              </div>
              <div className="progress-bg-track">
                <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
              </div>
            </div>
            <span className="progress-chip">
              {progressPercent >= 100 ? "Ready to Submit" : `${100 - progressPercent}% Remaining`}
            </span>
          </div>

          {error && (
            <div className="error-alert-box" role="alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c25022" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            {/* STEP 1: Accreditation Track Selection */}
            <div className="step-heading-bar">
              <span className="step-heading-title">
                Step 1 · Choose Accreditation Track
              </span>
              <span className="step-tag-pill">Role Selection</span>
            </div>

            <div className="tracks-grid">
              {CATEGORIES.map((cat, idx) => {
                const isSelected = category === cat.id;
                return (
                  <div
                    key={cat.id}
                    className={`track-card ${isSelected ? "active" : ""}`}
                    style={
                      {
                        "--active-border": cat.borderColor,
                        "--active-bg": cat.accentBg,
                        "--active-glow": `${cat.themeColor}33`,
                      } as React.CSSProperties
                    }
                    onClick={() => setCategory(cat.id)}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <div className="track-top-row">
                        <span className="track-index-pill">0{idx + 1}</span>
                        <span className="track-code-pill">
                          {isSelected ? `${cat.trackCode} · Selected` : cat.trackCode}
                        </span>
                      </div>
                      <h3 className="track-title">{cat.title}</h3>
                      <p className="track-badge-sub">{cat.badge}</p>
                      <p className="track-desc">{cat.desc}</p>
                    </div>
                    <span className="track-tag-badge">{cat.tag}</span>
                  </div>
                );
              })}
            </div>

            {/* Dynamic Perks Matrix based on activeCategory */}
            <div className="perks-strip-matrix">
              {activeCategory.perks.map((p, idx) => (
                <div key={idx} className="perk-card-box">
                  <span className="perk-number-badge">0{idx + 1}</span>
                  <div className="perk-text-wrap">
                    <h4>{p.title}</h4>
                    <p>{p.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* STEP 2: Profile Credentials + Real-Time Badge Mockup */}
            <div className="step-heading-bar">
              <span className="step-heading-title">
                Step 2 · {isStudentInnovator ? "Project & Team Lead Credentials" : "Lead Founder & Venture Credentials"}
              </span>
              <span className="step-tag-pill">Identity & Pass</span>
            </div>

            <div className="form-and-badge-grid">
              {/* Left Column: Form Subcards */}
              <div className="form-inputs-column">
                {/* Subcard 1: Organization & Identity */}
                <div className="form-panel-card">
                  <div className="panel-heading">
                    <span className="panel-badge">Organization & Identity</span>
                    <span className="panel-title">Institutional details</span>
                  </div>

                  <div className="form-grid-fields">
                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="teamName">
                        <span>{activeCategory.teamLabel} <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="teamName"
                          className="input-text-ctrl"
                          type="text"
                          required
                          placeholder={
                            isStartupLeader
                              ? "e.g. AgriSmart Robotics Pvt Ltd"
                              : "e.g. GIET AI Innovation Lab"
                          }
                          value={teamName}
                          onChange={(e) => setTeamName(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="fullName">
                        <span>Team Lead Full Name <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="fullName"
                          className="input-text-ctrl"
                          type="text"
                          required
                          placeholder="e.g. Akshat Rajpati"
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group-item field-full-width">
                        <label className="form-label-row" htmlFor="domain">
                          <span>Focus Sector / Innovation Domain <span className="field-req-mark">*</span></span>
                        </label>
                        <div className="input-icon-wrapper">
                          <select
                            id="domain"
                            className="input-text-ctrl"
                            value={domain}
                            onChange={(e) => setDomain(e.target.value)}
                            required
                          >
                            {FOCUS_SECTORS.map((d) => (
                              <option key={d} value={d}>
                                {d}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                  </div>
                </div>

                {/* Subcard: Project Details & Report */}
                <div className="form-panel-card">
                  <div className="panel-heading">
                    <span className="panel-badge">Project & Innovation Summary</span>
                    <span className="panel-title">{isStudentInnovator ? "Prototype Details & Report" : "Venture Details & Deck"}</span>
                  </div>

                  <div className="form-grid-fields">
                    <div className="form-group-item field-full-width">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <label className="form-label-row" htmlFor="projectDetails" style={{ margin: 0 }}>
                          <span>Project Details (~200 words) <span className="field-req-mark">*</span></span>
                        </label>
                        <span style={{
                          fontSize: "11px",
                          fontWeight: 700,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: projectWordCount >= 180 && projectWordCount <= 220 ? "#ecfdf5" : "#f5f5f4",
                          color: projectWordCount >= 180 && projectWordCount <= 220 ? "#047857" : "#78716c",
                          border: "1px solid #e7e5e4"
                        }}>
                          {projectWordCount} / ~200 words
                        </span>
                      </div>
                      <textarea
                        id="projectDetails"
                        className="input-text-ctrl"
                        rows={5}
                        required
                        placeholder={
                          isStudentInnovator
                            ? "Describe your project problem statement, technical innovation, working prototype status, lab/mentor affiliation, and potential real-world impact in around 200 words..."
                            : "Describe your startup problem statement, proprietary solution, market traction, business model, and fundraising/growth goals in around 200 words..."
                        }
                        value={projectDetails}
                        onChange={(e) => setProjectDetails(e.target.value)}
                        style={{ resize: "vertical", minHeight: "120px", lineHeight: "1.5", fontSize: "13.5px" }}
                      />
                      <span style={{ fontSize: "11.5px", color: "#78716c", marginTop: "4px" }}>
                        Provide a clear description of your innovation (~200 words) for the summit jury and investors.
                      </span>
                    </div>

                    <div className="form-group-item field-full-width">
                      <label className="form-label-row">
                        <span>Project Report / Pitch Document</span>
                      </label>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,.ppt,.pptx,image/*"
                        ref={reportFileInputRef}
                        style={{ display: "none" }}
                        onChange={handleReportFileChange}
                      />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() => reportFileInputRef.current?.click()}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "9px 16px",
                            background: "#faf7f2",
                            border: "1.5px dashed #d6b25e",
                            borderRadius: 10,
                            color: "#1c1917",
                            fontSize: "13px",
                            fontWeight: 600,
                            cursor: "pointer",
                            transition: "all 0.2s"
                          }}
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="17 8 12 3 7 8" />
                            <line x1="12" y1="3" x2="12" y2="15" />
                          </svg>
                          {projectReportFile ? "Change Report Document" : "Upload Project Report / Deck (Max 20MB)"}
                        </button>
                        {projectReportFile && (
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "6px 12px", borderRadius: 8, fontSize: "12px", color: "#065f46" }}>
                            <span>📄 {projectReportFile.name} ({projectReportFile.size})</span>
                            <button
                              type="button"
                              onClick={() => setProjectReportFile(null)}
                              style={{ background: "none", border: "none", color: "#b91c1c", fontWeight: 700, cursor: "pointer", padding: 0 }}
                              title="Remove file"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <input
                          className="input-text-ctrl"
                          type="url"
                          placeholder="Or paste cloud document link (e.g. Google Drive, Notion, GitHub URL)"
                          value={projectReportUrl}
                          onChange={(e) => setProjectReportUrl(e.target.value)}
                          style={{ fontSize: "12.5px" }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Subcard 2: Contact & Authentication Credentials */}
                <div className="form-panel-card">
                  <div className="panel-heading">
                    <span className="panel-badge">Contact & Identification</span>
                    <span className="panel-title">Credentials & identity verification</span>
                  </div>

                  <div className="form-grid-fields">
                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="email">
                        <span>Official Email Address <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="email"
                          className="input-text-ctrl"
                          type="email"
                          required
                          placeholder={isStudentInnovator ? "innovator@college.edu" : "founder@company.com"}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                    </div>


                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="mobile">
                        <span>Primary Mobile (WhatsApp) <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="mobile"
                          className="input-text-ctrl"
                          type="tel"
                          required
                          placeholder="+91 98765 43210 or 10-digit number"
                          value={mobile}
                          onChange={(e) => setMobile(e.target.value)}
                          onBlur={() => {
                            if (mobile.trim()) {
                              const formatted = normalizeMobileNumber(mobile);
                              if (formatted) setMobile(formatted);
                            }
                          }}
                        />
                      </div>
                      <span style={{ fontSize: "11px", color: "#78716c", marginTop: "2px" }}>
                        Auto-formats to E.164 (+91 98765 43210)
                      </span>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="altMobile">
                        <span>Alternate Phone Number <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="altMobile"
                          className="input-text-ctrl"
                          type="tel"
                          required
                          placeholder="Secondary / Emergency contact"
                          value={altMobile}
                          onChange={(e) => setAltMobile(e.target.value)}
                          onBlur={() => {
                            if (altMobile.trim()) {
                              const formatted = normalizeMobileNumber(altMobile);
                              if (formatted) setAltMobile(formatted);
                            }
                          }}
                        />
                      </div>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="city">
                        <span>City <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="city"
                          className="input-text-ctrl"
                          type="text"
                          required
                          placeholder="e.g. Bhubaneswar / Gunupur"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="state">
                        <span>State <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="state"
                          className="input-text-ctrl"
                          type="text"
                          required
                          placeholder="e.g. Odisha"
                          value={state}
                          onChange={(e) => setState(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="country">
                        <span>Country <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="country"
                          className="input-text-ctrl"
                          type="text"
                          required
                          value={country}
                          onChange={(e) => setCountry(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="linkedinUrl">
                        <span>LinkedIn Profile / URL {isStartupOrInnovator && <span className="field-req-mark">*</span>}</span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="linkedinUrl"
                          className="input-text-ctrl"
                          type="text"
                          inputMode="url"
                          autoCapitalize="none"
                          autoCorrect="off"
                          spellCheck={false}
                          required={isStartupOrInnovator}
                          placeholder="e.g. linkedin.com/in/username or full URL"
                          value={linkedinUrl}
                          onChange={(e) => setLinkedinUrl(e.target.value)}
                          onBlur={() => {
                            if (linkedinUrl.trim()) {
                              setLinkedinUrl(normalizeLinkedInUrl(linkedinUrl));
                            }
                          }}
                        />
                      </div>
                      <span style={{ fontSize: "11px", color: "#78716c", marginTop: "2px" }}>
                        Accepts LinkedIn username, handle, or full URL
                      </span>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="aadharNumber">
                        <span>Aadhaar Number <span className="field-req-mark">*</span></span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="aadharNumber"
                          className="input-text-ctrl"
                          type="text"
                          required
                          maxLength={14}
                          placeholder="1234 5678 9012"
                          value={aadharNumber}
                          onChange={(e) => handleAadharChange(e.target.value)}
                        />
                      </div>
                      <span style={{ fontSize: "11px", color: "#78716c", marginTop: "2px" }}>
                        12-digit Indian Aadhaar for accreditation
                      </span>
                    </div>

                    <div className="form-group-item">
                      <label className="form-label-row" htmlFor="panNumber">
                        <span>PAN Card Number</span>
                      </label>
                      <div className="input-icon-wrapper">
                        <input
                          id="panNumber"
                          className="input-text-ctrl"
                          type="text"
                          maxLength={10}
                          placeholder="ABCDE1234F"
                          value={panNumber}
                          onChange={(e) => handlePanChange(e.target.value)}
                          style={{ textTransform: "uppercase" }}
                        />
                      </div>
                      <span style={{ fontSize: "11px", color: "#78716c", marginTop: "2px" }}>
                        10-character Permanent Account Number
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Physical Summit Badge Mockup (Real-Time Preview) */}
              <div className="badge-preview-column">
                <div
                  className="live-badge-container"
                  style={{ "--badge-accent": activeCategory.themeColor } as React.CSSProperties}
                >
                  <div className="badge-slot-hanger" />
                  <div className="badge-summit-header">
                    <img src="/logos/isf-logo.webp" alt="ISF Logo" style={{ width: 18, height: 18, objectFit: "contain" }} />
                    <span>STARTUP JATHARA 2026</span>
                  </div>

                  <input
                    type="file"
                    accept="image/*"
                    ref={leadFileInputRef}
                    style={{ display: "none" }}
                    onChange={handleLeadPhotoChange}
                  />

                  <div
                    className="badge-photo-target"
                    onClick={() => leadFileInputRef.current?.click()}
                    title="Click to upload photograph for summit pass"
                  >
                    {leadPhoto ? (
                      <img src={leadPhoto} alt="Attendee" className="badge-photo-render" />
                    ) : (
                      <div style={{ textAlign: "center", padding: 8 }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#78716c" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto" }}>
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                          <circle cx="12" cy="13" r="4" />
                        </svg>
                        <span style={{ fontSize: 10, display: "block", color: "#78716c", marginTop: 4, fontWeight: 700 }}>
                          Upload Pass Photo *
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="badge-attendee-name">
                    {fullName.trim() || "Attendee Full Name"}
                  </div>
                  <div className="badge-company-name">
                    {teamName.trim() || "Startup / Institution"}
                  </div>
                  <div className="badge-category-strip">
                    {activeCategory.passType}
                  </div>

                  <button
                    type="button"
                    className="badge-photo-btn"
                    onClick={() => leadFileInputRef.current?.click()}
                  >
                    {leadPhoto ? "Change Photograph" : "Upload Badge Photo *"}
                  </button>

                  <div className="badge-barcode-pattern">
                    ||| | |||| | |||||| || | |||
                  </div>
                  <span className="badge-footer-date">
                    18–20 DEC 2026 · GIET UNIVERSITY
                  </span>
                </div>
              </div>
            </div>

            {/* STEP 3: Team Members Details (for Startup Leader & Student Innovator) */}
            {isStartupOrInnovator && (
              <>
                <div className="step-heading-bar" style={{ marginTop: 28 }}>
                  <span className="step-heading-title">
                    Step 3 · Team Members Accreditation (Max 5 Members)
                  </span>
                  <span className="step-tag-pill">{members.length} / 5 Added · Mandatory *</span>
                </div>

                <div className="team-members-list">
                  {members.map((member, index) => (
                    <div key={member.id} className="member-form-card">
                      <div className="member-card-title-bar">
                        <span className="member-number-badge">Member #{index + 1} · Core Contributor</span>
                        {members.length > 1 && (
                          <button
                            type="button"
                            className="btn-delete-member"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, verticalAlign: "-1px" }}>
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="member-row-layout">
                        {/* Member Photo Box */}
                        <div className="member-photo-pick">
                          <label
                            className="member-avatar-square"
                            htmlFor={`member-photo-${member.id}`}
                            title="Click to upload member photo"
                          >
                            {member.photoUrl ? (
                              <img
                                src={member.photoUrl}
                                alt={member.name || `Member ${index + 1}`}
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                              />
                            ) : (
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#a8a29e" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                                <circle cx="12" cy="13" r="4" />
                              </svg>
                            )}
                          </label>
                          <input
                            id={`member-photo-${member.id}`}
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleMemberPhotoChange(member.id, file);
                            }}
                          />
                          <span style={{ fontSize: 10.5, color: member.photoUrl ? "#143e30" : "#78716c", fontWeight: 700 }}>
                            {member.photoUrl ? "Uploaded" : "Upload *"}
                          </span>
                        </div>

                        {/* Member Inputs */}
                        <div className="member-inputs-flex">
                          <div className="form-group-item">
                            <label className="form-label-row">
                              <span>Full Name <span className="field-req-mark">*</span></span>
                            </label>
                            <input
                              type="text"
                              required
                              className="input-text-ctrl"
                              placeholder="e.g. Priya Sharma"
                              value={member.name}
                              onChange={(e) => handleMemberFieldChange(member.id, "name", e.target.value)}
                            />
                          </div>

                          <div className="form-group-item">
                            <label className="form-label-row">
                              <span>Phone Number <span className="field-req-mark">*</span></span>
                            </label>
                            <input
                              type="tel"
                              required
                              className="input-text-ctrl"
                              placeholder="+91 98765 00000"
                              value={member.phone}
                              onChange={(e) => handleMemberFieldChange(member.id, "phone", e.target.value)}
                              onBlur={() => {
                                if (member.phone.trim()) {
                                  const formatted = normalizeMobileNumber(member.phone);
                                  if (formatted) handleMemberFieldChange(member.id, "phone", formatted);
                                }
                              }}
                            />
                          </div>

                          <div className="form-group-item">
                            <label className="form-label-row">
                              <span>Email Address <span className="field-req-mark">*</span></span>
                            </label>
                            <input
                              type="email"
                              required
                              className="input-text-ctrl"
                              placeholder="priya@company.com"
                              value={member.email}
                              onChange={(e) => handleMemberFieldChange(member.id, "email", e.target.value)}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}

                  {members.length < 5 && (
                    <button
                      type="button"
                      className="btn-add-team-slot"
                      onClick={handleAddMember}
                    >
                      <span>+ Add Another Team Member</span>
                      <span>({5 - members.length} spots remaining)</span>
                    </button>
                  )}
                </div>
              </>
            )}

            {/* Trust & Security Guarantee */}
            <div className="trust-seal-box">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#103327" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <div>
                <p className="trust-seal-head">Official Summit Accreditation Guarantee</p>
                <p className="trust-seal-text">
                  Your credentials and attendee profiles are encrypted and committed directly to the official ISF 2026 Summit database. Badges will be generated and distributed upon check-in at GIET University.
                </p>
              </div>
            </div>

            {error && (
              <div className="error-alert-box" role="alert" style={{ marginBottom: "16px" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c25022" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button type="submit" className="btn-submit-summit" disabled={busy}>
              {busy ? "Registering & Generating Credentials…" : `Complete Registration as ${activeCategory.title} →`}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
