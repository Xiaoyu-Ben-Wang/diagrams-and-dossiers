import { NOTE_SIZE } from '../model/kinds'

/**
 * The dials the board's feel is set by.
 *
 * Gathered here rather than left scattered through the component, because these
 * are the numbers you change to change how the board behaves — how close a
 * click must land to a string, how far a pin may be nudged before it counts as
 * a re-pin, how much slack one step of the sag handle is worth. Finding them
 * used to mean reading a two-thousand-line render.
 *
 * Everything with a unit says so. Screen pixels stay the same size at any zoom
 * and board pixels do not, so the difference matters: several of these are
 * divided by the camera's zoom at the point of use, and one used without that
 * division would be a hit target that shrinks as you zoom out.
 */

/**
 * How far off its own word a dropped pin may land and still count as a nudge,
 * in screen px.
 *
 * A caret clamps to the nearest text, so without this a tack shifted by more
 * than the width of the gap after its word silently re-pins itself to the next
 * one — about five pixels of leeway, which is less than the tack is wide.
 *
 * It is a compromise, and worth knowing where it bites: two short words with
 * only a space between them both fall inside one tack's slop, so a pin cannot
 * be re-pinned from one to the other in a single small drag. Dragging it
 * further, or onto a longer word, still re-anchors.
 */
export const NUDGE_SLOP_PX = 18

/**
 * How close a string's end must come to a pin to be tied to it, in board px.
 *
 * Board px, not screen: this is the reach of the rope rather than the size of
 * the target, and a string that could be tied from further away when zoomed out
 * would be tied by accident.
 */
export const SNAP_RADIUS = 34

/**
 * How close a click must land to a string to select it, in screen px.
 *
 * Added to the fuzz's own reach: 'realistic' sprays filaments up to
 * `maxStrandDeviation()` either side of the base curve, so hit-testing the
 * curve alone would miss a click that plainly landed on visible wool.
 */
export const STRING_HIT_PX = 10

/**
 * Width of the halo that marks a selected string, in screen px.
 *
 * Screen px, not board px: this is an affordance rather than part of the yarn,
 * so it has to stay legible at any zoom. Divided by zoom where it is drawn.
 */
export const STRING_HALO_PX = 11

/** The sag handle's footprint in board px, and so how big a target it is to grab. */
export const HANDLE_SIZE = 20

/**
 * Slack is rounded to this many steps per unit on every change.
 *
 * Slack is interpolated raw into the yarn geometry cache key, so a continuous
 * drag would otherwise mint a fresh cache entry every frame and evict the
 * board's settled strings as it went. Three decimals is sub-pixel: at a 600px
 * gap one step moves the droop by under half a pixel.
 */
export const SLACK_STEP = 1000

/**
 * How far under a picture the border bar hangs, in *screen* px.
 *
 * Screen rather than board: the bar lives in viewport space now, so it does not
 * scale with the zoom and its clearance from the picture should not either.
 */
export const EDGE_PICKER_DROP = 44

/**
 * The caption under a selected picture: where it starts and how tall it is, in
 * *screen* px.
 *
 * Screen, like `EDGE_PICKER_DROP` and for the same reason — the caption is
 * chrome rather than part of the picture, so it does not scale with the board.
 * The top clears the rotate handle, which is already hanging under the picture;
 * the height is fixed rather than grown to fit the description so that the
 * border bar below it has somewhere predictable to sit.
 */
export const IMAGE_CAPTION_TOP = 48
export const IMAGE_CAPTION_HEIGHT = 96

/**
 * What the caption takes out of the gap between the picture and the border bar.
 *
 * Exported as one number because two places have to agree on it: the caption
 * draws itself here, and the bar is placed that much further down.
 */
export const IMAGE_CAPTION_SPACE = IMAGE_CAPTION_TOP + IMAGE_CAPTION_HEIGHT

/**
 * How narrow and how wide a page may be dragged, in board px.
 *
 * Board px rather than screen, because a width is a fact about the page and not
 * about the camera looking at it: the same sheet dragged wider at 50% zoom must
 * come back the same width at 100%. Compare `STRING_HIT_PX`, which is measured
 * the other way round for the other reason.
 *
 * Per page, applied by each sheet's own resize — a board can hold several pages
 * at once and each has its own. This is the clamp and not the width: a page's
 * own width lives in its `options`, whose default is in
 * `model/article-options.ts`.
 *
 * The floor is about where the article's own margins start eating the text; the
 * ceiling is where a line stops being readable and starts being a headache —
 * past roughly ninety characters the eye loses its place on the return sweep.
 */
export const PAPER_MIN_WIDTH = 380
export const PAPER_MAX_WIDTH = 1100

/**
 * A post-it's width in board px. Its height comes from the textarea inside it,
 * so this is the one dimension the board has to know.
 */
export const POST_IT_WIDTH = NOTE_SIZE.width

/** Post-it colours, keyed to the yarn palette so the board reads as one set. */
export const POST_IT_COLORS = ['#e8d9a8', '#e6c9a8', '#d9c2b0', '#cfd6bd'] as const
