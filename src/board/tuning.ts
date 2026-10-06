import { NOTE_SIZE } from "../model/kinds";

/** Nudge tolerance, in screen px. */
export const NUDGE_SLOP_PX = 18;

/** How close a string's end must come to a pin to tie, in board px. */
export const SNAP_RADIUS = 34;

/** How close a click must land to a string to select it, in screen px. */
export const STRING_HIT_PX = 10;

/** Width of the halo that marks a selected string, in screen px. */
export const STRING_HALO_PX = 11;

/** The sag handle's footprint, in board px. */
export const HANDLE_SIZE = 20;

/** Slack is rounded to this many steps per unit on every change. */
export const SLACK_STEP = 1000;

/** How far under a picture the border bar hangs, in screen px. */
export const EDGE_PICKER_DROP = 44;

/** Caption top and height below a selected picture, in screen px. */
export const IMAGE_CAPTION_TOP = 48;
export const IMAGE_CAPTION_HEIGHT = 96;

/** What the caption takes out of the gap between picture and border bar, in screen px. */
export const IMAGE_CAPTION_SPACE = IMAGE_CAPTION_TOP + IMAGE_CAPTION_HEIGHT;

/** How narrow and how wide a page may be dragged, in board px. */
export const PAPER_MIN_WIDTH = 380;
export const PAPER_MAX_WIDTH = 1100;

/** How many times a page is folded when it is put away. */
export const PAPER_FOLD_DIVISOR = 3;

/** The shortest a folded page may stand, in board px. */
export const PAPER_FOLD_FLOOR = 150;

export function foldedHeight(openHeight: number): number {
  return Math.max(
    PAPER_FOLD_FLOOR,
    Math.round(openHeight / PAPER_FOLD_DIVISOR),
  );
}

/** The title printed on a folded page: its ceiling, floor, and side margin, in board px. */
export const FOLDER_LABEL_MAX = 42;
export const FOLDER_LABEL_MIN = 14;
export const FOLDER_LABEL_PAD = 18;

/** A post-it's width, in board px; its height comes from the textarea inside it. */
export const POST_IT_WIDTH = NOTE_SIZE.width;

/** Post-it colours, named for the picker. */
export const POST_IT_COLORS = [
  { name: "Yellow", color: "#e8d9a8" },
  { name: "Apricot", color: "#e6c9a8" },
  { name: "Stone", color: "#d9c2b0" },
  { name: "Sage", color: "#cfd6bd" },
] as const;
