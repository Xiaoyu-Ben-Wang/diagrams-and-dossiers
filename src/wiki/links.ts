/**
 * `[[wikilinks]]` and backlinks.
 *
 * The convention is Obsidian's, which is what a tabletop group is most likely to
 * already have notes in:
 *
 *     [[Molgar the Pale]]          links to that article
 *     [[Molgar the Pale|the pale]] shows "the pale" but links to the article
 *
 * The one genuinely fiddly part is that `[[` means nothing inside code. A
 * session log that documents a note syntax, or an article quoting a macro, would
 * otherwise sprout phantom links to pages called `0]` and `key`. So the scanner
 * tracks fenced blocks and inline spans and skips them — which is also what the
 * real markdown pipeline gives us for free, since remark hands us an AST with
 * code already separated out.
 */

export interface WikiLink {
  /** The article this points at, as written. */
  target: string
  /** Section within the article, if the link had a `#`. */
  section: string | null
  /** What to display. Defaults to the target when there's no alias. */
  label: string
  /** Offset into the source text, for mapping back to a position. */
  index: number
  /** Length of the whole `[[...]]` construct. */
  length: number
}

export interface Backlink {
  fromSlug: string
  fromTitle: string
  /** How many times the source links here. */
  count: number
}

/** Normalize a title into a stable slug, matching Obsidian's behaviour closely enough. */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** A line that opens or closes a fenced code block. */
const FENCE = /^\s*(```|~~~)/

/**
 * Find every wikilink in a markdown document, in order.
 *
 * Inline code spans are tracked per line: a backtick run opens a span and the
 * matching run closes it. Code inside a span cannot contain a wikilink, which is
 * what stops `\`[[x]]\`` from rendering as a link.
 */
export function parseWikiLinks(text: string): WikiLink[] {
  const links: WikiLink[] = []
  let inFence = false
  let offset = 0

  for (const line of text.split('\n')) {
    if (FENCE.test(line)) {
      inFence = !inFence
      offset += line.length + 1
      continue
    }

    if (!inFence) {
      links.push(...scanLine(line, offset))
    }

    offset += line.length + 1
  }

  return links
}

function scanLine(line: string, lineOffset: number): WikiLink[] {
  const found: WikiLink[] = []
  let inCode = false
  let codeDelimiter = ''
  let i = 0

  while (i < line.length) {
    const char = line[i]

    if (char === '`') {
      // Count the backtick run — `` opens a span that only `` closes.
      let run = 0
      while (line[i + run] === '`') run++
      const delimiter = '`'.repeat(run)

      if (!inCode) {
        inCode = true
        codeDelimiter = delimiter
      } else if (delimiter === codeDelimiter) {
        inCode = false
        codeDelimiter = ''
      }

      i += run
      continue
    }

    if (!inCode && char === '[' && line[i + 1] === '[') {
      const close = line.indexOf(']]', i + 2)
      if (close !== -1) {
        const inner = line.slice(i + 2, close)
        const link = parseInner(inner, lineOffset + i, close + 2 - i)
        if (link) found.push(link)
        i = close + 2
        continue
      }
    }

    i++
  }

  return found
}

function parseInner(inner: string, index: number, length: number): WikiLink | null {
  const raw = inner.trim()
  // An empty `[[]]`, or one that is nothing but an alias, is not a link.
  if (!raw) return null

  const [targetPart, ...labelParts] = raw.split('|')
  const [target, section] = splitSection(targetPart.trim())

  if (!target) return null

  const alias = labelParts.join('|').trim()

  return {
    target,
    section: section || null,
    label: alias || target,
    index,
    length,
  }
}

function splitSection(value: string): [string, string] {
  const hash = value.indexOf('#')
  if (hash === -1) return [value, '']
  return [value.slice(0, hash).trim(), value.slice(hash + 1).trim()]
}

export interface ArticleLike {
  slug: string
  title: string
  body: string
}

/**
 * Resolve a link target to an article slug.
 *
 * Tried in order of confidence: exact slug, exact title, then slugified title.
 * Case-insensitive throughout, because nobody types `[[molgar the pale]]` the
 * same way twice and a wiki that punishes that is a wiki nobody links in.
 */
export function resolveTarget(
  link: WikiLink,
  articles: Array<{ slug: string; title: string }>,
): string | null {
  const wanted = link.target.toLowerCase()
  const wantedSlug = slugify(link.target)

  for (const article of articles) {
    if (article.slug.toLowerCase() === wanted) return article.slug
  }
  for (const article of articles) {
    if (article.title.toLowerCase() === wanted) return article.slug
  }
  for (const article of articles) {
    if (article.slug.toLowerCase() === wantedSlug) return article.slug
  }

  return null
}

/**
 * Which articles each article is linked from.
 *
 * Only links that actually resolve count. A backlink panel listing typos would
 * be worse than no panel, because it implies the article exists.
 */
export function buildBacklinks(articles: ArticleLike[]): Map<string, Backlink[]> {
  const backlinks = new Map<string, Backlink[]>()
  const bySlug = new Map(articles.map((article) => [article.slug, article]))

  for (const source of articles) {
    const counts = new Map<string, number>()

    for (const link of parseWikiLinks(source.body)) {
      const target = resolveTarget(link, articles)
      if (!target || target === source.slug) continue
      counts.set(target, (counts.get(target) ?? 0) + 1)
    }

    for (const [target, count] of counts) {
      if (!bySlug.has(target)) continue
      const existing = backlinks.get(target) ?? []
      existing.push({ fromSlug: source.slug, fromTitle: source.title, count })
      backlinks.set(target, existing)
    }
  }

  // Stable ordering, so the panel doesn't reshuffle between renders.
  for (const list of backlinks.values()) {
    list.sort((a, b) => a.fromTitle.localeCompare(b.fromTitle))
  }

  return backlinks
}

/** Link targets that don't correspond to any article — "red links". */
export function unresolvedLinks(
  articles: ArticleLike[],
): Array<{ target: string; fromTitle: string }> {
  const missing: Array<{ target: string; fromTitle: string }> = []
  const seen = new Set<string>()

  for (const article of articles) {
    for (const link of parseWikiLinks(article.body)) {
      if (resolveTarget(link, articles)) continue
      const key = `${link.target}|${article.slug}`
      if (seen.has(key)) continue
      seen.add(key)
      missing.push({ target: link.target, fromTitle: article.title })
    }
  }

  return missing
}
