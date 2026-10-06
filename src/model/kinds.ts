// `board` differs by kind: pin is the tack centre, note/article the top-left, image the
// top-left with its pivot at top-centre. Do not normalise — it would move every entity.

import type { AnchorRect } from "../anchors/dom";
import { rotateAbout, sweptBounds } from "../board/pivot";
import type { Rect } from "../board/camera";
import type { Point } from "../board/yarn";
import {
  isAnchoredPin,
  type BoardEntity,
  type EntityContext,
  type EntityKind,
  type NoteFont,
} from "./types";

export const TACK_SIZE = 14;
export const TACK_RADIUS = TACK_SIZE / 2;
/** Where the anchored tack is drawn relative to the words it holds. */
export const TACK_OFFSET_X = -6;
export const TACK_OFFSET_Y = -5;

/** A post-it's default footprint; the size actually lives on the entity. */
export const NOTE_SIZE = { width: 168, height: 128 } as const;

export const NOTE_FONT_SIZE = 12;
export const NOTE_FONT_SCALE_MIN = 0.75;
export const NOTE_FONT_SCALE_MAX = 2;
export const NOTE_FONT_SCALE_STEP = 0.125;
export const NOTE_FONT_SCALE_DEFAULT = 1;

/** The hand a new note is written in. */
export const NOTE_FONT_DEFAULT: NoteFont = "system";

/** How far either way a note leans, in degrees. */
export const NOTE_TILT_MAX = 0.9;

/**
 * The lean a note was given when it was made, from its own id, so a note that
 * has not been touched keeps the angle it was stuck at. Deriving it rather than
 * rolling dice keeps a board reproducible, and gives boards written before the
 * angle was stored the same scatter instead of a shelf of square notes.
 */
export function seededTilt(id: string): number {
  return round2((unit(hash32(id, 0)) * 2 - 1) * NOTE_TILT_MAX);
}

/** Teeth across a torn edge, and how deep one may bite. */
const TEAR_TEETH = 22;
const TEAR_DEPTH_MAX = 7;

/**
 * The ragged top edge a torn note gets, from its own id. Both how wide each bite
 * is and how deep vary, because an even sawtooth reads as a cut, not a tear.
 */
export function seededTear(id: string): string {
  const widths: number[] = [];
  let total = 0;
  for (let i = 0; i < TEAR_TEETH; i += 1) {
    const width = 0.4 + unit(hash32(id, 101 + i));
    widths.push(width);
    total += width;
  }

  const points: string[] = [];
  let across = 0;
  for (let i = 0; i <= TEAR_TEETH; i += 1) {
    const depth = Math.round(1 + unit(hash32(id, 201 + i)) * TEAR_DEPTH_MAX);
    points.push(`${across.toFixed(1)}% ${depth}px`);
    if (i < TEAR_TEETH) across += (widths[i]! / total) * 100;
  }

  return `polygon(${points.join(", ")}, 100% 100%, 0% 100%)`;
}

