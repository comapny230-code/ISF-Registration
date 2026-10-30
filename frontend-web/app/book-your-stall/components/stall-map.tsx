"use client";
import type { Snapshot, SnapshotStall } from "@/lib/booking/client-api";
import styles from "../booking.module.css";
import { hasGeometry, stallLabel, stallMark } from "./stall-status";

type Zone = Snapshot["zones"][number];

interface Props {
  zone: Zone;
  stalls: SnapshotStall[];
  selectedId: string | null;
  onSelect: (stallId: string) => void;
}

/** Shared SVG patterns (rendered once per page) for the non-colour status cues. */
export function StallPatterns() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <defs>
        <pattern id="pattern-held" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2" height="2" fill="#fbf5e6" />
          <line x1="0" y1="0" x2="0" y2="2" stroke="#be9740" strokeWidth="0.9" />
        </pattern>
        <pattern id="pattern-unavailable" width="3" height="3" patternUnits="userSpaceOnUse">
          <rect width="3" height="3" fill="#e7e5e4" />
          <path d="M0 0L3 3M3 0L0 3" stroke="#a8a29e" strokeWidth="0.4" />
        </pattern>
        {/* Ground surfaces, in feet: mown turf stripes and a poured court. */}
        <pattern id="surface-turf" width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="40" height="40" fill="#cfe3c9" />
          <rect width="20" height="40" fill="#c3dcbc" />
        </pattern>
        <pattern id="surface-court" width="12" height="12" patternUnits="userSpaceOnUse">
          <rect width="12" height="12" fill="#efe6d6" />
          <circle cx="3" cy="4" r="0.35" fill="#dccdb3" />
          <circle cx="9" cy="9" r="0.3" fill="#dccdb3" />
        </pattern>
        <pattern id="surface-helipad" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="#ece8e1" />
          <rect width="2" height="4" fill="#e2ddd4" />
        </pattern>
      </defs>
    </svg>
  );
}

