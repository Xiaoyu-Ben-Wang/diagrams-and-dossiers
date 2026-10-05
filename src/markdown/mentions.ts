/**
 * Turning `@[Name]` in a rendered article into a link to something on the board.
 *
 * There is an ordering constraint here that is easy to get wrong and expensive
 * to debug, and a second one that is subtler. This module was written once
 * before, as `src/wiki/linkify.ts`, and deleted with the wiki view; the first
 * constraint is from its header, the second is from a review of this rewrite.
 *
 * ## Linkify while producing the HTML, never after
 *
 * `@[Molgar]` renders as the text `Molgar` — the syntax disappears. If that
 * happened *after* the article was projected into flat text, every offset after
 * the mention would shift by three characters and every pin below it would land
 * on the wrong words. So linkification runs as part of producing the HTML, in
 * the same memo as `marked` and the sanitiser, before React commits it and long
 * before `projectDom` measures the committed DOM.
 *
 * ## The markup must not depend on whether the mention resolves
 *
 * This is the one that is not obvious. A mention's anchor is built identically
 * whether or not its target exists — same tag, same text, same attributes — and
 * whether it *resolves* is decided at click time and by a class the board
 * toggles afterwards.
 *
 * The reason is not tidiness. The projection keeps references to the text nodes
 * it measured, and `useArticleViews` only measures again when a layout
 * signature changes or the box resizes. `<a>` and `<span>` are both inline and
 * the same size, so a markup difference that depended on resolution would have
 * React replace `innerHTML` — new text nodes — with no signature change and no
 * resize to notice it. The projection would go on pointing at detached nodes,
 * every anchored pin's rect would resolve to nothing, and the tacks would
 * simply vanish until something else forced a re-measure.
 *
 * Keeping resolution out of the markup also gets the behaviour right for free:
 * a mention that names nothing today becomes clickable the moment something
 * with that name exists, because nothing about the rendered page had to change.
 */

import type { BoardEntity } from '../model/types'

/** The attribute a click handler looks for, and the name it carries. */
export const MENTION_ATTRIBUTE = 'data-mention'

/** The class every mention wears, resolved or not. */
export const MENTION_CLASS = 'mention'

/** The class added afterwards to a mention whose name matches nothing. */
export const MENTION_MISSING_CLASS = 'mention--missing'

export interface Mention {
  /** Offset of the `@` in the text node. */
  index: number
  /** How many characters the whole `@[Name]` run occupies. */
  length: number
  /** The name as written between the brackets, trimmed. */
  name: string
}

/**
 * The syntax: `@[Name]`.
 *
 * The `@` must not be preceded by a letter, a digit or another `@`, so an
 * address like `molgar@[the pale]` is left as the text it looks like rather
 * than sprouting a link out of somebody's email. Brackets rather than a bare
 * `@Name` because names have spaces in them and there would be no way to tell
 * where one ended.
 *
 * A name containing `]` is not representable — there is no escaping, and adding
 * one would mean a second syntax to explain. A name is a title, and a title
 * with a square bracket in it is rare enough to be worth the simplicity.
 */
const MENTION_PATTERN = /(^|[^\p{L}\p{N}@])@\[([^\]\n]+)\]/gu

/** Every mention run in a piece of text, in order. */
export function parseMentions(text: string): Mention[] {
  const found: Mention[] = []
  // A fresh regex per call: `lastIndex` on a shared global regex is state that
  // two concurrent parses would corrupt.
  const pattern = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags)
  for (const match of text.matchAll(pattern)) {
    const name = match[2].trim()
    if (name === '') continue
    // `match.index` is the start of the whole match, which includes the single
    // leading character the pattern captures to check the boundary. The run
    // itself starts at the `@`.
    const at = match.index + match[1].length
    found.push({ index: at, length: match[0].length - match[1].length, name })
  }
  return found
}

/**
 * Where a mention points.
 *
 * A fragment, and always one: an href is needed for the anchor to be focusable
 * and reachable by keyboard, but the name is author-written and must never be
 * able to become a scheme — a name of `javascript:…` would otherwise be
 * executable by middle-click or by keyboard, past a click handler that only
 * guards the ordinary click.
 */
export function mentionHref(name: string): string {
  return `#mention:${encodeURIComponent(name)}`
}

