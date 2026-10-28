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
 * Draws stalls at their surveyed coordinates (feet). Stalls without geometry are
 * never placed on the map; the caller shows the list instead.
 */
export function StallMap({ zone, stalls, selectedId, onSelect }: Props) {
  const placed = stalls.filter(hasGeometry);
  if (placed.length === 0) return null;

  const width = zone.extent.widthFt ?? Math.max(...placed.map((s) => s.x! + s.w)) + 10;
  const depth = zone.extent.depthFt ?? Math.max(...placed.map((s) => s.y! + s.d)) + 10;
  const pad = 6;

  return (
    <svg
      className={styles.map}
      viewBox={`${-pad} ${-pad} ${width + 2 * pad} ${depth + 2 * pad}`}
      role="group"
      aria-label={`Map of ${zone.name}. Use Tab to move between stalls and Enter to select.`}
    >
      <rect className={styles.zoneOutline} x={0} y={0} width={width} height={depth} />
      {placed.map((stall) => {
        const selected = stall.id === selectedId;
        const label = `Stall ${stall.code}, ${stallLabel(stall)}`;
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
            <rect width={stall.w} height={stall.d} rx={0.6} />
            <text x={stall.w / 2} y={stall.d * (stallMark(stall) ? 0.38 : 0.5)} textAnchor="middle" dominantBaseline="central">
              {stall.code.slice(3)}
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
        <rect width="11" height="8" rx="0.6" />
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
