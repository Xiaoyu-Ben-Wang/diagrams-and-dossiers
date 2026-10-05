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
 * The width of the page, in board px.
 *
 * Fixed rather than fluid so the article reflows identically for everyone
 * looking at it: an anchor is a character offset, and the offset is only
 * meaningful if the text it counts through is the same width. A per-article
 * width is possible — the resolver is pure and idempotent, so it would simply
 * re-resolve that page — but it is not this.
 */
export const PAPER_WIDTH = 720

/**
 * A post-it's width in board px. Its height comes from the textarea inside it,
 * so this is the one dimension the board has to know.
 */
export const POST_IT_WIDTH = NOTE_SIZE.width

/** Post-it colours, keyed to the yarn palette so the board reads as one set. */
export const POST_IT_COLORS = ['#e8d9a8', '#e6c9a8', '#d9c2b0', '#cfd6bd'] as const
