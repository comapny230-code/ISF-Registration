/**
 * Fault-injection points for concurrency tests (spec §9.3). Arming and firing are
 * only possible while APP_ENV=test; in every other environment fault() is a no-op.
 */
import { getAppEnv } from "../config";

export type FaultPoint = "beforeCommit" | "afterCommit" | "beforeConfirmUpdate";
type Action = () => Promise<void> | void;

const armed = new Map<FaultPoint, Action[]>();

function testOnly(): boolean {
  try {
    return getAppEnv() === "test";
  } catch {
    return false;
  }
}

export function armFault(point: FaultPoint, action: Action, times = 1): void {
  if (!testOnly()) throw new Error("Faults can only be armed when APP_ENV=test.");
  const queue = armed.get(point) ?? [];
  for (let i = 0; i < times; i++) queue.push(action);
  armed.set(point, queue);
}

export function clearFaults(): void {
  armed.clear();
}

export async function fault(point: FaultPoint): Promise<void> {
  if (armed.size === 0 || !testOnly()) return;
  const action = armed.get(point)?.shift();
  if (action) await action();
}

/** Mimics a dropped database connection (retryable before COMMIT, unknown outcome after). */
export class SimulatedConnectionError extends Error {
  readonly code = "CONNECTION_CLOSED";
  constructor() {
    super("simulated connection loss");
    this.name = "SimulatedConnectionError";
  }
}