export function stallClass(stall: SnapshotStall, selected: boolean): string {
  return [styles.stall, styles[stall.status], stall.heldByYou || stall.bookingRef ? styles.mine : "", selected ? styles.selected : ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * Zoom levels in pixels per foot. "fit" shows the whole ground in the column; the
 * others keep 10 ft stalls large enough to read and tap, and the ground scrolls.
 */
export const ZOOM_LEVELS = ["fit", 3.2, 4.5, 6] as const;
export type Zoom = (typeof ZOOM_LEVELS)[number];
/** Upper bound for "fit", so a narrow ground is not stretched across a wide column. */
const FIT_MAX_PX_PER_FT = 5;

/** Ground surface per area; unknown areas get a plain surface. */
const SURFACES: Record<string, string> = { PG: "url(#surface-turf)", BB: "url(#surface-court)" };

type Landmark = Zone["landmarks"][number];
const placedLandmark = (l: Landmark): l is Landmark & { x: number; y: number; w: number; d: number } =>
  [l.x, l.y, l.w, l.d].every((v) => typeof v === "number");

/** Roads, lanes, stages, rooms and other features drawn behind the stalls (not selectable). */
function Landmarks({ landmarks }: { landmarks: Landmark[] }) {
  return (
    <g aria-hidden="true">
      {landmarks.filter(placedLandmark).map((l) => {
        const vertical = l.d > l.w * 2;
        const [along, across] = vertical ? [l.d, l.w] : [l.w, l.d];
        // Fit the label inside its box (bold text is roughly 0.62 em per character).
        const size = Math.min(5, across * 0.6, (along * 0.9) / (l.label.length * 0.62));
        const cx = l.x + l.w / 2;
        const cy = l.y + l.d / 2;
        return (
          <g key={`${l.label}-${l.x}-${l.y}`} className={`${styles.landmark} ${styles[`landmark_${l.kind}`] ?? ""}`}>
            <rect x={l.x} y={l.y} width={l.w} height={l.d} rx={l.kind === "stage" || l.kind === "reserved" ? 1.5 : 0} />
            {l.kind === "road" && (
              <line
                className={styles.roadLine}
                x1={vertical ? cx : l.x + 3}
                y1={vertical ? l.y + 3 : cy}
                x2={vertical ? cx : l.x + l.w - 3}
                y2={vertical ? l.y + l.d - 3 : cy}
              />
            )}
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              style={{ fontSize: size }}
              transform={vertical ? `rotate(-90 ${cx} ${cy})` : undefined}
            >
              {l.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/**
 * Draws stalls (and any positioned landmarks) at their coordinates in feet. Stalls
 * without geometry are never placed on the map; the caller lists them instead.
 */
export function StallMap({ zone, stalls, selectedId, onSelect, zoom = 3.2 }: Props & { zoom?: Zoom }) {
  const placed = stalls.filter(hasGeometry);
  if (placed.length === 0) return null;

  const width = zone.extent.widthFt ?? Math.max(...placed.map((s) => s.x! + s.w)) + 10;
  const depth = zone.extent.depthFt ?? Math.max(...placed.map((s) => s.y! + s.d)) + 10;
  const pad = 6;

  return (
    <svg
      className={styles.map}
      style={{
        width:
          zoom === "fit"
            ? `min(100%, ${(width + 2 * pad) * FIT_MAX_PX_PER_FT}px)`
            : `clamp(${(width + 2 * pad) * zoom}px, 100%, ${(width + 2 * pad) * zoom * 1.6}px)`,
        margin: "0 auto",
      }}
      viewBox={`${-pad} ${-pad} ${width + 2 * pad} ${depth + 2 * pad}`}
      role="group"
      aria-label={`Map of ${zone.name}. Use Tab to move between stalls and Enter to select.`}
    >
      <rect className={styles.zoneOutline} x={0} y={0} width={width} height={depth} rx={2} style={{ fill: SURFACES[zone.code] ?? "#fbfaf6" }} />
      <Landmarks landmarks={zone.landmarks} />
      {placed.map((stall) => {
        const selected = stall.id === selectedId;
        const numMatch = stall.code.match(/\d+$/);
        const stallNum = numMatch ? String(parseInt(numMatch[0], 10)) : stall.code.slice(3);
        const label = `Stall ${stall.code} (#${stallNum}), ${stallLabel(stall)}`;
        return (
          <g
            key={stall.id}
            data-stall-code={stall.code}
            className={stallClass(stall, selected)}
            transform={`translate(${stall.x} ${stall.y}) rotate(${stall.rot})`}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selected}
            onClick={() => onSelect(stall.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(stall.id);
              }
            }}
          >
            <title>{label}</title>
            <rect className={styles.stallShadow} x={0.5} y={0.7} width={stall.w} height={stall.d} rx={0.8} />
            <rect className={styles.stallTop} width={stall.w} height={stall.d} rx={0.8} />
            <path className={styles.canopy} d={`M0 0L${stall.w} ${stall.d}M${stall.w} 0L0 ${stall.d}`} />
            <text x={stall.w / 2} y={stall.d * (stallMark(stall) ? 0.38 : 0.5)} textAnchor="middle" dominantBaseline="central">
              {stallNum}
            </text>
            {stallMark(stall) && (
              <text className={styles.mark} x={stall.w / 2} y={stall.d * 0.7} textAnchor="middle" dominantBaseline="central">
                {stallMark(stall)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function StallLegend() {
  const swatch = (className: string, mark: string) => (
    <svg width="22" height="16" viewBox="0 0 11 8" aria-hidden="true">
      <g className={`${styles.stall} ${className}`}>
        <rect className={styles.stallTop} width="11" height="8" rx="0.8" />
        <text x="5.5" y="4" textAnchor="middle" dominantBaseline="central" style={{ fontSize: 5.5 }}>
          {mark}
        </text>
      </g>
    </svg>
  );
  return (
    <ul className={styles.legend} aria-label="Map legend">
      <li>{swatch(styles.available, "")} Available</li>
      <li>{swatch(styles.held, "…")} Held by another team</li>
      <li>{swatch(`${styles.held} ${styles.mine}`, "★")} Held by you</li>
      <li>{swatch(styles.booked, "✓")} Booked</li>
      <li>{swatch(styles.unavailable, "×")} Unavailable</li>
    </ul>
  );
}
