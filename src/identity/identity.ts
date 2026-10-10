/**
 * Who you are on a board: a name you chose, or none and a creature instead.
 *
 * A name, not an account — no email, no password, no verification. It is kept on
 * this machine and, once there is a board to join, written to that board's
 * `members` row so everyone else can see it.
 */
import { anonymousName } from "./creature-names";

export interface Identity {
  /** What to call you, when you have said. Absent means anonymous. */
  displayName?: string;
  anonymous: boolean;
}

export const IDENTITY_STORAGE_KEY = "case-board:identity";

export const DEFAULT_IDENTITY: Identity = { anonymous: true };

/** Total, like preferences: a bad blob costs the name, not the board. */
export function parseIdentity(raw: unknown): Identity {
  const value = typeof raw === "string" ? tryParse(raw) : raw;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_IDENTITY };
  }
  const record = value as Record<string, unknown>;
  const name =
    typeof record.displayName === "string" && record.displayName.trim() !== ""
      ? record.displayName.trim()
      : undefined;
  const anonymous = record.anonymous !== false || name === undefined;
  return { displayName: name, anonymous };
}

function tryParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function loadIdentity(storage?: Storage): Identity {
  try {
    const store = storage ?? globalThis.localStorage;
    if (!store) return { ...DEFAULT_IDENTITY };
    return parseIdentity(store.getItem(IDENTITY_STORAGE_KEY));
  } catch {
    // Private windows block localStorage; being anonymous is a fine fallback.
    return { ...DEFAULT_IDENTITY };
  }
}

export function saveIdentity(identity: Identity, storage?: Storage): void {
  try {
    const store = storage ?? globalThis.localStorage;
    if (!store) return;
    store.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identity));
  } catch {
    // Same again: the name is a convenience, not something worth failing over.
  }
}

/** The name to show for someone: theirs if they gave one, a creature if not. */
export function nameFor(identity: Identity, userId: string): string {
  if (!identity.anonymous && identity.displayName) return identity.displayName;
  return anonymousName(userId);
}
