/**
 * Transaction frame for every booking write (spec §4.3, §4.4).
 *
 * - Short transactions with lock and statement timeouts.
 * - Whole-transaction retry for deadlock / lock timeout / serialization failures
 *   and connection loss before COMMIT.
 * - If the connection fails after COMMIT was sent, the outcome is unknown: the
 *   operation (always idempotent) is re-run once in a new transaction; if that
 *   also fails the caller gets 503 OUTCOME_UNKNOWN and must read GET /v1/booking/me.
 * - Operations return { ok } or { fail }; a fail is thrown only AFTER COMMIT so
 *   housekeeping done under lock (e.g. marking stale holds expired) is kept.
 */
import type postgres from "postgres";
import { getDb } from "../db";
import { fault } from "../db/faults";
import { HttpError } from "../http";

export type Tx = postgres.TransactionSql;
export type TxOutcome<T> = { ok: T } | { fail: HttpError };
export const ok = <T>(value: T): TxOutcome<T> => ({ ok: value });
export const fail = <T = never>(error: HttpError): TxOutcome<T> => ({ fail: error });

const MAX_ATTEMPTS = 3;
const RETRYABLE_SQLSTATE = new Set(["40001", "40P01", "55P03"]);
const CONNECTION_CODES = new Set([
  "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED", "ECONNRESET", "ECONNREFUSED", "EPIPE",
  "57P01", "08000", "08003", "08006",
]);

export const retryLater = () =>
  new HttpError(503, "RETRY_LATER", "The service is busy. Please try again in a moment.", undefined, { "Retry-After": "2" });

/** Maps database errors to HTTP outcomes; 'retry' means re-run the whole transaction. */
function classify(err: any): HttpError | "retry" | null {
  const code: string | undefined = err?.code;
  const constraint: string | undefined = err?.constraint_name;
  if (code === "BK002") return new HttpError(409, "HOLD_EXPIRED", "This hold has expired. Please select the stall again.");
  if (code === "BK005" && err?.hint === "stall_not_bookable") {
    return new HttpError(409, "STALL_UNAVAILABLE", "This stall is not available.", { reason: "unavailable" });
  }
  if (code === "23505" && constraint === "reservations_booking_ref_uq") return "retry";
  if (code === "23505" && constraint === "reservations_cancel_request_uq") {
    return new HttpError(409, "REQUEST_ID_REUSED", "This request id was already used for a different booking.");
  }
  if (code === "23505" && constraint === "reservations_live_stall_uq") {
    console.warn("[BOOKING] live-stall unique index fired; locking should have prevented this");
    return new HttpError(409, "STALL_UNAVAILABLE", "This stall is not available.", { reason: "held" });
  }
  if (code === "23505" && constraint === "reservations_live_team_uq") {
    console.warn("[BOOKING] live-team unique index fired; locking should have prevented this");
    return new HttpError(409, "TEAM_HAS_ACTIVE_CLAIM", "Your team already has a hold or booking.");
  }
  if (code === "57014") return retryLater();
  if (code && (RETRYABLE_SQLSTATE.has(code) || CONNECTION_CODES.has(code))) return "retry";
  return null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withBookingTx<T>(op: (tx: Tx) => Promise<TxOutcome<T>>): Promise<T> {
  const sql = await getDb();
  let rerunAfterUnknownOutcome = false;

  for (let attempt = 1; ; attempt++) {
    let commitSent = false;
    try {
      const outcome = (await sql.begin(async (tx) => {
        await tx.unsafe(
          "set local lock_timeout = '2s'; set local statement_timeout = '5s'; set local idle_in_transaction_session_timeout = '10s'"
        );
        const result = await op(tx);
        await fault("beforeCommit");
        commitSent = true;
        return result;
      })) as TxOutcome<T>;
      await fault("afterCommit");
      if ("fail" in outcome) throw outcome.fail;
      return outcome.ok;
    } catch (err) {
      if (err instanceof HttpError) throw err;

      if (commitSent) {
        // COMMIT was sent but its result was lost: never assume either outcome.
        if (rerunAfterUnknownOutcome) {
          throw new HttpError(
            503,
            "OUTCOME_UNKNOWN",
            "We could not confirm whether your request completed. Please refresh to see your current status.",
            undefined,
            { "Retry-After": "2" }
          );
        }
        rerunAfterUnknownOutcome = true;
        continue;
      }

      const mapped = classify(err);
      if (mapped instanceof HttpError) throw mapped;
      if (mapped === "retry") {
        if (attempt >= MAX_ATTEMPTS) throw retryLater();
        await sleep((25 + Math.random() * 75) * attempt);
        continue;
      }
      throw err;
    }
  }
}
