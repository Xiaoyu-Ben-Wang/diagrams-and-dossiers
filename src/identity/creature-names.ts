/**
 * What an anonymous person is called, and what colour they are.
 *
 * Both are derived from `user_id` and nothing else, which is the property that
 * makes them agree: every client works out the same creature and the same colour
 * for the same person without anyone having to agree on it. Deriving the name
 * from the *name* would change it the moment somebody edited it, and picking per
 * client would mean two people describing the same stranger differently.
 */

/** FNV-1a. Small, stable, and no dependency for what is only a spreader. */
export function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * 31 of them: a prime, so taking a remainder over a small set does not collapse
 * onto the low bits of the hash the way a power of two would.
 */
export const CREATURES = [
  "goblin",
  "treant",
  "kobold",
  "mimic",
  "owlbear",
  "beholder",
  "wraith",
  "banshee",
  "griffon",
  "wyvern",
  "basilisk",
  "chimera",
  "harpy",
  "hydra",
  "imp",
  "lich",
  "manticore",
  "medusa",
  "minotaur",
  "naga",
  "ogre",
  "otyugh",
  "pixie",
  "roper",
  "satyr",
  "sphinx",
  "troll",
  "wight",
  "xorn",
  "yeti",
  "zombie",
] as const;

/**
 * Ten hues, apart enough to tell at a glance and mid-dark enough to read on
 * parchment, cork and slate alike. A member may replace theirs; this is only
 * what they are handed first.
 */
export const CURSOR_COLORS = [
  "#c0392b",
  "#d97706",
  "#a16207",
  "#3f8f4a",
  "#0f766e",
  "#2563a8",
  "#6d4aa8",
  "#b03a72",
  "#8a5a2b",
  "#4b5563",
] as const;

export function anonymousName(userId: string): string {
  return `anonymous ${CREATURES[hash32(userId) % CREATURES.length]}`;
}

export function defaultColor(userId: string): string {
  return CURSOR_COLORS[hash32(userId) % CURSOR_COLORS.length];
}

/** Stored on the member once someone chooses; absent means derive it. */
export function colorFor(userId: string, chosen?: string | null): string {
  return chosen ?? defaultColor(userId);
}
