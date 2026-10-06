/**
 * Linkify before projection (a later rewrite shifts offsets) and keep the markup
 * independent of resolution (a swap replaces the measured text nodes).
 */

import type { BoardEntity } from '../model/types'

export const MENTION_ATTRIBUTE = 'data-mention'

export const MENTION_CLASS = 'mention'

export const MENTION_MISSING_CLASS = 'mention--missing'

export interface Mention {
  index: number
  length: number
  name: string
}

/** `@[Name]`: the `@` must not follow a letter, digit or `@`, so an email is not a mention. */
const MENTION_PATTERN = /(^|[^\p{L}\p{N}@])@\[([^\]\n]+)\]/gu

export function parseMentions(text: string): Mention[] {
  const found: Mention[] = []
  // A fresh regex per call: `lastIndex` on a shared global regex is state that
  // two concurrent parses would corrupt.
  const pattern = new RegExp(MENTION_PATTERN.source, MENTION_PATTERN.flags)
  for (const match of text.matchAll(pattern)) {
    const name = match[2].trim()
    if (name === '') continue
    // `match.index` is the start of the whole match, including the captured
    // leading boundary character; the run itself starts at the `@`.
    const at = match.index + match[1].length
    found.push({ index: at, length: match[0].length - match[1].length, name })
  }
  return found
}

/**
 * A fragment, always: an href is needed for the anchor to be focusable, but a
 * name of `javascript:…` must not be executable by middle-click or keyboard.
 */
export function mentionHref(name: string): string {
  return `#mention:${encodeURIComponent(name)}`
}

export function mentionName(element: Element | null): string | null {
  return element?.getAttribute?.(MENTION_ATTRIBUTE) ?? null
}

/** Only articles and images are nameable; exact case-insensitive title match, first wins. */
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

const SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'A'])

/** Input must already be sanitised; works on a parsed document, not the HTML string. */
export function linkifyMentions(html: string): string {
  // Server-side rendering, and jsdom in tests without a document: leave it be.
  if (typeof document === 'undefined') return html
  if (!html.includes('@[')) return html

  const template = document.createElement('template')
  template.innerHTML = html

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node as Text
      // Reject code (examples must not linkify) and existing links (an anchor
      // inside an anchor is not markup a browser will keep).
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

/** `textContent`, never `innerHTML`: the name is author-written and shown verbatim. */
function buildMention(name: string): HTMLAnchorElement {
  const anchor = document.createElement('a')
  anchor.textContent = name
  anchor.className = MENTION_CLASS
  anchor.setAttribute('href', mentionHref(name))
  anchor.setAttribute(MENTION_ATTRIBUTE, name)
  return anchor
}

/**
 * Only toggles a class: replacing a text node the projection measured would
 * blank every anchored pin in the article.
 */
export function markMissingMentions(root: HTMLElement, names: ReadonlySet<string>): void {
  for (const element of root.querySelectorAll<HTMLElement>(`[${MENTION_ATTRIBUTE}]`)) {
    const name = element.getAttribute(MENTION_ATTRIBUTE)?.trim().toLowerCase() ?? ''
    element.classList.toggle(MENTION_MISSING_CLASS, !names.has(name))
  }
}