/** FNV-1a, then an avalanche pass, so ids differing by one do not land together. */
function hash32(text: string, salt: number): number {
  let hash = 0x811c9dc5 ^ salt;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

/** 0..1, from the same hash under a different salt. */
function unit(hashed: number): number {
  return hashed / 0xffffffff;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Line height as a multiple of the font size, per face. `system` is Tailwind's
 * `leading-snug`, which the note's textarea is given inline; a handwriting face
 * needs more of it, or its ascenders meet the descenders of the line above.
 *
 * These are the one number colour cannot carry over: the ruled and grid papers
 * draw at this pitch, so a face whose ratio is wrong sits off its own rules.
 */
export const NOTE_LINE_RATIOS: Readonly<Record<NoteFont, number>> = {
  system: 1.375,
  "special-elite": 1.45,
  "courier-prime": 1.375,
  kalam: 1.6,
  "rock-salt": 1.75,
};

/** Falls back rather than returning `undefined`, which would collapse the line box. */
export function noteLineRatio(font: NoteFont): number {
  return NOTE_LINE_RATIOS[font] ?? NOTE_LINE_RATIOS[NOTE_FONT_DEFAULT];
}

/** The face's own name, with the role it fills. */
export const NOTE_FONT_LABELS: Readonly<Record<NoteFont, string>> = {
  system: "System",
  "special-elite": "Special Elite (typewriter, worn)",
  "courier-prime": "Courier Prime (typewriter, clean)",
  kalam: "Kalam (handwriting)",
  "rock-salt": "Rock Salt (scrawl)",
};

/** Steps from the floor, not by adding, so up-then-down does not drift off the scale. */
export function stepFontScale(scale: number, direction: 1 | -1): number {
  const steps = Math.round(
    (scale - NOTE_FONT_SCALE_MIN) / NOTE_FONT_SCALE_STEP,
  );
  const next = NOTE_FONT_SCALE_MIN + (steps + direction) * NOTE_FONT_SCALE_STEP;
  const clamped = Math.min(
    NOTE_FONT_SCALE_MAX,
    Math.max(NOTE_FONT_SCALE_MIN, next),
  );
  return Math.round(clamped * 1000) / 1000;
}

/** Default footprint in board px. */
export const IMAGE_SIZE = { width: 260, height: 200 } as const;

/** Half-extent of a free pin's footprint, which is just a tack. */
export const PIN_RADIUS = 10;

/** How far inside a picture's top edge its pin sits, in board px — enough to fit the whole tack. */
export const IMAGE_PIN_INSET = 10;

/** `marqueeSelectable` differs from `movable`: an in-text tack can move but not be band-selected. */
export interface EntityCapabilities {
  marqueeSelectable: boolean;
  movable: boolean;
  connectable: boolean;
  dated: boolean;
  rotatable: boolean;
  editable: boolean;
}

export interface EntityDescriptor<E extends BoardEntity> {
  kind: E["kind"];
  capabilities(entity: E): EntityCapabilities;
  /** The point yarn attaches to, or null when it has no resolvable place. */
  anchorPoint(entity: E, context: EntityContext): Point | null;
  /** Board-space footprint, for hit-testing a rubber band. */
  bounds(entity: E, context: EntityContext): Rect | null;
  /** Zoom-to-fit box; pins override it, since a zero-size box contributes nothing to a fit. */
  frameBounds?(entity: E, context: EntityContext): Rect | null;
  /** Apply a board-space delta. Returns the same entity when it cannot move. */
  move(entity: E, delta: Point): E;
}

/** The tack's centre, in an article's own coordinates. */
export function tackPoint(rect: AnchorRect): Point {
  return {
    x: rect.x + rect.width + TACK_OFFSET_X + TACK_RADIUS,
    y: rect.y + TACK_OFFSET_Y + TACK_RADIUS,
  };
}

const boxAt = (
  point: Point,
  size: { width: number; height: number },
): Rect => ({
  x: point.x,
  y: point.y,
  width: size.width,
  height: size.height,
});

const pin: EntityDescriptor<BoardEntity & { kind: "pin" }> = {
  kind: "pin",
  capabilities: (entity) => ({
    marqueeSelectable: !isAnchoredPin(entity),
    movable: true,
    connectable: true,
    dated: true,
    rotatable: false,
    editable: true,
  }),
  anchorPoint: (entity, context) => {
    if (!isAnchoredPin(entity)) {
      return {
        x: entity.board.x + entity.nudge.x,
        y: entity.board.y + entity.nudge.y,
      };
    }
    const rect = context.anchorRect(entity.id);
    if (!rect) return null;
    const tack = tackPoint(rect);
    // Through the article's mapping, not its corner: the tack turns with the paper, and
    // the nudge is an offset against those words rather than against the board.
    return context.articleToBoard(entity.articleId, {
      x: tack.x + entity.nudge.x,
      y: tack.y + entity.nudge.y,
    });
  },
  bounds: (entity, context) => {
    const at = pin.anchorPoint(entity, context);
    if (!at) return null;
    return { x: at.x, y: at.y, width: 0, height: 0 };
  },
  frameBounds: (entity, context) => {
    const at = pin.anchorPoint(entity, context);
    if (!at) return null;
    return {
      x: at.x - PIN_RADIUS,
      y: at.y - PIN_RADIUS,
      width: PIN_RADIUS * 2,
      height: PIN_RADIUS * 2,
    };
  },
  move: (entity, delta) =>
    isAnchoredPin(entity)
      ? // The shift is kept as a nudge against the words, so the tack follows them.
        {
          ...entity,
          nudge: { x: entity.nudge.x + delta.x, y: entity.nudge.y + delta.y },
        }
      : {
          ...entity,
          board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y },
        },
};

const note: EntityDescriptor<BoardEntity & { kind: "note" }> = {
  kind: "note",
  capabilities: () => ({
    marqueeSelectable: true,
    movable: true,
    connectable: true,
    dated: true,
    rotatable: false,
    editable: true,
  }),
  anchorPoint: (entity) => ({
    // Top-centre, not the centre: rope over the writing, and the centre moves when
    // the note is resized, sliding a tied string down the paper.
    x: entity.board.x + entity.width / 2 + entity.nudge.x,
    y: entity.board.y + entity.nudge.y,
  }),
  bounds: (entity) =>
    boxAt(entity.board, { width: entity.width, height: entity.height }),
  move: (entity, delta) => ({
    ...entity,
    board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y },
  }),
};

