import { useSyncExternalStore } from "react";

import { can, type Action, type Viewer } from "../access/permissions";
import type { BoardEntity, StringLink } from "../model/types";
import {
  localSync,
  type BoardChange,
  type BoardSync,
  type SyncStatus,
} from "../realtime/transport";

export interface BoardState {
  entities: BoardEntity[];
  strings: StringLink[];
}

export interface BoardStore {
  get(): BoardState;
  subscribe(listener: () => void): () => void;
  status(): SyncStatus;

  /** The function form reads current state, so two additions in one tick see each other. */
  addEntities(
    build: BoardEntity[] | ((state: BoardState) => BoardEntity[]),
  ): void;
  removeEntities(ids: readonly string[]): void;
  /** A change that returns the same entity is not one. */
  updateEntities(
    ids: readonly string[],
    change: (entity: BoardEntity) => BoardEntity,
  ): void;

  addString(link: StringLink): void;
  removeStrings(ids: readonly string[]): void;
  updateStrings(
    ids: readonly string[],
    change: (link: StringLink) => StringLink,
  ): void;

  replaceAll(board: BoardState): void;

  applyRemote(change: BoardChange): void;
}

export interface BoardStoreOptions {
  sync?: BoardSync;
  viewer: Viewer;
  initial?: BoardState;
}

export function createBoardStore({
  sync = localSync(),
  viewer,
  initial,
}: BoardStoreOptions): BoardStore {
  let state: BoardState = initial ?? { entities: [], strings: [] };
  const listeners = new Set<() => void>();

  const emit = (next: BoardState): void => {
    state = next;
    for (const listener of listeners) listener();
  };

  const allowed = (action: Action, entity?: BoardEntity): boolean =>
    can(viewer, action, entity);

  const publish = (change: BoardChange): void => {
    sync.publish(change);
  };

  const orphaned = (
    ids: ReadonlySet<string>,
    strings: StringLink[],
  ): StringLink[] =>
    strings.filter((link) => ids.has(link.from) || ids.has(link.to));

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status: () => sync.status(),

    addEntities(build) {
      const incoming = typeof build === "function" ? build(state) : build;
      if (incoming.length === 0) return;

      const permitted = incoming.filter((entity) => allowed("create", entity));
      if (permitted.length !== incoming.length) {
        // Logged, not thrown: this is a UI bug to find, and before the return so all-refused isn't silent.
        console.warn(
          "board: refused to create",
          incoming.length - permitted.length,
          "entities",
        );
      }
      if (permitted.length === 0) return;

      emit({ ...state, entities: [...state.entities, ...permitted] });
      for (const entity of permitted)
        publish({ kind: "entity/upsert", entity });
    },

    removeEntities(ids) {
      if (!allowed("delete")) return;
      const doomed = new Set(ids);
      if (doomed.size === 0) return;

      // Captured before emit — `state` is reassigned, so reading it afterwards picks up the new list.
      const going = state.entities.filter((entity) => doomed.has(entity.id));
      const cut = orphaned(doomed, state.strings);
      if (going.length === 0 && cut.length === 0) return;

      const gone = new Set(going.map((entity) => entity.id));
      const severed = new Set(cut.map((link) => link.id));
      emit({
        entities: state.entities.filter((entity) => !gone.has(entity.id)),
        strings: state.strings.filter((link) => !severed.has(link.id)),
      });

      for (const entity of going)
        publish({ kind: "entity/delete", id: entity.id });
      // Strings to removed entities are published as deletions; a peer left drawing one draws to the origin.
      for (const link of cut) publish({ kind: "string/delete", id: link.id });
    },

    updateEntities(ids, change) {
      const wanted = new Set(ids);
      const touched: BoardEntity[] = [];

      const entities = state.entities.map((entity) => {
        if (!wanted.has(entity.id)) return entity;
        if (!allowed("edit", entity)) return entity;
        const next = change(entity);
        if (next === entity) return entity;
        touched.push(next);
        return next;
      });

      if (touched.length === 0) return;
      emit({ ...state, entities });
      for (const entity of touched) publish({ kind: "entity/upsert", entity });
    },

    addString(link) {
      if (!allowed("create")) return;
      const exists = state.strings.some(
        (other) =>
          (other.from === link.from && other.to === link.to) ||
          (other.from === link.to && other.to === link.from),
      );
      if (exists) return;

      emit({ ...state, strings: [...state.strings, link] });
      publish({ kind: "string/upsert", string: link });
    },

    removeStrings(ids) {
      if (!allowed("delete")) return;
      const doomed = new Set(ids);
      const strings = state.strings.filter((link) => !doomed.has(link.id));
      if (strings.length === state.strings.length) return;

      emit({ ...state, strings });
      for (const id of doomed) publish({ kind: "string/delete", id });
    },

    updateStrings(ids, change) {
      if (!allowed("edit")) return;
      const wanted = new Set(ids);
      const touched: StringLink[] = [];

      const strings = state.strings.map((link) => {
        if (!wanted.has(link.id)) return link;
        const next = change(link);
        if (next === link) return link;
        touched.push(next);
        return next;
      });

      if (touched.length === 0) return;
      emit({ ...state, strings });
      for (const link of touched)
        publish({ kind: "string/upsert", string: link });
    },

    replaceAll(board) {
      if (!allowed("create")) return;
      // Copied so a caller holding the parsed object cannot mutate the board through it.
      emit({ entities: [...board.entities], strings: [...board.strings] });
    },

    applyRemote(change) {
      switch (change.kind) {
        case "entity/upsert": {
          const { entity } = change;
          const at = state.entities.findIndex(
            (other) => other.id === entity.id,
          );
          const entities =
            at === -1
              ? [...state.entities, entity]
              : state.entities.map((other) =>
                  other.id === entity.id ? entity : other,
                );
          emit({ ...state, entities });
          return;
        }
        case "entity/delete": {
          const entities = state.entities.filter(
            (other) => other.id !== change.id,
          );
          if (entities.length === state.entities.length) return;
          const doomed = new Set([change.id]);
          const strings = state.strings.filter(
            (link) => !doomed.has(link.from) && !doomed.has(link.to),
          );
          emit({ entities, strings });
          return;
        }
        case "string/upsert": {
          const { string } = change;
          const at = state.strings.findIndex((other) => other.id === string.id);
          const strings =
            at === -1
              ? [...state.strings, string]
              : state.strings.map((other) =>
                  other.id === string.id ? string : other,
                );
          emit({ ...state, strings });
          return;
        }
        case "string/delete": {
          const strings = state.strings.filter(
            (other) => other.id !== change.id,
          );
          if (strings.length === state.strings.length) return;
          emit({ ...state, strings });
        }
      }
    },
  };
}

export function useBoard(store: BoardStore): BoardState {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
