/** USD amounts stored as decimal strings with up to 8 fractional digits. */

const SCALE = 100_000_000n; // 8 decimal places

function toScaled(value: string | number): bigint {
  let raw: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid USD amount: ${value}`);
    }
    // Stabilize binary floats before integer scaling (e.g. 0.1 + 0.2).
    raw = value.toFixed(8);
  } else {
    raw = String(value).trim();
    if (!raw || !/^-?\d+(\.\d+)?$/.test(raw)) {
      throw new Error(`Invalid USD amount: ${value}`);
    }
  }

  const neg = raw.startsWith("-");
  const abs = neg ? raw.slice(1) : raw;
  const [wholePart, fracPart = ""] = abs.split(".");
  if (fracPart.length > 8) {
    // Truncate extra precision toward zero (never round a debit up).
    const truncated = `${neg ? "-" : ""}${wholePart}.${fracPart.slice(0, 8)}`;
    return toScaled(truncated);
  }
  const frac = (fracPart + "00000000").slice(0, 8);
  const n = BigInt(wholePart || "0") * SCALE + BigInt(frac);
  return neg ? -n : n;
}

function fromScaled(n: bigint): string {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(8, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

export function normalizeUsd(value: string | number): string {
  return fromScaled(toScaled(value));
}

export function addUsd(a: string | number, b: string | number): string {
  return fromScaled(toScaled(a) + toScaled(b));
}

export function subUsd(a: string | number, b: string | number): string {
  return fromScaled(toScaled(a) - toScaled(b));
}

export function gteUsd(a: string | number, b: string | number): boolean {
  return toScaled(a) >= toScaled(b);
}

export function eqUsd(a: string | number, b: string | number): boolean {
  return toScaled(a) === toScaled(b);
}

/** Clamp debit so it never exceeds balance (exact full-balance bets). */
export function minUsd(a: string | number, b: string | number): string {
  return toScaled(a) <= toScaled(b) ? normalizeUsd(a) : normalizeUsd(b);
}
