# Marumie Project Structure

## Overview
**マルミエ (Marumie)** - Reservation log analysis dashboard built with Next.js 14 (App Router) + TypeScript + Tailwind CSS. CSV upload-based clinic analytics tool.

## Tech Stack
- **Framework**: Next.js 14.2.15 (App Router, TypeScript)
- **Styling**: Tailwind CSS 3.4.16 with custom design tokens
- **Data Visualization**: Recharts 3.0.2
- **CSV Parsing**: PapaParse 5.4.1
- **Icons**: Lucide React 0.446.0
- **Font**: Noto Sans JP (Google Fonts)

## Project Structure
```
marumie/
├── src/app/
│   ├── page.tsx          # Main dashboard (client component)
│   ├── layout.tsx        # Root layout with metadata
│   ├── globals.css       # Global styles + Tailwind
│   └── favicon.ico
├── public/               # Static assets (SVG icons)
├── docs/
│   └── implementation-plan-v2.md  # v2.0 feature plan
├── .github/workflows/
│   └── deploy.yml        # GitHub Pages deployment
├── next.config.mjs       # Next.js config (static export for GH Pages)
├── tailwind.config.ts    # Custom theme (brand/accent colors, shadows)
├── tsconfig.json         # TypeScript config (strict mode, path aliases)
└── package.json          # Dependencies

```

## Core Features
1. **CSV Upload & LocalStorage**: Auto-save uploaded CSV data to browser storage
2. **Hourly/Daily Aggregation**: Visualize reservation trends by time/date
3. **Department Analysis**: Per-department breakdown with initial/follow-up visit distinction
4. **Monthly Summary**: Aggregate statistics by month
5. **Diff View**: Highlight newly added data from latest upload

## Data Model
```typescript
type Reservation = {
  key: string;              // Unique deduplication key
  department: string;       // 診療科
  visitType: "初診"|"再診"|"未設定";
  reservationDate: string;  // YYYY-MM-DD
  reservationMonth: string; // YYYY-MM
  reservationHour: number;  // 0-23
  receivedAtIso: string;    // ISO 8601 timestamp
  appointmentIso: string | null;
  patientId: string;
  isSameDay: boolean;       // 当日予約フラグ
}
```

## Design System
- **Color Palette**:
  - Brand (Blue): `#2563EB` (primary), `#3B82F6` (secondary)
  - Accent (Green): `#10B981` (follow-up), `#34D399`
  - Background: `#F8FAFC` (off-white)
  - Surface: `#FFFFFF`
- **Shadows**: `shadow-card`, `shadow-soft` for depth
- **Typography**: Noto Sans JP with `palt` feature
- **Components**: Rounded-3xl cards, gradient headers, soft borders

## Deployment
- **Development**: `npm run dev` → http://localhost:3000
- **Production Build**: `npm run build` (SSG mode)
- **GitHub Pages**: CI/CD via `.github/workflows/deploy.yml`
  - Static export with `basePath: /marumie`
  - Deploy on push to `main` branch

## Key Implementation Details
1. **Client-Side Only**: All processing happens in browser (no backend)
2. **Deduplication**: Uses composite key (dept + visitType + timestamp + patientId)
3. **JST DateTime Parsing**: Custom parser for `YYYY/MM/DD HH:mm` format
4. **Department Sorting**: 3 modes (priority, alphabetical, volume)
5. **Collapsible Charts**: Accordion-style per-department line charts

## Future Roadmap (v2.0)
From `docs/implementation-plan-v2.md`:
- Local save/restore functionality (JSON/CSV export)
- PDF report generation (jsPDF + html2canvas)
- Enhanced error handling and status indicators
- Help documentation updates