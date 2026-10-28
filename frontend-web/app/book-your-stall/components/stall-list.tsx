"use client";
import type { SnapshotStall } from "@/lib/booking/client-api";
import styles from "../booking.module.css";
import { stallLabel, stallMark } from "./stall-status";

interface Props {
  stalls: SnapshotStall[];
  selectedId: string | null;
  onSelect: (stallId: string) => void;
  caption: string;
}

/** Accessible list of every stall in the zone; the default view on narrow screens. */
export function StallList({ stalls, selectedId, onSelect, caption }: Props) {
  return (
    <table className={styles.list}>
      <caption className={styles.srOnly}>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Stall</th>
          <th scope="col">Status</th>
          <th scope="col">
            <span className={styles.srOnly}>Action</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {stalls.map((stall) => {
          const selected = stall.id === selectedId;
          return (
            <tr key={stall.id} aria-selected={selected} data-stall-code={stall.code}>
              <td className={styles.code}>{stall.code}</td>
              <td className={styles.status}>
                <span aria-hidden="true">{stallMark(stall)} </span>
                {stallLabel(stall)}
              </td>
              <td>
                <button
                  type="button"
                  className={styles.listButton}
                  onClick={() => onSelect(stall.id)}
                  aria-pressed={selected}
                  aria-label={`Select stall ${stall.code}`}
                >
                  {selected ? "Selected" : "Select"}
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
