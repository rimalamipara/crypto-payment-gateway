/** Games the admin can switch on or off. */
export const GAME_KEYS = ["poker", "teen-patti", "rummy", "color"] as const;

export type GameKey = (typeof GAME_KEYS)[number];

export function isGameKey(value: string): value is GameKey {
  return (GAME_KEYS as readonly string[]).includes(value);
}

export const GAME_LABELS: Record<GameKey, string> = {
  poker: "Poker",
  "teen-patti": "Teen Patti",
  rummy: "Rummy",
  color: "Color",
};
