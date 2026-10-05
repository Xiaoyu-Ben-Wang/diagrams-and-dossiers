import { describe, expect, it } from 'vitest'

import { newArticle, newFreePin } from '../model/create'
import { DEFAULT_ARTICLE_OPTIONS } from '../model/article-options'
import { ROLES, can, isDm, isEditor, isMember, visibleOnly, visibleTo, type Role } from './permissions'

const viewer = (role: Role) => ({ role })

describe('the role predicates', () => {
  it('mirrors is_member, is_editor and is_dm from the policies', () => {
    // Read side by side with `supabase/migrations/0001_init.sql`. If these two
    // tables stop matching, the client offers things the server refuses.
    const expected: Record<Role, { member: boolean; editor: boolean; dm: boolean }> = {
      viewer: { member: true, editor: false, dm: false },
      editor: { member: true, editor: true, dm: false },
      dm: { member: true, editor: true, dm: true },
      owner: { member: true, editor: true, dm: true },
    }

    for (const role of ROLES) {
      expect(isMember(viewer(role)), `${role} is a member`).toBe(expected[role].member)
      expect(isEditor(viewer(role)), `${role} is an editor`).toBe(expected[role].editor)
      expect(isDm(viewer(role)), `${role} is the dm`).toBe(expected[role].dm)
    }
  })
})

describe('can', () => {
  it('lets every member read', () => {
    for (const role of ROLES) {
      expect(can(viewer(role), 'read'), role).toBe(true)
    }
  })

  it('lets a viewer write nothing at all', () => {
    const write = ['create', 'edit', 'move', 'delete'] as const

    for (const action of write) {
      expect(can(viewer('viewer'), action), action).toBe(false)
    }
  })

  it('lets an editor write', () => {
    const write = ['create', 'edit', 'move', 'delete'] as const

    for (const action of write) {
      expect(can(viewer('editor'), action), action).toBe(true)
    }
  })

  it('lets a dm and an owner write', () => {
    for (const role of ['dm', 'owner'] as const) {
      for (const action of ['create', 'edit', 'move', 'delete'] as const) {
        expect(can(viewer(role), action), `${role} ${action}`).toBe(true)
      }
    }
  })

  it('does not need an entity to answer about creating one', () => {
    // There is nothing to ask about yet, and refusing an insert for want of a
    // row the caller is about to insert would be a board you cannot add to.
    expect(can(viewer('editor'), 'create')).toBe(true)
    expect(can(viewer('viewer'), 'create')).toBe(false)
  })

  it('honours an entity that narrows its own reach', () => {
    // An article whose options forbid editing is not editable even by the
    // owner: the role is a ceiling, not a grant. This is the one place a kind
    // gets a say, because it is the kind's own business.
    const locked = newArticle({ x: 0, y: 0 }, '', 'A page', {
      ...DEFAULT_ARTICLE_OPTIONS,
      editable: true,
    })
    expect(can(viewer('owner'), 'edit', locked)).toBe(true)

    const sealed = { ...locked, options: { ...locked.options, editable: false } }
    expect(can(viewer('owner'), 'edit', sealed)).toBe(false)
    // But it may still be moved and deleted — the options govern editing.
    expect(can(viewer('owner'), 'move', sealed)).toBe(true)
    expect(can(viewer('owner'), 'delete', sealed)).toBe(true)
  })
})

describe('visibleTo', () => {
  const now = 1_700_000_000_000

  it('shows a shared item to everyone on the board', () => {
    const pin = newFreePin({ x: 0, y: 0 })

    for (const role of ROLES) {
      expect(visibleTo(viewer(role), pin, now), role).toBe(true)
    }
  })

  it('keeps a dm-only item from a viewer and an editor', () => {
    const secret = { ...newFreePin({ x: 0, y: 0 }), visibility: 'dm' as const }

    expect(visibleTo(viewer('viewer'), secret, now)).toBe(false)
    expect(visibleTo(viewer('editor'), secret, now)).toBe(false)
    expect(visibleTo(viewer('dm'), secret, now)).toBe(true)
    expect(visibleTo(viewer('owner'), secret, now)).toBe(true)
  })

  it('holds back an item until its reveal time', () => {
    const tomorrow = { ...newFreePin({ x: 0, y: 0 }), revealAt: now + 1 }

    expect(visibleTo(viewer('owner'), tomorrow, now)).toBe(false)
    expect(visibleTo(viewer('owner'), tomorrow, now + 1)).toBe(true)
  })

  it('treats an item with no reveal time as already revealed', () => {
    expect(visibleTo(viewer('viewer'), newFreePin({ x: 0, y: 0 }), now)).toBe(true)
  })

  it('reveals at the exact moment, not a tick later', () => {
    const at = { ...newFreePin({ x: 0, y: 0 }), revealAt: now }

    expect(visibleTo(viewer('viewer'), at, now)).toBe(true)
  })
})

describe('visibleOnly', () => {
  it('filters without disturbing the order of what is left', () => {
    const now = 1_700_000_000_000
    const items = [
      { ...newFreePin({ x: 0, y: 0 }), id: 'a' },
      { ...newFreePin({ x: 0, y: 0 }), id: 'b', visibility: 'dm' as const },
      { ...newFreePin({ x: 0, y: 0 }), id: 'c' },
    ]

    expect(visibleOnly(viewer('editor'), items, now).map((item) => item.id)).toEqual(['a', 'c'])
    expect(visibleOnly(viewer('dm'), items, now).map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })
})
