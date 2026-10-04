/**
 * Turning `[[wikilinks]]` in rendered HTML into real anchors.
 *
 * There is an ordering constraint here that is easy to get wrong and expensive
 * to debug. Linkifying `[[Molgar]]` produces the text `Molgar` — the brackets
 * disappear. If that happened *after* the article was projected into flat text,
 * every offset after the link would shift by four characters and every pin below
 * it would land on the wrong words.
 *
 * So linkification runs as part of producing the HTML, before it is handed to
 * React and long before `projectDom` sees it. The projection then measures the
 * final text, and a pin created on "Molgar" keeps resolving whether or not the
 * author later wraps it in brackets — because the *text* never changed.
 *
 * The transform works on a parsed DOM rather than on the HTML string. A regex
 * over raw HTML would happily rewrite `[[...]]` inside an attribute value or a
 * `<code>` block.
 */

import { parseWikiLinks, slugify, type WikiLink } from './links'

export interface LinkifyOptions {
  /**
   * Resolve a target to a slug, or null if no such article exists. Unresolved
   * links are still rendered — as "red links" — because a wiki that silently
   * drops your typo is a wiki where you never notice the typo.
   */
  resolve: (target: string) => string | null
}

const SKIP_TAGS = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE'])

/**
 * Replace wikilink syntax with `<a>` elements throughout a rendered article.
 *
 * Returns the serialized HTML, ready for `dangerouslySetInnerHTML`.
 */
export function linkifyHtml(html: string, options: LinkifyOptions): string {
  if (typeof document === 'undefined') return html
  // Cheap bail-out: most articles have no links at all, and the parse/serialize
  // round trip is not free.
  if (!html.includes('[[')) return html

  const template = document.createElement('template')
  template.innerHTML = html

  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const text = node as Text

      // Reject code, so a session log documenting the syntax doesn't sprout
      // links out of its own examples.
      let parent = text.parentElement
      while (parent) {
        if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT
        parent = parent.parentElement
      }

      return text.data.includes('[[') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })

  const targets: Text[] = []
  while (walker.nextNode()) targets.push(walker.currentNode as Text)

  for (const textNode of targets) {
    replaceInTextNode(textNode, options)
  }

  return template.innerHTML
}

function replaceInTextNode(node: Text, options: LinkifyOptions): void {
  const text = node.data
  const links = parseWikiLinks(text)
  if (links.length === 0) return

  const fragment = document.createDocumentFragment()
  let cursor = 0

  for (const link of links) {
    if (link.index > cursor) {
      fragment.appendChild(document.createTextNode(text.slice(cursor, link.index)))
    }
    fragment.appendChild(buildAnchor(link, options))
    cursor = link.index + link.length
  }

  if (cursor < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(cursor)))
  }

  node.parentNode?.replaceChild(fragment, node)
}

function buildAnchor(link: WikiLink, options: LinkifyOptions): HTMLAnchorElement {
  const slug = options.resolve(link.target)

  const anchor = document.createElement('a')
  // Text content only — the label is author-written and must never be parsed
  // as markup.
  anchor.textContent = link.label

  // A real href, even though navigation is intercepted. Without one the anchor
  // is not focusable and not reachable by keyboard, which would make every
  // wikilink in the article unusable without a mouse.
  anchor.setAttribute(
    'href',
    `#/wiki/${slug ? encodeURIComponent(slug) : `new?title=${encodeURIComponent(link.target)}`}${
      link.section ? `#${encodeURIComponent(slugify(link.section))}` : ''
    }`,
  )

  anchor.className = slug ? 'wikilink' : 'wikilink wikilink-missing'
  anchor.setAttribute('data-wiki-target', link.target)
  if (slug) anchor.setAttribute('data-wiki-slug', slug)
  if (link.section) anchor.setAttribute('data-wiki-section', link.section)
  if (!slug) {
    anchor.setAttribute('title', `${link.target} — no such article yet`)
  }

  // No click listener here, deliberately. This function's output is an HTML
  // string that gets serialized and re-parsed by innerHTML, and listeners do
  // not survive that round trip. The container delegates instead — see
  // `wikiLinkFromEvent`.
  return anchor
}

export interface WikiLinkTarget {
  /** Resolved slug, or the raw target when nothing matched. */
  slug: string
  target: string
  section: string | null
  resolved: boolean
}

/**
 * Read a wikilink out of a click event, for a container to delegate with.
 *
 * Usage:
 *   const link = wikiLinkFromEvent(event)
 *   if (link) { event.preventDefault(); navigate(link) }
 */
export function wikiLinkFromEvent(event: Event): WikiLinkTarget | null {
  const target = event.target
  // Browsers target mouse events at elements, but a synthetic or programmatic
  // dispatch can land on a text node — fall back to its parent rather than
  // silently ignoring the click.
  const element =
    target instanceof Element
      ? target
      : target instanceof Node
        ? target.parentElement
        : null

  const anchor = element?.closest('a[data-wiki-target]')
  if (!anchor) return null

  const rawTarget = anchor.getAttribute('data-wiki-target') ?? ''
  const slug = anchor.getAttribute('data-wiki-slug')

  return {
    slug: slug ?? rawTarget,
    target: rawTarget,
    section: anchor.getAttribute('data-wiki-section'),
    resolved: slug !== null,
  }
}

/** Count the links in rendered HTML, for a summary line. */
export function countWikiLinks(html: string): number {
  return parseWikiLinks(stripTags(html)).length
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}