/** The name a mention element carries, or null if it is not one. */
export function mentionName(element: Element | null): string | null {
  return element?.getAttribute?.(MENTION_ATTRIBUTE) ?? null
}

/**
 * Resolve a name to the thing on the board it refers to.
 *
 * Exact match on the title, case-insensitive, and only ever a page or a
 * picture: those are the two kinds a mention can name. A note or a tack that
 * happens to share a title must not be able to hijack a link, and a thing with
 * no title at all is not nameable.
 *
 * First match in board order wins. Two things may share a name — nothing stops
 * it — and the alternative to picking one is refusing to resolve at all, which
 * would make a duplicated name silently break both links instead of resolving
 * at least one of them predictably.
 */
export function resolveMention(name: string, entities: readonly BoardEntity[]): BoardEntity | null {
  const wanted = name.trim().toLowerCase()
  if (wanted === '') return null
  for (const entity of entities) {
    if (entity.kind !== 'article' && entity.kind !== 'image') continue
    const title = entity.title?.trim()
    if (title && title.toLowerCase() === wanted) return entity
  }
  return null
}

/** Elements a mention inside of is not a mention: code, and other links. */
const SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'A'])

/**
 * Replace mention syntax with anchors throughout a rendered article.
 *
 * Takes HTML that has *already* been sanitised and returns HTML for
 * `dangerouslySetInnerHTML`. Sanitise first: everything this adds is built with
 * `textContent` and `setAttribute`, so nothing author-written is ever parsed as
 * markup, and running it after the sanitiser means the sanitiser never has to
 * be told about the one tag this invents.
 *
 * Works on a parsed document rather than on the string, because a regex over
 * raw HTML would happily rewrite `@[...]` inside an attribute value or a
 * `<code>` block.
 */
export function linkifyMentions(html: string): string {
  // Server-side rendering, and jsdom in tests without a document: leave it be.
  if (typeof document === 'undefined') return html
  // Most articles mention nothing, and the parse/serialize round trip is not
  // free. Cheap bail-out before touching the DOM.
  if (!html.includes('@[')) return html

  const template = document.createElement('template')
  template.innerHTML = html

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node as Text
      // Reject code, so an article documenting the syntax does not sprout links
      // out of its own examples, and reject existing links, because an anchor
      // inside an anchor is not markup a browser will keep.
      let parent = text.parentElement
      while (parent) {
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        parent = parent.parentElement
      }
      return text.data.includes('@[') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })

  const textNodes: Text[] = []
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text)
  for (const node of textNodes) replaceInTextNode(node)

  return template.innerHTML
}

function replaceInTextNode(node: Text): void {
  const text = node.data
  const mentions = parseMentions(text)
  if (mentions.length === 0) return

  const fragment = document.createDocumentFragment()
  let cursor = 0

  for (const mention of mentions) {
    if (mention.index > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, mention.index)))
    }
    fragment.appendChild(buildMention(mention.name))
    cursor = mention.index + mention.length
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)))
  }

  node.parentNode?.replaceChild(fragment, node)
}

/**
 * The anchor for one mention.
 *
 * `textContent`, never `innerHTML`: the name is author-written and is displayed
 * exactly as written, which is also what keeps the projection's offsets a pure
 * function of the article's markdown.
 */
function buildMention(name: string): HTMLAnchorElement {
  const anchor = document.createElement('a')
  anchor.textContent = name
  anchor.className = MENTION_CLASS
  anchor.setAttribute('href', mentionHref(name))
  anchor.setAttribute(MENTION_ATTRIBUTE, name)
  return anchor
}

/**
 * Mark the mentions in a rendered article whose names match nothing.
 *
 * Called after the HTML is committed, and deliberately only ever toggles a
 * class: the text nodes the projection measured must survive, or every anchor
 * in the article is measured against nodes that are no longer on the page.
 */
export function markMissingMentions(root: HTMLElement, names: ReadonlySet<string>): void {
  for (const element of root.querySelectorAll<HTMLElement>(`[${MENTION_ATTRIBUTE}]`)) {
    const name = element.getAttribute(MENTION_ATTRIBUTE)?.trim().toLowerCase() ?? ''
    element.classList.toggle(MENTION_MISSING_CLASS, !names.has(name))
  }
}
