/**
 * The pictures on the demo board, as data URIs.
 *
 * A picture is the one kind of entity the demo did not show at all, and a
 * picture needs a file. The board's pictures are things somebody brought to the
 * table — a sketch map, a rubbing, a torn leaf — and a seed board that opens
 * with three grey placeholders would be showing the `<img>` tag rather than the
 * thing the `.image` state is for: the torn border, the swing about the pin,
 * the fit.
 *
 * Inline SVG rather than files under `public/` for three reasons, in order of
 * how much they mattered:
 *
 *   - There is no network in the test suite or the probes, and a seed board
 *     that renders three broken images is worse than one with no pictures.
 *   - This module is seed data and gets deleted when boards arrive from a
 *     server (see `demo.ts`). A directory of binary art is a directory nobody
 *     remembers to delete.
 *   - SVG is text, so the artwork is reviewable in the diff like everything
 *     else here — and it scales to any board zoom without a second asset.
 *
 * These are deliberately drawings rather than photographs. The board is a
 * corkboard in a campaign room, and everything on it was made by hand; the
 * giveaway of a stock photograph would be the one thing on the board that no
 * character in it could have produced.
 *
 * The encoded form is what an `<img src>` takes. `encodeURIComponent` rather
 * than base64 because it leaves the markup readable in a debugger, and because
 * it is what makes the `#` in every colour a literal rather than a fragment.
 */

/** Wrap SVG body markup as a data URI an `<img>` will load. */
function svgDataUri(width: number, height: number, body: string): string {
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(markup)}`
}

/**
 * The marsh map: three docks, a drowned road, and a cross where the bell came
 * up. Hatching for the marsh rather than a texture, because a hand-drawn map of
 * a place like this is mostly a record of what is water and what is not.
 */
export const MARSH_MAP = svgDataUri(
  320,
  240,
  `
  <rect width="320" height="240" fill="#e7dcc0"/>
  <path d="M0 132 C60 118 96 152 150 142 S250 116 320 138 L320 240 L0 240 Z" fill="#b7c2b0"/>
  <path d="M0 132 C60 118 96 152 150 142 S250 116 320 138" fill="none" stroke="#6c6a52" stroke-width="1.2"/>
  <g stroke="#8a8560" stroke-width="0.8">
    <path d="M18 176h16M40 184h16M62 172h16M84 188h16M106 176h16M128 190h16M150 178h16M172 186h16M194 174h16M216 188h16M238 178h16M260 190h16M282 176h14"/>
    <path d="M30 210h16M52 218h16M74 206h16M96 220h16M118 208h16M140 218h16M162 206h16M184 220h16M206 210h16M228 218h16M250 206h16M272 218h14"/>
  </g>
  <path d="M40 120 C70 96 110 100 150 84 S230 58 288 66" fill="none" stroke="#7a6a4a" stroke-width="1.6" stroke-dasharray="5 4"/>
  <path d="M150 84 C160 58 190 42 214 28" fill="none" stroke="#7a6a4a" stroke-width="1.1" stroke-dasharray="4 4"/>
  <g fill="#4c4a38">
    <rect x="60" y="126" width="7" height="7"/>
    <rect x="140" y="134" width="7" height="7"/>
    <rect x="228" y="122" width="7" height="7"/>
  </g>
  <path d="M196 158l16-4-3 8-13 3z" fill="#5c5340"/>
  <path d="M199 154v-11M205 153v-9" stroke="#5c5340" stroke-width="1"/>
  <path d="M240 196l12 12M252 196l-12 12" stroke="#8c2f26" stroke-width="2.4"/>
  <circle cx="246" cy="202" r="13" fill="none" stroke="#8c2f26" stroke-width="1" opacity="0.7"/>
  <text x="14" y="24" font-family="serif" font-size="11" fill="#5c5340" opacity="0.8">SALT MARSH</text>
`,
)

/**
 * The Black Coin, rubbed.
 *
 * A rubbing rather than a photograph of a coin, because that is what you can
 * actually make of a thing you are not allowed to take away: charcoal over
 * paper, which is why the device is pale on dark and the edges of the sheet are
 * smudged. The device is a bell over water — the same bell the board is about,
 * which is the whole reason this rubbing is on the board.
 */
export const COIN_RUBBING = svgDataUri(
  220,
  220,
  `
  <rect width="220" height="220" fill="#ded4bb"/>
  <circle cx="110" cy="110" r="86" fill="#3a352c"/>
  <circle cx="110" cy="110" r="86" fill="none" stroke="#2b271f" stroke-width="3"/>
  <circle cx="110" cy="110" r="72" fill="none" stroke="#cfc4a6" stroke-width="1.4" opacity="0.7"/>
  <circle cx="110" cy="110" r="61" fill="none" stroke="#cfc4a6" stroke-width="0.8" opacity="0.45"/>
  <path d="M110 64c-13 0-21 11-21 25v14h42v-14c0-14-8-25-21-25z" fill="#cfc4a6"/>
  <rect x="104" y="103" width="12" height="6" rx="1" fill="#cfc4a6"/>
  <path d="M117 62a8 8 0 0 1 0-11" fill="none" stroke="#cfc4a6" stroke-width="2"/>
  <g stroke="#cfc4a6" stroke-width="2" fill="none">
    <path d="M74 136q9-6 18 0t18 0 18 0 18 0"/>
    <path d="M78 148q8-6 16 0t16 0 16 0 16 0"/>
  </g>
  <g stroke="#ded4bb" stroke-width="0.7" opacity="0.45">
    <path d="M26 42l32-13M32 60l28-11M168 190l26-11M176 202l20-8"/>
  </g>
`,
)

/**
 * A torn leaf of the ledger.
 *
 * Ruled lines rather than real words: at the size the board draws it the
 * difference between "handwriting" and "text too small to read" is a smudge
 * either way, and fake prose set in a real font reads as a mock-up rather than
 * as a document. One line is in a second hand — the same correction the ledger
 * itself is about.
 */
export const TORN_LEAF = svgDataUri(
  300,
  200,
  `
  <rect width="300" height="200" fill="#e9dfc6"/>
  <g stroke="#4a4334" stroke-width="1.6" fill="none" opacity="0.8" stroke-linecap="round">
    <path d="M26 40q14-5 28 0t30 2 26-3"/>
    <path d="M26 58q18-4 34 1t30-2 24 3 16-2"/>
    <path d="M26 76q16-5 32 0t28 2 30-3"/>
    <path d="M26 94q20-4 36 1t30-2"/>
    <path d="M26 112q14-5 26 0t30 2 34-2 22 1"/>
    <path d="M26 130q18-4 34 1t32-2"/>
    <path d="M26 148q16-5 30 0t28 2"/>
    <path d="M26 166q20-4 36 1t28-2 24 2"/>
  </g>
  <g stroke="#6b3a2e" stroke-width="1.4" fill="none" opacity="0.75" stroke-linecap="round">
    <path d="M196 94q12-3 22 1t18-2"/>
    <path d="M198 112q10-4 20 0"/>
  </g>
  <path d="M186 88l70 6" stroke="#8c2f26" stroke-width="1.6" opacity="0.7"/>
  <path d="M232 148q14-4 26 1t20-3" stroke="#4a4334" stroke-width="1.6" fill="none" opacity="0.5" stroke-linecap="round"/>
`,
)
