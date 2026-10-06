/**
 * Mirror of the RLS in `supabase/migrations/0001_init.sql`: the server is the
 * authority, and `isEditor` here must stay readable beside `is_editor` there.
 */

import type { BoardEntity } from '../model/types'

/** The four roles, in increasing order of what they may do. */
export const ROLES = ['viewer', 'editor', 'dm', 'owner'] as const
export type Role = (typeof ROLES)[number]

/** `userId` is absent on the local board, where nothing is attributable to a person. */
export interface Viewer {
  role: Role
  userId?: string
}

export const LOCAL_VIEWER: Viewer = { role: 'owner' }

export function isMember(viewer: Viewer): boolean {
  return ROLES.includes(viewer.role)
}

export function isEditor(viewer: Viewer): boolean {
  return viewer.role === 'editor' || viewer.role === 'dm' || viewer.role === 'owner'
}

export function isDm(viewer: Viewer): boolean {
  return viewer.role === 'dm' || viewer.role === 'owner'
}

export type Action = 'read' | 'create' | 'edit' | 'move' | 'delete'

export function can(viewer: Viewer, action: Action, entity?: BoardEntity): boolean {
  if (action === 'read') return isMember(viewer)

  if (!isEditor(viewer)) return false

  // The role is a ceiling, not a grant: an article whose options forbid editing
  // is not editable even by the dm who set it that way.
  if (action === 'edit' && entity && 'options' in entity && !entity.options.editable) {
    return false
  }

  return true
}

/** The `using` clause every select policy repeats: membership, dm split, reveal time. */
export function visibleTo(viewer: Viewer, entity: BoardEntity, now: number = Date.now()): boolean {
  if (!isMember(viewer)) return false
  if (entity.visibility === 'dm' && !isDm(viewer)) return false
  if (entity.revealAt !== undefined && entity.revealAt > now) return false
  return true
}

export function visibleOnly<T extends BoardEntity>(
  viewer: Viewer,
  entities: readonly T[],
  now?: number,
): T[] {
  return entities.filter((entity) => visibleTo(viewer, entity, now))
}
