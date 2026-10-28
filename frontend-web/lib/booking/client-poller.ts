/**
 * Live-status polling (spec §4.10). Framework-independent so it can be unit-tested
 * with fake timers.
 *
 * - Polls every intervalMs while running; the page pauses it when hidden.
 * - Responses are ordered by the server's asOf: an older response that arrives
 *   late is ignored, so the map can never move backwards.
 * - Errors back off exponentially up to maxBackoffMs; success resets the delay.
 * - refreshAt() schedules an extra poll at a given time (e.g. just after a hold
 *   expires) because expiry changes status without any write.
 */

export interface PollerOptions<T extends { asOf: string }> {
  fetchSnapshot: () => Promise<T>;
  onSnapshot: (snapshot: T, receivedAt: number) => void;
  onError?: (error: unknown, consecutiveFailures: number) => void;
  intervalMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class StatusPoller<T extends { asOf: string }> {
  private readonly intervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  private running = false;
  private timer: unknown = null;
  private extraTimers = new Set<unknown>();
  private lastAsOf = Number.NEGATIVE_INFINITY;
  private failures = 0;

  constructor(private readonly options: PollerOptions<T>) {
    this.intervalMs = options.intervalMs ?? 2500;
    this.maxBackoffMs = options.maxBackoffMs ?? 15_000;
    this.now = options.now ?? (() => Date.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refresh();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    for (const t of this.extraTimers) this.clearTimer(t);
    this.extraTimers.clear();
  }

  /** Applies a snapshot unless it is older than one already applied. Returns whether it was applied. */
  accept(snapshot: T, receivedAt = this.now()): boolean {
    const asOf = Date.parse(snapshot.asOf);
    if (!Number.isFinite(asOf) || asOf < this.lastAsOf) return false;
    this.lastAsOf = asOf;
    this.options.onSnapshot(snapshot, receivedAt);
    return true;
  }

  /** Polls now and reschedules the regular poll. */
  async refresh(): Promise<void> {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    try {
      const snapshot = await this.options.fetchSnapshot();
      this.failures = 0;
      this.accept(snapshot);
    } catch (error) {
      this.failures += 1;
      this.options.onError?.(error, this.failures);
    } finally {
      this.schedule();
    }
  }

  /** Schedules one extra refresh at an absolute local time (ms since epoch). */
  refreshAt(localTimeMs: number): void {
    if (!this.running) return;
    const handle = this.setTimer(() => {
      this.extraTimers.delete(handle);
      void this.refresh();
    }, Math.max(0, localTimeMs - this.now()));
    this.extraTimers.add(handle);
  }

  /** Current delay before the next regular poll. */
  nextDelay(): number {
    if (this.failures === 0) return this.intervalMs;
    return Math.min(this.maxBackoffMs, this.intervalMs * 2 ** this.failures);
  }

  private schedule(): void {
    if (!this.running) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.refresh();
    }, this.nextDelay());
  }
}

/** Server-clock helpers: decisions are the server's; the countdown only displays them. */
export function serverOffsetMs(serverNowIso: string, receivedAtMs: number): number {
  return Date.parse(serverNowIso) - receivedAtMs;
}

export function remainingMs(expiresAtIso: string, offsetMs: number, localNowMs = Date.now()): number {
  return Math.max(0, Date.parse(expiresAtIso) - (localNowMs + offsetMs));
}

export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
