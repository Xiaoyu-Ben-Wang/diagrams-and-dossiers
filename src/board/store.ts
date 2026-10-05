/**
 * The board's data, and the two seams every change to it passes through.
 *
 * The board used to be two `useState` arrays inside `App.tsx`, written by a
 * dozen call sites that each reached for `setEntities` and computed the next
 * array themselves. That is a fine way to build a board and a hopeless way to
 * add either of the two things this is for:
 *
 *  - **Permissions.** "May this person do this?" has to be asked in one place,
 *    or it is asked in eleven and answered differently in three. Every mutator
 *    here consults `can()` first, so a viewer's board is one where nothing
 *    happens rather than one where some things happen and some are refused.
 *
 *  - **Live editing.** A change has to be describable to be sendable. Writing
 *    `setEntities(previous => ...)` is a computation over the whole board; a
 *    peer needs to hear "this one pin moved", which the store knows and the
 *    updater does not. Every mutator publishes through `BoardSync`.
 *
 * The state is immutable and replaced wholesale on every change, which is what
 * makes `useSyncExternalStore` correct: the snapshot it compares is the state
 * object itself, so a mutation that changed nothing must not mint a new one.
 * Several mutators below return early for exactly that reason.
 *
 * Ordered arrays are kept in insertion order rather than sorted. Sorting here
 * would mean a move that changes only the order looks like a change to every
 * entity in it. The order is therefore the *board's* order rather than the
 * paint order: every kind carries a `zIndex`, and nothing reads it yet — the
 * board paints in the order the layers are rendered. That is a gap rather than
 * a decision, and it shows the moment two things overlap.
 */

import { useSyncExternalStore } from 'react'

import { can, type Action, type Viewer } from '../access/permissions'
import type { BoardEntity, StringLink } from '../model/types'
import { localSync, type BoardChange, type BoardSync, type SyncStatus } from '../realtime/transport'

export interface BoardState {
  entities: BoardEntity[]
  strings: StringLink[]
}

export interface BoardStore {
  get(): BoardState
  subscribe(listener: () => void): () => void
  status(): SyncStatus

  /**
   * Put entities on the board.
   *
   * Takes a function of the current state as well as a plain list, because the
   * board computes things from what is already there — a new pin's date label
   * is the count of pins already placed. That has to be read inside the change
   * rather than before it, or two additions in one tick would both be told
   * about the board as it was before either of them.
   */
  addEntities(build: BoardEntity[] | ((state: BoardState) => BoardEntity[])): void
  /** Take entities off the board, along with any string that touched them. */
  removeEntities(ids: readonly string[]): void
  /** Change entities in place. A change that returns the same entity is not one. */
  updateEntities(
    ids: readonly string[],
    change: (entity: BoardEntity) => BoardEntity,
  ): void

  addString(link: StringLink): void
  removeStrings(ids: readonly string[]): void
  updateStrings(ids: readonly string[], change: (link: StringLink) => StringLink): void

  /**
   * Make the board this, instead of what it was.
   *
   * What loading a board file is. Not a hundred deletions followed by a hundred
   * additions: that would emit the board emptying and then refilling, and take
   * the camera, the selection and every in-flight anchor resolve through a
   * state that never should have existed. One emit of one state.
   *
   * Nothing is published. `transport.ts` is built on the rule that a change
   * names one thing, precisely so that two people moving different pins cannot
   * overwrite each other's board — and there is no honest single-thing message
   * for "the board is now this". A socket will want a resumable log or an
   * explicit replacement message; inventing one here, against a transport that
   * has nothing on the other end, would be guessing at the shape.
   */
  replaceAll(board: BoardState): void

  /**
   * Apply a change made somewhere else.
   *
   * Deliberately does not publish: a change that arrived over the wire going
   * back out again is how two clients talk each other in circles. It also does
   * not consult `can()` — the sender's board already did, and a client that
   * re-litigates a permission it cannot evaluate is a client that drops other
   * people's work.
   */
  applyRemote(change: BoardChange): void
}

export interface BoardStoreOptions {
  sync?: BoardSync
  viewer: Viewer
  /**
   * What is already on the board when it opens.
   *
   * The board a person arrives at — a seeded demo today, a set of rows fetched
   * from the server later. Deliberately not run through `can()`: a store that
   * re-litigates the permissions of the contents it was handed would drop the
   * board's own rows, exactly as `applyRemote` would for a change that came
   * over the wire. The client that created them asked; this one only reads.
   */
  initial?: BoardState
}

