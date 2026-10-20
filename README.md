# ISF · Startup Jathara 2026 — Registration System

Official Registration Portal & Database for **Startup Leaders** and **Student Innovators** for **ISF · Startup Jathara @ Dandakaranya 2026** (18–20 December 2026, GIET University, Gunupur, Odisha).

---

## 🌟 Overview

This repository has been streamlined strictly for attendee/applicant registration:
- **Tracks Supported:**
  1. **Startup Leaders** (Founders, Co-Founders, Growth Startups)
  2. **Student Innovators** (College Innovation Labs, Undergraduates & Hardware/Software Prototypes)
- **Features Included:**
  - Team Lead & Team Member registration (1 to 5 members per team)
  - Photograph compression & ImageKit CDN uploads
  - Focus Sector & Innovation domain selection
  - Complete location & LinkedIn accreditation
  - Automated HTML confirmation email dispatch with full team accreditation manifest
  - Direct PostgreSQL persistence
  - Zero external bloat: all sign-in buttons, authentication dashboards, scoring, jury, volunteer, and extra legacy modules removed

---

## 📁 Repository Structure

```
.
├── database/
│   ├── schema.sql                         # Unified PostgreSQL schema for registration
│   └── migrations/
│       └── 0001_registration_init.sql    # Clean consolidated migration
├── frontend-web/
│   ├── app/
│   │   ├── page.tsx                       # Summit Landing & Direct Register CTA
│   │   ├── layout.tsx                     # Header & Footer with Organizer Logos
│   │   ├── globals.css                    # Jathara Warm-Terracotta & Forest design system
│   │   ├── organizer-logos.tsx            # GIET University & ISF branding
│   │   ├── register/
│   │   │   └── page.tsx                   # Dedicated registration page
│   │   └── v1/[...route]/
│   │       └── route.ts                   # Registration API endpoint & DB handler
│   ├── lib/
│   │   └── utils.ts                       # LinkedIn URL normalizer & helpers
│   ├── public/                            # Static logos & assets
│   ├── package.json                       # Next.js frontend dependencies
│   └── tsconfig.json
└── package.json                           # Root workspace scripts
```

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
cd frontend-web
npm install
```

### 2. Configure Environment
Set the following environment variables (or rely on default connection values):
- `DATABASE_URL`: PostgreSQL connection string
- `IMAGEKIT_PRIVATE_KEY`: ImageKit API key for attendee badge photos
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_PORT`: SMTP settings for confirmation emails

### 3. Run Locally
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the registration portal.