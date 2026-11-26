export const MIN_AGE = 18;

/** True if `dob` (YYYY-MM-DD) is a real date and the person is at least MIN_AGE on `now`. */
export function isAdult(dob: string, now = new Date()): boolean {
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dob) return false;
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - MIN_AGE);
  return d <= cutoff;
}
