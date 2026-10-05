/**
 * Who may do what, on the client.
 *
 * This is a mirror of the RLS in `supabase/migrations/0001_init.sql`, and it is
 * a mirror on purpose. The server is the authority — a client check is a
 * convenience, and every one of these rules is enforced again by a policy the
 * client cannot talk its way past. What this buys is that a viewer's board does
 * not *offer* things it will refuse: a delete button that fails on the server
 * is worse than no button, because it teaches you the board is unreliable.
 *
 * The rules are written out as the predicates the policies use (`is_member`,
 * `is_editor`, `is_dm`) rather than as a matrix of role × action, because that
 * is the shape they have on the server and a second, differently-shaped copy is
 * a copy that drifts. `isEditor` here and `is_editor` there should be readable
 * side by side.
 *
 * There is no board id yet: the client has one board and no membership rows, so
 * `Viewer` carries the role directly. When boards become real, the role comes
 * from a membership lookup and nothing below this line changes.
 */

import type { BoardEntity } from '../model/types'

/** The four roles, in increasing order of what they may do. */
export const ROLES = ['viewer', 'editor', 'dm', 'owner'] as const
export type Role = (typeof ROLES)[number]

/**
 * Someone looking at a board.
 *
 * `userId` is optional because the local board has no accounts; when it is
 * absent, nothing is attributable to a person and `createdBy` is left unset.
 */
export interface Viewer {
  role: Role
  userId?: string
}

/**
 * The board's own viewer, until there is a server to ask.
 *
 * `owner` rather than `editor` because this is the person holding the board —
 * they can see the DM's notes, which is the one thing an editor cannot. Nothing
 * on the board is hidden from them today, so the choice is invisible; it
 * matters the moment there is a second person.
 */
export const LOCAL_VIEWER: Viewer = { role: 'owner' }

/** Anything with a role at all. Mirrors `is_member`. */
export function isMember(viewer: Viewer): boolean {
  return ROLES.includes(viewer.role)
}

/** May add, change and remove what is on the board. Mirrors `is_editor`. */
export function isEditor(viewer: Viewer): boolean {
  return viewer.role === 'editor' || viewer.role === 'dm' || viewer.role === 'owner'
}

/** May see what the DM keeps back. Mirrors `is_dm`. */
export function isDm(viewer: Viewer): boolean {
  return viewer.role === 'dm' || viewer.role === 'owner'
}

/**
 * What a person is trying to do.
 *
 * Not one verb per kind: the board has four kinds and the permissions do not
 * vary between them, so "may this person move this" is the same question for a
 * note as for a picture. Where a kind *does* have its own rule — an article
 * that has been made uneditable through its own options — the entity is asked,
 * because that is the entity's business rather than the role's.
 */
export type Action = 'read' | 'create' | 'edit' | 'move' | 'delete'

/**
 * Whether this viewer may do this to this entity.
 *
 * `entity` is optional for `create`, where there is nothing yet to ask about.
 * An entity that has not arrived is not a reason to deny — a client that cannot
 * read a row it is about to insert would produce a board you cannot add to.
 */
export function can(viewer: Viewer, action: Action, entity?: BoardEntity): boolean {
  // Reading is the floor: a member may read, and anyone else is not here at all.
  if (action === 'read') return isMember(viewer)

  if (!isEditor(viewer)) return false

  // An entity can narrow its own reach — an article whose options forbid
  // editing is not editable even by the DM who set it that way. The role is a
  // ceiling, not a grant.
  if (action === 'edit' && entity && 'options' in entity && !entity.options.editable) {
    return false
  }

  return true
}

/**
 * Whether this viewer may see that this entity exists.
 *
 * The three conditions are the `using` clause every select policy repeats:
 * membership, the shared/dm split, and the reveal time. Kept in one function
 * because a board that filters in one place and renders in another shows
 * tomorrow's notes today.
 *
 * `now` is passed rather than read, so that "a note revealed at midnight" is a
 * thing a test can stand either side of.
 */
export function visibleTo(viewer: Viewer, entity: BoardEntity, now: number = Date.now()): boolean {
  if (!isMember(viewer)) return false
  if (entity.visibility === 'dm' && !isDm(viewer)) return false
  if (entity.revealAt !== undefined && entity.revealAt > now) return false
  return true
}

/** The entities this viewer may see, in the order they were given. */
export function visibleOnly<T extends BoardEntity>(
  viewer: Viewer,
  entities: readonly T[],
  now?: number,
): T[] {
  return entities.filter((entity) => visibleTo(viewer, entity, now))
}
