/**
 * Business references — spec §26.
 *
 * Human-facing identifiers: REQ-2026-0148, ORD-2026-1254, INV-2026-0921.
 * These are what a customer quotes on the phone and what staff search for.
 *
 * §26 is explicit that database ids stay independent of these. A reference is
 * a *business* identity: sequential within its prefix and year, gapless, and
 * safe to print. The `_id` remains whatever the database wants it to be.
 *
 * The counter itself is a port (`CounterStore`) so this module stays pure and
 * testable. Ticket 01 supplies the MongoDB implementation — an atomic
 * `findOneAndUpdate` with `$inc`, which is the only thing that makes
 * concurrent generation safe.
 */

export const REFERENCE_PREFIXES = {
  REQ: "Customer request (custom build)",
  CUS: "Customisation request",
  PRJ: "Project",
  CHG: "Change request",
  TKT: "Support ticket",
  ORD: "Order",
  INV: "Invoice",
  QUO: "Quote",
  PAY: "Payment",
  /**
   * Vendor ticket 09. Its own prefix because `PAY` is inbound — a payout and a payment
   * are opposite directions of money and sharing a sequence would make
   * "PAY-2026-0031" ambiguous in a bank statement, which is the one place it must not be.
   */
  POU: "Vendor payout",
} as const;

export type ReferencePrefix = keyof typeof REFERENCE_PREFIXES;

const SEQUENCE_PAD = 4;
const PATTERN = /^([A-Z]{3})-(\d{4})-(\d{4,})$/;

export class ReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReferenceError";
  }
}

/**
 * The atomic counter this module depends on.
 *
 * `next(key)` MUST return a distinct, monotonically increasing integer for a
 * given key even under concurrent callers. Anything less produces duplicate
 * customer-facing references, which is a support incident, not a bug report.
 */
export interface CounterStore {
  next(key: string): Promise<number>;
}

export function counterKey(prefix: ReferencePrefix, year: number): string {
  return `reference:${prefix}:${year}`;
}

export function formatReference(
  prefix: ReferencePrefix,
  year: number,
  sequence: number,
): string {
  if (!Object.hasOwn(REFERENCE_PREFIXES, prefix)) {
    throw new ReferenceError(`Unknown reference prefix "${prefix}".`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new ReferenceError(`Reference sequence must be a positive integer, got ${sequence}.`);
  }
  return `${prefix}-${year}-${String(sequence).padStart(SEQUENCE_PAD, "0")}`;
}

export interface ParsedReference {
  prefix: ReferencePrefix;
  year: number;
  sequence: number;
}

export function parseReference(reference: string): ParsedReference {
  const match = PATTERN.exec(reference.trim().toUpperCase());
  if (!match) {
    throw new ReferenceError(`"${reference}" is not a valid business reference.`);
  }
  const [, prefix, year, sequence] = match as unknown as [string, string, string, string];
  if (!Object.hasOwn(REFERENCE_PREFIXES, prefix)) {
    throw new ReferenceError(`Unknown reference prefix "${prefix}".`);
  }
  return {
    prefix: prefix as ReferencePrefix,
    year: Number(year),
    sequence: Number(sequence),
  };
}

export function isReference(value: string): boolean {
  try {
    parseReference(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate the next reference for a prefix.
 *
 * `year` is injectable so tests are not hostage to the system clock and so a
 * back-dated import can produce references in the right year.
 */
export async function generateReference(
  store: CounterStore,
  prefix: ReferencePrefix,
  year: number = new Date().getUTCFullYear(),
): Promise<string> {
  const sequence = await store.next(counterKey(prefix, year));
  return formatReference(prefix, year, sequence);
}

/**
 * In-memory counter — tests and local scripts only.
 *
 * Single-process and non-durable. Importing this anywhere under `services/`
 * or `app/` is a defect: it will hand two web workers the same reference.
 */
export class InMemoryCounterStore implements CounterStore {
  private readonly counters = new Map<string, number>();

  async next(key: string): Promise<number> {
    const value = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, value);
    return value;
  }

  peek(key: string): number {
    return this.counters.get(key) ?? 0;
  }

  reset(): void {
    this.counters.clear();
  }
}