const article: EntityDescriptor<BoardEntity & { kind: "article" }> = {
  kind: "article",
  capabilities: (entity) => ({
    marqueeSelectable: true,
    movable: true,
    connectable: true,
    dated: true,
    rotatable: true,
    editable: entity.options.editable,
  }),
  anchorPoint: (entity) => {
    // The tab: the swing pivot, so no angle belongs in this sum. Reads the entity's own
    // width, not the measurement, so yarn can tie before layout — and agrees with `articleToBoard`.
    return {
      x: entity.board.x + entity.options.width / 2 + entity.nudge.x,
      y: entity.board.y,
    };
  },
  bounds: (entity, context) => {
    const size = context.articleSize(entity.id);
    if (!size) return null;
    return sweptBounds(
      entity.board,
      size,
      { x: entity.board.x + size.width / 2, y: entity.board.y },
      entity.rotation,
    );
  },
  move: (entity, delta) => ({
    ...entity,
    board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y },
  }),
};

/** The inset pin is measured inside the sheet, so it must be turned with it. */
function imagePin(entity: BoardEntity & { kind: "image" }): Point {
  const pivot = { x: entity.board.x + entity.width / 2, y: entity.board.y };
  const turned = rotateAbout(
    pivot,
    { x: pivot.x, y: entity.board.y + IMAGE_PIN_INSET },
    entity.rotation,
  );
  return { x: turned.x + entity.nudge.x, y: turned.y + entity.nudge.y };
}

const image: EntityDescriptor<BoardEntity & { kind: "image" }> = {
  kind: "image",
  capabilities: () => ({
    marqueeSelectable: true,
    movable: true,
    connectable: true,
    dated: true,
    rotatable: true,
    editable: true,
  }),
  anchorPoint: (entity) => {
    return imagePin(entity);
  },
  bounds: (entity) => {
    // Swept about the top-centre, not the middle: rotation grows the footprint, and a
    // tilted photo would otherwise escape the band that visibly encloses it.
    const size = { width: entity.width, height: entity.height };
    return sweptBounds(
      entity.board,
      size,
      { x: entity.board.x + entity.width / 2, y: entity.board.y },
      entity.rotation,
    );
  },
  move: (entity, delta) => ({
    ...entity,
    board: { x: entity.board.x + delta.x, y: entity.board.y + delta.y },
  }),
};

/* eslint-disable @typescript-eslint/no-explicit-any -- the table is keyed by
   kind and each entry is typed for its own variant; the union of them is what
   callers see, and `descriptorFor` narrows to match. */
const DESCRIPTORS: { [K in EntityKind]: EntityDescriptor<any> } = {
  pin,
  note,
  article,
  image,
};

export function descriptorFor<E extends BoardEntity>(
  entity: E,
): EntityDescriptor<E> {
  return DESCRIPTORS[entity.kind] as EntityDescriptor<E>;
}

export function descriptorOf(kind: EntityKind): EntityDescriptor<BoardEntity> {
  return DESCRIPTORS[kind] as EntityDescriptor<BoardEntity>;
}