export function createBoardStore({
  sync = localSync(),
  viewer,
  initial,
}: BoardStoreOptions): BoardStore {
  let state: BoardState = initial ?? { entities: [], strings: [] }
  const listeners = new Set<() => void>()

  const emit = (next: BoardState): void => {
    state = next
    for (const listener of listeners) listener()
  }

  /** Whether this viewer may do this at all. Nothing has an owner yet. */
  const allowed = (action: Action, entity?: BoardEntity): boolean => can(viewer, action, entity)

  const publish = (change: BoardChange): void => {
    sync.publish(change)
  }

  /** Drop the strings that would be left hanging by these ids going away. */
  const orphaned = (ids: ReadonlySet<string>, strings: StringLink[]): StringLink[] =>
    strings.filter((link) => ids.has(link.from) || ids.has(link.to))

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    status: () => sync.status(),

    addEntities(build) {
      const incoming = typeof build === 'function' ? build(state) : build
      if (incoming.length === 0) return

      const permitted = incoming.filter((entity) => allowed('create', entity))
      if (permitted.length !== incoming.length) {
        // Logged rather than thrown: a refusal here means the UI offered
        // something it should not have, which is a bug to find, not a crash to
        // hand the person looking at the board. It is reported before the
        // early return below, because "everything was refused" is the case
        // most worth hearing about and would otherwise be the one silence.
        console.warn('board: refused to create', incoming.length - permitted.length, 'entities')
      }
      if (permitted.length === 0) return

      emit({ ...state, entities: [...state.entities, ...permitted] })
      for (const entity of permitted) publish({ kind: 'entity/upsert', entity })
    },

    removeEntities(ids) {
      // Asked once rather than per entity: deleting is the same question for
      // every kind, and an id that is not on the board is not a reason to ask.
      if (!allowed('delete')) return
      const doomed = new Set(ids)
      if (doomed.size === 0) return

      // Captured before the emit, not after. `state` is reassigned by `emit`,
      // so a loop over `state.entities` underneath it would be walking the list
      // the deletions have already been taken out of — and publishing nothing,
      // which is the exact failure a deletion-only channel exists to prevent.
      const going = state.entities.filter((entity) => doomed.has(entity.id))
      const cut = orphaned(doomed, state.strings)
      if (going.length === 0 && cut.length === 0) return

      const gone = new Set(going.map((entity) => entity.id))
      const severed = new Set(cut.map((link) => link.id))
      emit({
        entities: state.entities.filter((entity) => !gone.has(entity.id)),
        strings: state.strings.filter((link) => !severed.has(link.id)),
      })

      for (const entity of going) publish({ kind: 'entity/delete', id: entity.id })
      // A string to something that is gone has nothing to attach to. It is
      // published as a deletion rather than left to be discovered: a peer that
      // keeps drawing a line to a pin that no longer exists draws it to the
      // origin.
      for (const link of cut) publish({ kind: 'string/delete', id: link.id })
    },

    updateEntities(ids, change) {
      const wanted = new Set(ids)
      const touched: BoardEntity[] = []

      const entities = state.entities.map((entity) => {
        if (!wanted.has(entity.id)) return entity
        if (!allowed('edit', entity)) return entity
        const next = change(entity)
        // The same object back means the change decided nothing needed doing.
        // Treating it as a write would republish it and re-render every
        // subscriber for a drag that moved nothing.
        if (next === entity) return entity
        touched.push(next)
        return next
      })

      if (touched.length === 0) return
      emit({ ...state, entities })
      for (const entity of touched) publish({ kind: 'entity/upsert', entity })
    },

    addString(link) {
      if (!allowed('create')) return
      // Two strings between the same pair is the same string drawn twice, and
      // the board already refuses it at the gesture. Refused here too, so the
      // rule survives a caller that forgets.
      const exists = state.strings.some(
        (other) =>
          (other.from === link.from && other.to === link.to) ||
          (other.from === link.to && other.to === link.from),
      )
      if (exists) return

      emit({ ...state, strings: [...state.strings, link] })
      publish({ kind: 'string/upsert', string: link })
    },

    removeStrings(ids) {
      if (!allowed('delete')) return
      const doomed = new Set(ids)
      const strings = state.strings.filter((link) => !doomed.has(link.id))
      if (strings.length === state.strings.length) return

      emit({ ...state, strings })
      for (const id of doomed) publish({ kind: 'string/delete', id })
    },

    updateStrings(ids, change) {
      if (!allowed('edit')) return
      const wanted = new Set(ids)
      const touched: StringLink[] = []

      const strings = state.strings.map((link) => {
        if (!wanted.has(link.id)) return link
        const next = change(link)
        if (next === link) return link
        touched.push(next)
        return next
      })

      if (touched.length === 0) return
      emit({ ...state, strings })
      for (const link of touched) publish({ kind: 'string/upsert', string: link })
    },

    replaceAll(board) {
      // Gated like every other write: replacing the board is the largest edit
      // there is, and a viewer's board is one where nothing happens.
      if (!allowed('create')) return
      // A copy, so a caller that keeps the object it passed — an importer
      // holding the parsed file, say — cannot mutate the board by editing it.
      emit({ entities: [...board.entities], strings: [...board.strings] })
    },

    applyRemote(change) {
      switch (change.kind) {
        case 'entity/upsert': {
          const { entity } = change
          const at = state.entities.findIndex((other) => other.id === entity.id)
          const entities =
            at === -1
              ? [...state.entities, entity]
              : state.entities.map((other) => (other.id === entity.id ? entity : other))
          emit({ ...state, entities })
          return
        }
        case 'entity/delete': {
          const entities = state.entities.filter((other) => other.id !== change.id)
          if (entities.length === state.entities.length) return
          const doomed = new Set([change.id])
          const strings = state.strings.filter(
            (link) => !doomed.has(link.from) && !doomed.has(link.to),
          )
          emit({ entities, strings })
          return
        }
        case 'string/upsert': {
          const { string } = change
          const at = state.strings.findIndex((other) => other.id === string.id)
          const strings =
            at === -1
              ? [...state.strings, string]
              : state.strings.map((other) => (other.id === string.id ? string : other))
          emit({ ...state, strings })
          return
        }
        case 'string/delete': {
          const strings = state.strings.filter((other) => other.id !== change.id)
          if (strings.length === state.strings.length) return
          emit({ ...state, strings })
        }
      }
    },
  }
}

/**
 * The board, as a component sees it.
 *
 * `get` is passed as both the snapshot and the server snapshot: this store is
 * the only source of the board, so there is nothing to render differently on
 * the server and nothing to mismatch on hydration. A store that read from
 * somewhere asynchronous would need the third argument to be a real answer.
 */
export function useBoard(store: BoardStore): BoardState {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
