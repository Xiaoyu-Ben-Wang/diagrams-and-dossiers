// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import {
  ARTICLE_ID,
  ARTICLE_IDS,
  FOURTH_ARTICLE_ID,
  SECOND_ARTICLE_ID,
  THIRD_ARTICLE_ID,
} from './app/demo'
import { DEFAULT_SLACK, sagFor, YARN_COLOR } from './board/yarn'
import { demoBoard, demoPages } from './app/demo'
import { parseBoardFile, readBoardFile, serializeBoard } from './board/board-file'
import { newArticle } from './model/create'
import type { BoardEntity } from './model/types'

/**
 * Smoke tests.
 *
 * jsdom has no layout engine, so every pin resolves to a null rect and nothing
 * is positioned. That is what makes these worth running: the tree renders end to
 * end — markdown pipeline, sanitizer, linkifier, anchor projection, canvas,
 * timeline — without any of the measurement machinery throwing.
 *
 * The URL is real state that persists across tests in a file, so it is reset
 * between them; otherwise a test that navigates leaves every later test on
 * whichever path it went to.
 */
beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

/**
 * A tap: press and release without travel.
 *
 * The paper's tab both selects and drags, so it reads pointer events and tells
 * the two apart by how far the pointer moved. `fireEvent.click` alone never
 * reaches it.
 */
function tap(element: Element): void {
  fireEvent.pointerDown(element, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
  fireEvent.pointerUp(element, { button: 0, pointerId: 1, clientX: 10, clientY: 10 })
}

/**
 * One page's sheet, by the article it belongs to.
 *
 * The board has more than one page now, so a bare `getByTestId('paper')` is
 * ambiguous — and ambiguous in the worst way, since it throws rather than
 * picking one. Naming the article is also what makes an assertion say *which*
 * page it is about, which is the whole point of there being several.
 */
function sheet(container: HTMLElement, articleId: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-article-id="${articleId}"]`)
  if (!element) throw new Error(`no sheet for article ${articleId}`)
  return element
}

/** The board's four seeded pages, in board order. */
const FIRST_PAGE = ARTICLE_ID
const SECOND_PAGE = SECOND_ARTICLE_ID
const THIRD_PAGE = THIRD_ARTICLE_ID
const FOURTH_PAGE = FOURTH_ARTICLE_ID

/**
 * The board with its pages on it and nothing else.
 *
 * Every behavioural test renders this rather than `<App />`. The demo board is
 * a real board — notes down the margin, pictures and tacks off to the right,
 * yarn crossing between them — and a test that asserts "one pin was added" or
 * "the band selected one thing" should be counting what it did, not adding demo
 * content into the total and subtracting it back out. The demo board has its
 * own tests below, which is where its contents belong.
 *
 * The pages are still not neutral fixtures: one is seeded tilted and one
 * rolled up, because those are states the demo exists to show. A test that
 * wants a page hanging straight should say so against `FIRST_PAGE`, which is
 * the one the demo leaves alone.
 */
function renderBoard() {
  return render(<App seed={{ entities: demoPages(), strings: [] }} />)
}

describe('App — the board', () => {
  it('renders without throwing', () => {
    renderBoard()
    expect(screen.getByText('The Case Board')).toBeTruthy()
  })

  it('renders markdown into real elements, not raw text', () => {
    const { container } = renderBoard()
    const article = sheet(container, FIRST_PAGE).querySelector('.article')
    expect(article).not.toBeNull()

    expect(article!.querySelector('h1')?.textContent).toBe('The Drowned Bell')
    expect(article!.textContent).toContain('Black Coin')
    expect(article!.querySelectorAll('li').length).toBeGreaterThan(0)
  })

  it('sanitizes the article rather than injecting raw html', () => {
    const { container } = renderBoard()
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders the article as prose, with the mention syntax resolved away', () => {
    const { container } = renderBoard()
    const article = sheet(container, FIRST_PAGE).querySelector('.article')!

    // Neither the syntax this build implements nor the one the editor used to
    // promise is left lying about in the text.
    expect(article.textContent).not.toContain('@[')
    expect(article.textContent).not.toContain('[[')
    expect(article.textContent).toContain('Molgar the Pale')

    // What is left is the name, and a fragment to hang the click on rather than
    // anywhere a browser would go by itself.
    const link = article.querySelector('a.mention')
    expect(link?.textContent).toBe('The Black Coin')
    expect(link?.getAttribute('href')?.startsWith('#')).toBe(true)
  })

  it('renders the board grid', () => {
    renderBoard()
    expect(screen.getByTestId('board-grid')).toBeTruthy()
  })
})

describe('App — document selection', () => {
  it('hides the markdown editor until a document is selected', () => {
    // The board is the point of the app; a permanently docked editor would eat
    // a third of it for the majority of the time you are not typing.
    renderBoard()
    expect(screen.queryByLabelText('Article markdown source')).toBeNull()
  })

  it('opens the editor when the document tab is clicked', () => {
    const { container } = renderBoard()
    tap(within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab'))

    const editor = screen.getByTestId('paper-editor')
    expect(editor).toBeTruthy()
    expect(within(editor).getByLabelText('Article markdown source')).toBeTruthy()
  })

  it('shows the formatting toolbar alongside the editor', () => {
    const { container } = renderBoard()
    tap(within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab'))

    const toolbar = screen.getByTestId('markdown-toolbar')
    expect(within(toolbar).getByLabelText(/Bold/)).toBeTruthy()
    expect(within(toolbar).getByLabelText(/Italic/)).toBeTruthy()
  })

  it('closes the editor when the tab is clicked again', () => {
    const { container } = renderBoard()
    const tab = within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab')
    tap(tab)
    tap(tab)

    expect(screen.queryByTestId('paper-editor')).toBeNull()
  })

  it('applies a formatting action to the source', () => {
    const { container } = renderBoard()
    tap(within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab'))

    const textarea = screen.getByLabelText('Article markdown source') as HTMLTextAreaElement
    textarea.setSelectionRange(0, 14)
    fireEvent.click(within(screen.getByTestId('markdown-toolbar')).getByLabelText(/Bold/))

    expect(textarea.value.startsWith('**# The Drowned')).toBe(true)
  })

  it('opens the editor on the page whose tab was clicked', async () => {
    // The regression this whole change is about, at the level a person sees it:
    // with one `documentSelected` flag, tapping the second page's tab opened an
    // editor over the *first* page's markdown — and the first page is the one
    // whose text you would then have been rewriting.
    const { container } = renderBoard()
    tap(within(sheet(container, SECOND_PAGE)).getByTestId('paper-tab'))

    const editor = screen.getByTestId('paper-editor')
    expect(within(editor).getByText("The Harbormaster's Ledger")).toBeTruthy()

    const textarea = within(editor).getByLabelText('Article markdown source') as HTMLTextAreaElement
    expect(textarea.value).toContain('Sea Ghost')
    expect(textarea.value).not.toContain('Drowned Bell')
  })

  it('moves the editor with the selection rather than opening a second one', () => {
    // One editor, bound to whichever page is selected. Two open at once would
    // be two textareas over one board, and no answer to which one Escape closes.
    const { container } = renderBoard()
    tap(within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab'))
    tap(within(sheet(container, SECOND_PAGE)).getByTestId('paper-tab'))

    expect(screen.getAllByTestId('paper-editor').length).toBe(1)
    expect(
      (screen.getByLabelText('Article markdown source') as HTMLTextAreaElement).value,
    ).toContain('Sea Ghost')
  })
})

describe('App — four pages on the board', () => {
  it('renders a sheet, a tab and a pin for each', () => {
    const { container } = renderBoard()

    expect(container.querySelectorAll('[data-article-id]').length).toBe(ARTICLE_IDS.length)
    expect(screen.getAllByTestId('paper-tab').length).toBe(ARTICLE_IDS.length)
    expect(screen.getAllByTestId('paper-pin').length).toBe(ARTICLE_IDS.length)
  })

  it('labels each tab with its own page', () => {
    const { container } = renderBoard()

    expect(sheet(container, FIRST_PAGE).textContent).toContain('The Drowned Bell')
    expect(sheet(container, SECOND_PAGE).textContent).toContain("The Harbormaster's Ledger")
    expect(sheet(container, THIRD_PAGE).textContent).toContain("The Ferryman's Account")
    expect(sheet(container, FOURTH_PAGE).textContent).toContain("The Sea Ghost's Manifest")
  })

  it('gives each page the width its own options ask for', () => {
    // The per-article width, which used to be one `PAPER_WIDTH` for the board —
    // and four different widths rather than two, because with two the thing
    // being tested (each page carries its own) and the thing that would pass by
    // accident (a shared default) are harder to tell apart.
    const { container } = renderBoard()

    expect(sheet(container, FIRST_PAGE).style.width).toBe('720px')
    expect(sheet(container, SECOND_PAGE).style.width).toBe('520px')
    expect(sheet(container, THIRD_PAGE).style.width).toBe('500px')
    expect(sheet(container, FOURTH_PAGE).style.width).toBe('560px')
  })

  it('resolves a pin against the page it was pinned to, not the first one', async () => {
    // The load-bearing assertion of the whole refactor. A pin carries an
    // article id, and the quote it holds exists in exactly one of these two
    // documents — so a resolver that reached for "the article", as it did when
    // there was only one, finds nothing and reports the pin orphaned.
    const { container } = renderBoard()
    const second = sheet(container, SECOND_PAGE)
    const body = second.querySelector('.article') as HTMLElement

    const caret = (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint
    ;(document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => {
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT)
      const text = walker.nextNode() as Text | null
      if (!text) return null
      const range = document.createRange()
      range.setStart(text, 0)
      range.collapse(true)
      return range
    }

    try {
      fireEvent.click(body, { ctrlKey: true, clientX: 120, clientY: 60 })

      const tacks = container.querySelectorAll('button[data-pin-id]')
      expect(tacks.length).toBe(1)
      const tack = tacks[0] as HTMLElement

      // 'exact' and not 'orphaned': the quote was created from this page's text
      // and found in this page's text. Resolved against the other page it would
      // have missed, and the tack would have carried data-status="orphaned".
      expect(tack.getAttribute('data-status')).toBe('exact')
      // And drawn in *this* page's overlay, not the first one's — a rect
      // measured against one page and mapped through another page's transform
      // is a tack on the wrong sheet.
      expect(second.contains(tack)).toBe(true)
      expect(sheet(container, FIRST_PAGE).contains(tack)).toBe(false)
    } finally {
      ;(document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = caret
    }
  })
})

describe('App — chronology', () => {
  it('is off the board for now', () => {
    // The ribbon was removed from the UI deliberately, not broken. The module
    // and its tests are kept in `board/timeline.ts` so it can come back; this
    // is the test that will fail when it does, and the three that used to live
    // here — the ribbon renders, it explains an empty chronology, playback is
    // disabled with nothing to play — are what to restore alongside it.
    renderBoard()
    expect(screen.queryByTestId('timeline-ribbon')).toBeNull()
  })
})

describe('App — routing', () => {
  it('serves the board at the root', () => {
    renderBoard()
    expect(window.location.pathname).toBe('/')
    expect(screen.getByTestId('board-canvas')).toBeTruthy()
  })

  it('has no nav to anywhere else', () => {
    // The board is the only page; a tab strip with one always-active tab was
    // chrome with no function.
    renderBoard()
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
  })
})

describe('App — pin mode', () => {
  const freePins = (container: HTMLElement) =>
    container.querySelectorAll('[data-status="free"]').length

  it('does not pin on a plain click by default', () => {
    // A board you can accidentally pin while trying to select something is a
    // board you stop trusting.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'))
    expect(freePins(container)).toBe(0)
  })

  it('pins on a ctrl-click without any mode', () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true })
    expect(freePins(container)).toBe(1)
  })

  it('pins on a cmd-click too, since ctrl-click is the macOS context menu', () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { metaKey: true })
    expect(freePins(container)).toBe(1)
  })

  it('pins on a plain click once pin mode is on', () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByLabelText('Pin mode'))
    fireEvent.click(screen.getByTestId('board-canvas'))
    expect(freePins(container)).toBe(1)
  })

  it('stops pinning when pin mode is switched back off', () => {
    const { container } = renderBoard()
    const toggle = screen.getByLabelText('Pin mode')
    fireEvent.click(toggle)
    fireEvent.click(toggle)

    fireEvent.click(screen.getByTestId('board-canvas'))
    expect(freePins(container)).toBe(0)
  })

  it('announces its pressed state', () => {
    renderBoard()
    const toggle = screen.getByLabelText('Pin mode')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('App — placing pins', () => {
  const freePins = (container: HTMLElement) =>
    container.querySelectorAll('[data-status="free"]').length

  /** Right-click somewhere, which opens the context menu. */
  function rightClick(element: Element, clientX = 400, clientY = 300): void {
    fireEvent.pointerDown(element, { button: 2, pointerId: 3, clientX, clientY })
    fireEvent.pointerUp(element, { button: 2, pointerId: 3, clientX, clientY })
  }

  it('places a pin from the context menu, even over bare board', () => {
    // Regression: this silently did nothing whenever the right-click was not
    // over article text, because the pin helper bailed instead of falling back
    // to sticking the pin into the board.
    const { container } = renderBoard()
    rightClick(screen.getByTestId('board-canvas'))

    fireEvent.click(screen.getByText('Add pin'))
    expect(freePins(container)).toBe(1)
  })

  it('offers the context menu on bare board', () => {
    renderBoard()
    rightClick(screen.getByTestId('board-canvas'))
    expect(screen.getByText('Create post-it')).toBeTruthy()
  })

  it('creates a post-it from the context menu', () => {
    const { container } = renderBoard()
    rightClick(screen.getByTestId('board-canvas'))

    fireEvent.click(screen.getByText('Create post-it'))
    expect(container.querySelectorAll('[aria-label="Post-it note"]').length).toBe(1)
  })

  it('draws the live string from the tack it started at', async () => {
    // Regression: the drag origin was computed in paper coordinates while the
    // drag target and the yarn layer had moved to board coordinates, so the
    // string was drawn from near the board origin instead of from the tack.
    //
    // This needs an ANCHORED pin, which needs a caret query jsdom does not
    // implement — so it is stubbed here rather than globally, since a global
    // stub would make every click anchor to the article and would quietly
    // break the free-pin tests above.
    const { container } = renderBoard()
    const article = sheet(container, FIRST_PAGE).querySelector('.article')!

    const caret = (document as Document & { caretRangeFromPoint?: unknown })
      .caretRangeFromPoint
    ;(document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => {
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
      const text = walker.nextNode() as Text | null
      if (!text) return null
      const range = document.createRange()
      range.setStart(text, 0)
      range.collapse(true)
      return range
    }

    try {
      fireEvent.click(article, { ctrlKey: true, clientX: 120, clientY: 60 })

      const tack = container.querySelector('button[data-pin-id]') as HTMLElement
      expect(tack).not.toBeNull()

      fireEvent.pointerDown(tack, { button: 0, pointerId: 7, clientX: 181, clientY: 52 })
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      })

      // The stubbed range box is 100..180 by 50..70, so the tack sits at 181,52
      // and the paper is at the board origin.
      expect(screen.getByTestId('live-yarn').getAttribute('d')).toMatch(/^M 181 52/)
    } finally {
      ;(document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = caret
    }
  })

  it('positions an anchored tack across the paper padding, not from its corner', async () => {
    // Regression: anchor rects are measured against the ARTICLE, which begins at
    // the paper's content box. Measuring from the paper's own corner left every
    // anchored tack 48x40 board px away from where it was drawn — further than
    // SNAP_RADIUS, so a dragged string could never snap onto a pin and no yarn
    // was ever created.
    //
    // jsdom lays nothing out and reports no padding, which is exactly why the
    // bug was invisible to the rest of this file, so the paper's computed style
    // is stubbed. Only the paper's is replaced; the real one is delegated to for
    // every other element, since the theme code reads it too.
    const realGetComputedStyle = window.getComputedStyle
    window.getComputedStyle = ((element: Element, pseudo?: string | null) => {
      if ((element as HTMLElement).dataset?.testid === 'paper') {
        return {
          paddingLeft: '48px',
          paddingTop: '40px',
          borderLeftWidth: '0px',
          borderTopWidth: '0px',
        } as CSSStyleDeclaration
      }
      return realGetComputedStyle.call(window, element, pseudo ?? undefined)
    }) as typeof window.getComputedStyle

    const { container } = renderBoard()
    const article = sheet(container, FIRST_PAGE).querySelector('.article')!

    const caret = (document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint
    ;(document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = () => {
      const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT)
      const text = walker.nextNode() as Text | null
      if (!text) return null
      const range = document.createRange()
      range.setStart(text, 0)
      range.collapse(true)
      return range
    }

    try {
      fireEvent.click(article, { ctrlKey: true, clientX: 120, clientY: 60 })
      const tack = container.querySelector('button[data-pin-id]') as HTMLElement
      expect(tack).not.toBeNull()

      fireEvent.pointerDown(tack, { button: 0, pointerId: 7, clientX: 181, clientY: 52 })
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
      })

      // The tack is at 181,52 inside the article; the paper's padding carries it
      // to 229,92 in board space.
      expect(screen.getByTestId('live-yarn').getAttribute('d')).toMatch(/^M 229 92/)
    } finally {
      window.getComputedStyle = realGetComputedStyle
      ;(document as Document & { caretRangeFromPoint?: unknown }).caretRangeFromPoint = caret
    }
  })

  it('opens the editor when a pin is clicked rather than dragged', () => {
    // The obvious gesture. A press that never travels used to start a string
    // and then abandon it, so clicking a pin did nothing at all — the editor
    // was reachable only by right-click, which nobody guesses.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    const tack = container.querySelector('button[data-pin-id]') as HTMLElement

    fireEvent.pointerDown(tack, { button: 0, pointerId: 40, clientX: 300, clientY: 200 })
    fireEvent.pointerUp(window, { pointerId: 40, clientX: 300, clientY: 200 })

    expect(screen.getByTestId('pin-editor')).toBeTruthy()
  })

  it('does not open the editor when the same press travels', () => {
    // The other half of the same rule: a press that moves is a string, and it
    // must not leave an editor behind it.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    const tack = container.querySelector('button[data-pin-id]') as HTMLElement

    fireEvent.pointerDown(tack, { button: 0, pointerId: 41, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(window, { pointerId: 41, clientX: 420, clientY: 260 })
    fireEvent.pointerUp(window, { pointerId: 41, clientX: 420, clientY: 260 })

    expect(screen.queryByTestId('pin-editor')).toBeNull()
  })

  it('opens the editor on a pin stuck through a word too', () => {
    // A tack in a page is the same object in a different place, and the click
    // has to mean the same thing on it.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })

    const tack = container.querySelector('button[data-pin-id]') as HTMLElement
    fireEvent.pointerDown(tack, { button: 0, pointerId: 42, clientX: 300, clientY: 200 })
    fireEvent.pointerUp(window, { pointerId: 42, clientX: 302, clientY: 201 })

    expect(screen.getByTestId('pin-editor')).toBeTruthy()
  })

  it('connects two pins on the board with a string', () => {
    // The whole point of the board: drag from one pin to another and get yarn.
    const { container } = renderBoard()
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 })

    const tacks = container.querySelectorAll('button[data-pin-id]')
    expect(tacks.length).toBe(2)

    fireEvent.pointerDown(tacks[0], { button: 0, pointerId: 21, clientX: 300, clientY: 200 })
    // The pointer travels across the board, not over any one element.
    fireEvent.pointerMove(canvas, { pointerId: 21, clientX: 520, clientY: 260 })
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 })

    // A string is a <g> of strand paths, and none exist until a connection is
    // made.
    const yarn = container.querySelectorAll('svg[aria-hidden="true"] g')
    expect(yarn.length).toBeGreaterThan(0)

    // Every strand is the one red. A per-connection palette used to hand out
    // 'bone', which is 1.2:1 against the parchment a string mostly crosses —
    // i.e. invisible rather than merely dull.
    const strands = container.querySelectorAll('svg[aria-hidden="true"] g path')
    expect(strands.length).toBeGreaterThan(0)
    for (const strand of strands) {
      expect(strand.getAttribute('stroke')).toBe(YARN_COLOR)
    }

    // And never dimmed with the timeline. Strings used to drop to 0.12 whenever
    // both endpoints were not yet "known" — which, since the cursor starts at
    // the campaign epoch, meant every string touching any pin but the first.
    // That reads as "faded" on a brass tack and as absent on a hairline.
    const group = container.querySelector('svg[aria-hidden="true"] g') as SVGGElement
    expect(group.style.opacity).toBe('')
  })

  /** The y of the first string's quadratic control point, in board px. */
  function yarnControlY(container: HTMLElement): number {
    const d = container.querySelector('svg[aria-hidden="true"] g path')?.getAttribute('d') ?? ''
    const match = d.match(/Q [\d.-]+ ([\d.-]+)/)
    return match ? Number(match[1]) : Number.NaN
  }

  it('selects a string by clicking it, and re-sags it by dragging the bead', () => {
    const { container } = renderBoard()
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 })
    const tacks = container.querySelectorAll('button[data-pin-id]')
    fireEvent.pointerDown(tacks[0], { button: 0, pointerId: 21, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(canvas, { pointerId: 21, clientX: 520, clientY: 260 })
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 })

    // Nothing is selectable until it is asked for: no bead before the click.
    expect(screen.queryByTestId('yarn-bead')).toBeNull()

    // Aim at the curve's lowest point — the chord midpoint, half the control
    // offset below it — rather than at either tack.
    const span = Math.hypot(520 - 300, 260 - 200)
    const apexY = 230 + sagFor(span, DEFAULT_SLACK) / 2
    fireEvent.click(canvas, { clientX: 410, clientY: apexY })

    expect(screen.queryByTestId('yarn-bead')).not.toBeNull()
    expect(screen.queryByTestId('yarn-halo')).not.toBeNull()

    // Drag the bead down: the string takes up more rope and sags further.
    const slackBefore = yarnControlY(container)
    const bead = screen.getByTestId('yarn-bead')
    fireEvent.pointerDown(bead, { button: 0, pointerId: 9, clientX: 410, clientY: apexY })
    fireEvent.pointerMove(bead, { pointerId: 9, clientX: 410, clientY: apexY + 40 })
    fireEvent.pointerUp(bead, { pointerId: 9, clientX: 410, clientY: apexY + 40 })
    const sagged = yarnControlY(container)
    expect(sagged).toBeGreaterThan(slackBefore)

    // And back up, past where it started.
    fireEvent.pointerDown(bead, { button: 0, pointerId: 10, clientX: 410, clientY: apexY })
    fireEvent.pointerMove(bead, { pointerId: 10, clientX: 410, clientY: apexY - 60 })
    fireEvent.pointerUp(bead, { pointerId: 10, clientX: 410, clientY: apexY - 60 })
    expect(yarnControlY(container)).toBeLessThan(sagged)
  })

  it('removes a selected string on Delete, and lets go of it on Escape', () => {
    const { container } = renderBoard()
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 })
    const tacks = container.querySelectorAll('button[data-pin-id]')
    fireEvent.pointerDown(tacks[0], { button: 0, pointerId: 21, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(canvas, { pointerId: 21, clientX: 520, clientY: 260 })
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 })

    const span = Math.hypot(520 - 300, 260 - 200)
    const apexY = 230 + sagFor(span, DEFAULT_SLACK) / 2
    fireEvent.click(canvas, { clientX: 410, clientY: apexY })
    expect(screen.queryByTestId('yarn-bead')).not.toBeNull()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('yarn-bead')).toBeNull()
    // Letting go is not deleting: the string is still on the board.
    expect(container.querySelectorAll('svg[aria-hidden="true"] g').length).toBe(1)

    fireEvent.click(canvas, { clientX: 410, clientY: apexY })
    fireEvent.keyDown(document, { key: 'Delete' })
    expect(container.querySelectorAll('svg[aria-hidden="true"] g').length).toBe(0)
    // The pins it joined are untouched — only the string goes.
    expect(container.querySelectorAll('button[data-pin-id]').length).toBe(2)
  })

  it('does not delete while a field has focus', () => {
    // Backspace in the article is someone editing prose, not deleting yarn.
    const { container } = renderBoard()
    const canvas = screen.getByTestId('board-canvas')
    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 })
    const tacks = container.querySelectorAll('button[data-pin-id]')
    fireEvent.pointerDown(tacks[0], { button: 0, pointerId: 21, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(canvas, { pointerId: 21, clientX: 520, clientY: 260 })
    fireEvent.pointerUp(canvas, { pointerId: 21, clientX: 520, clientY: 260 })

    const span = Math.hypot(520 - 300, 260 - 200)
    const apexY = 230 + sagFor(span, DEFAULT_SLACK) / 2
    fireEvent.click(canvas, { clientX: 410, clientY: apexY })

    const field = document.createElement('textarea')
    document.body.appendChild(field)
    try {
      fireEvent.keyDown(field, { key: 'Backspace' })
      expect(container.querySelectorAll('svg[aria-hidden="true"] g').length).toBe(1)
    } finally {
      field.remove()
    }
  })

  it('draws yarn above the article, not behind it', () => {
    // A string running behind a pinned document reads as a mistake.
    const { container } = renderBoard()
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 })

    const tacks = container.querySelectorAll('button[data-pin-id]')
    fireEvent.pointerDown(tacks[0], { button: 0, pointerId: 31, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(canvas, { pointerId: 31, clientX: 520, clientY: 260 })
    fireEvent.pointerUp(canvas, { pointerId: 31, clientX: 520, clientY: 260 })

    // By test id, not by `svg[aria-hidden]`: the icon set renders aria-hidden
    // SVGs of its own, and the first one in the document is a button's glyph
    // rather than the yarn.
    const yarn = screen.getByTestId('string-layer')
    const paper = sheet(container, FIRST_PAGE)

    // The yarn must come after the paper in document order, since these are
    // absolutely positioned siblings and later wins. Every page, not just the
    // first: a string behind the second sheet would read as a mistake too.
    expect(yarn.compareDocumentPosition(paper) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(
      yarn.compareDocumentPosition(sheet(container, SECOND_PAGE)) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy()
  })

  it('starts a string from a pin drag rather than a selection', async () => {
    // A pin is a place yarn attaches to, so the drag means the same thing on a
    // free pin as on an anchored one. The band is for bare board only.
    const { container } = renderBoard()
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    const tack = container.querySelector('[data-status="free"]') as HTMLElement
    expect(tack).not.toBeNull()

    fireEvent.pointerDown(tack, { button: 0, pointerId: 11, clientX: 300, clientY: 200 })
    expect(screen.queryByTestId('marquee')).toBeNull()

    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })

    // The camera is untouched in jsdom, so the pin placed at viewport 300,200
    // sits at board 300,200 and the string must start there.
    expect(screen.getByTestId('live-yarn').getAttribute('d')).toMatch(/^M 300 200/)
  })

  it('selects objects inside the rubber band', () => {
    const { container } = renderBoard()
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    expect(container.querySelectorAll('.is-selected').length).toBe(0)

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 250, clientY: 150 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 })

    expect(container.querySelectorAll('.is-selected').length).toBe(1)
  })

  it('shows the rubber band while it is being dragged', () => {
    renderBoard()
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 250, clientY: 150 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 })

    expect(screen.getByTestId('marquee')).toBeTruthy()
  })

  it('hides the rubber band on release', () => {
    renderBoard()
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 250, clientY: 150 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 })
    fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 350, clientY: 250 })

    expect(screen.queryByTestId('marquee')).toBeNull()
  })

  it('clears the selection on a plain click', () => {
    const { container } = renderBoard()
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 250, clientY: 150 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 })
    fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 350, clientY: 250 })
    expect(container.querySelectorAll('.is-selected').length).toBe(1)

    fireEvent.click(canvas, { clientX: 10, clientY: 10 })
    expect(container.querySelectorAll('.is-selected').length).toBe(0)
  })

  it('does not rubber-band in pin mode, where a drag is a pin', () => {
    // The two gestures share the left button; pin mode is what chooses.
    renderBoard()
    const canvas = screen.getByTestId('board-canvas')
    fireEvent.click(screen.getByLabelText('Pin mode'))

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 250, clientY: 150 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 })

    expect(screen.queryByTestId('marquee')).toBeNull()
  })
})

describe('App — pin descriptions', () => {
  /** Right-click the first tack, which opens its editor. */
  function openPinEditor(container: HTMLElement): void {
    const tack = container.querySelector('button[data-pin-id]') as HTMLElement
    expect(tack).not.toBeNull()
    fireEvent.pointerDown(tack, { button: 2, pointerId: 4, clientX: 181, clientY: 52 })
    fireEvent.pointerUp(tack, { button: 2, pointerId: 4, clientX: 181, clientY: 52 })
  }

  it('marks a pin once it has a description', () => {
    // Otherwise a board with fifty pins gives you no way to find the ones
    // somebody bothered to write on.
    const { container } = renderBoard()
    const canvas = screen.getByTestId('board-canvas')
    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })

    const tack = container.querySelector('button[data-pin-id]') as HTMLElement
    expect(tack.getAttribute('data-described')).toBeNull()

    openPinEditor(container)
    fireEvent.change(screen.getByLabelText('Pin note'), {
      target: { value: 'The ferryman was lying.' },
    })

    expect(
      (container.querySelector('button[data-pin-id]') as HTMLElement).getAttribute('data-described'),
    ).toBe('true')
  })

  it('does not count whitespace as a description', () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)

    fireEvent.change(screen.getByLabelText('Pin note'), { target: { value: '   \n  ' } })
    expect(
      (container.querySelector('button[data-pin-id]') as HTMLElement).getAttribute('data-described'),
    ).toBeNull()
  })

  it('shows a hover card on a pin, far sooner than the native tooltip', async () => {
    // The point of the card is the speed: the browser's own tooltip takes about
    // a second, which is useless when scanning a board.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })

    const tack = container.querySelector('button[data-pin-id]') as HTMLElement
    fireEvent.pointerEnter(tack)

    const card = await screen.findByRole('tooltip')
    expect(card).toBeTruthy()
  })

  it('hangs the written description on the pin as a tag', () => {
    // It used to be in the hover card and nowhere else, behind a ring that
    // said only *that* there was something to read. The words are on the
    // board now, which is the point of a tag.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)
    fireEvent.change(screen.getByLabelText('Pin note'), {
      target: { value: 'The ferryman was lying.' },
    })
    fireEvent.keyDown(document, { key: 'Escape' })

    const tag = container.querySelector('.pin-tag')
    expect(tag).not.toBeNull()
    expect(tag!.textContent).toContain('The ferryman was lying.')
    // Hung off the tack's own coordinate, not left at the board's corner.
    expect((tag as HTMLElement).style.left).not.toBe('')
  })

  it('edits the date on a pin, and the tag on the board follows it', () => {
    // The date is free text because the campaign's calendar is its own: what
    // goes here is "3rd of Eleint", not a date a picker would recognise.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)

    const field = screen.getByLabelText('Pin date') as HTMLInputElement
    fireEvent.change(field, { target: { value: '3rd of Eleint' } })

    expect((screen.getByLabelText('Pin date') as HTMLInputElement).value).toBe('3rd of Eleint')
    // Round-tripped through the store, not just held in the field.
    fireEvent.change(screen.getByLabelText('Pin note'), { target: { value: 'Paid in silver.' } })
    expect(container.querySelector('.pin-tag')!.textContent).toContain('3rd of Eleint')
  })

  it('takes the date off a pin when the field is emptied', () => {
    // A pin from before the party dated anything should be able to say so,
    // rather than wearing a blank line where a date would be.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)
    fireEvent.change(screen.getByLabelText('Pin note'), { target: { value: 'Paid in silver.' } })
    expect(container.querySelector('.pin-tag')!.textContent).toContain('Session')

    fireEvent.change(screen.getByLabelText('Pin date'), { target: { value: '' } })

    expect(container.querySelector('.pin-tag')!.textContent).not.toContain('Session')
  })

  it('leaves a tag off a pin nobody has written on', () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })

    expect(container.querySelector('.pin-tag')).toBeNull()
  })

  describe('the tag as a handle', () => {
    /** A pin with something written on it, and the tag it wears. */
    function describedPin() {
      const rendered = renderBoard()
      const { container } = rendered
      fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
      openPinEditor(container)
      fireEvent.change(screen.getByLabelText('Pin note'), {
        target: { value: 'The ferryman was lying.' },
      })
      fireEvent.keyDown(document, { key: 'Escape' })

      const tag = container.querySelector('.pin-tag__card') as HTMLElement
      expect(tag).not.toBeNull()
      return { container, tag, tack: container.querySelector('button[data-pin-id]') as HTMLElement }
    }

    /** Where the pin is drawn, read off the tack's own offset. */
    const tackAt = (tack: HTMLElement) => ({ left: tack.style.left, top: tack.style.top })

    it('moves the pin when the tag is dragged', () => {
      // The tack is fourteen pixels across and means one thing per mode; the
      // tag hanging off it is four or five times the target and means only
      // this.
      const { tag, tack } = describedPin()
      const before = tackAt(tack)

      fireEvent.pointerDown(tag, { button: 0, pointerId: 7, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(tag, { pointerId: 7, clientX: 180, clientY: 140 })
      fireEvent.pointerUp(tag, { button: 0, pointerId: 7, clientX: 180, clientY: 140 })

      const after = tackAt(tack)
      expect(after.left).not.toBe(before.left)
      expect(after.top).not.toBe(before.top)
      // The tag goes with it — it hangs off the same coordinate.
      expect((tack.parentElement!.querySelector('.pin-tag') as HTMLElement).style.left).not.toBe('')
    })

    it('opens the pin’s editor when the tag is clicked', () => {
      // The press used to fall through to the board underneath. Now that the
      // tag takes it, a click has to answer for itself rather than be a dead
      // patch on the cork.
      const { tag } = describedPin()
      expect(screen.queryByLabelText('Pin note')).toBeNull()

      fireEvent.pointerDown(tag, { button: 0, pointerId: 7, clientX: 100, clientY: 100 })
      fireEvent.pointerUp(tag, { button: 0, pointerId: 7, clientX: 100, clientY: 100 })

      expect(screen.getByLabelText('Pin note')).toBeTruthy()
    })

    it('does not open the editor when the tag was dragged', () => {
      const { tag } = describedPin()

      fireEvent.pointerDown(tag, { button: 0, pointerId: 7, clientX: 100, clientY: 100 })
      fireEvent.pointerMove(tag, { pointerId: 7, clientX: 200, clientY: 160 })
      fireEvent.pointerUp(tag, { button: 0, pointerId: 7, clientX: 200, clientY: 160 })

      expect(screen.queryByLabelText('Pin note')).toBeNull()
    })

    it('carries the pin’s identity, so the board can tell what was grabbed', () => {
      // Middle-drag and the context menu both resolve an entity from whatever is
      // under the pointer, and the tag is four times the tack. Without these it
      // would be a hole in the board that answers for nothing.
      const { container, tag } = describedPin()
      const wrapper = tag.parentElement as HTMLElement

      expect(wrapper).toBe(container.querySelector('.pin-tag'))
      expect(wrapper.getAttribute('data-board-entity')).toBe('pin')
      expect(wrapper.getAttribute('data-pin-id')).toBe(
        (container.querySelector('button[data-pin-id]') as HTMLElement).getAttribute('data-pin-id'),
      )
    })
  })

  it('drops the hover card when the camera moves under it', async () => {
    // The card measures its pin's screen position when it appears, and a zoom
    // relocates every pin without firing the scroll event the card listens for.
    // Left alone it would sit where the pin used to be, pointing at nothing.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })

    const tack = container.querySelector('button[data-pin-id]') as HTMLElement
    fireEvent.pointerEnter(tack)
    expect(await screen.findByRole('tooltip')).toBeTruthy()

    fireEvent.wheel(screen.getByTestId('board-canvas'), {
      deltaY: -200,
      clientX: 300,
      clientY: 200,
    })

    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('describes each pin by the card it will produce', () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })

    const tack = container.querySelector('button[data-pin-id]') as HTMLElement
    expect(tack.getAttribute('aria-describedby')).toMatch(/^pin-tooltip-/)
  })

  it('offers Move pin in the editor', () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)

    expect(screen.getByText('Move pin')).toBeTruthy()
  })

  it('closes the editor and prompts for the drag when Move pin is chosen', () => {
    // You cannot drag a pin accurately with a card sitting over it.
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)

    fireEvent.click(screen.getByText('Move pin'))

    expect(screen.queryByTestId('pin-editor')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/Drag the pin/)
  })

  it('finishes the move on Escape', () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)
    fireEvent.click(screen.getByText('Move pin'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('repositions the pin when dragged in move mode', async () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)
    fireEvent.click(screen.getByText('Move pin'))

    const tack = container.querySelector('button[data-pin-id]') as HTMLElement
    const before = tack.style.left

    fireEvent.pointerDown(tack, { button: 0, pointerId: 12, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(tack, { pointerId: 12, clientX: 340, clientY: 200 })

    const after = (container.querySelector('button[data-pin-id]') as HTMLElement).style.left
    expect(after).not.toBe(before)
  })
})

describe('App — mentions', () => {
  const mentioned = (title: string, body: string): BoardEntity =>
    newArticle({ x: 0, y: 0 }, body, title, undefined, { id: title })

  /** The page whose body carries the mention, and the one it names. */
  function twoPages() {
    return [
      mentioned('The Ledger', '# The Ledger\n\nWords.'),
      mentioned(
        'The Bell',
        '# The Bell\n\nThe bell came up near @[The Ledger], and again.',
      ),
    ]
  }

  const linkIn = (container: HTMLElement, articleId: string): HTMLElement =>
    sheet(container, articleId).querySelector('a.mention') as HTMLElement

  it('marks a mention whose name is not on the board', () => {
    // `renderBoard` has the pages and nothing else, so the demo's own mention
    // of a picture names nothing here.
    const { container } = renderBoard()

    expect(linkIn(container, FIRST_PAGE).classList.contains('mention--missing')).toBe(true)
  })

  it('leaves a mention to something that is there unmarked', () => {
    const { container } = render(
      <App seed={{ entities: twoPages(), strings: [] }} />,
    )

    expect(linkIn(container, 'The Bell').classList.contains('mention--missing')).toBe(false)
  })

  it('takes the click on a mention, rather than letting the browser follow it', () => {
    // `fireEvent` reports whether the default was prevented. The anchor carries
    // an href so it can be reached by keyboard, and this is what stops that href
    // being followed when it is clicked.
    const { container } = render(
      <App seed={{ entities: twoPages(), strings: [] }} />,
    )

    expect(fireEvent.click(linkIn(container, 'The Bell'))).toBe(false)
  })

  it('lets a click on a mention that names nothing through', () => {
    // There is nowhere to go, so it behaves like any other click on the page.
    const { container } = renderBoard()

    expect(fireEvent.click(linkIn(container, FIRST_PAGE))).toBe(true)
  })

  it('gives the editor the names it can suggest', () => {
    const { container } = render(
      <App seed={{ entities: twoPages(), strings: [] }} />,
    )
    tap(within(sheet(container, 'The Bell')).getByTestId('paper-tab'))

    expect(screen.getByTestId('paper-editor')).toBeTruthy()
    // Typing `@` is what opens the list; it is not open on its own.
    expect(screen.queryByTestId('mention-list')).toBeNull()

    const source = screen.getByLabelText('Article markdown source') as HTMLTextAreaElement
    fireEvent.change(source, { target: { value: `${source.value} @`, selectionStart: source.value.length + 2 } })

    expect(within(screen.getByTestId('mention-list')).getByText('The Ledger')).toBeTruthy()
  })
})

describe('App — the writing on a note', () => {
  const note = (container: HTMLElement): HTMLElement =>
    container.querySelector('[data-post-it-id]') as HTMLElement
  const writing = (container: HTMLElement): HTMLTextAreaElement =>
    container.querySelector('textarea[aria-label="Post-it note"]') as HTMLTextAreaElement

  /** A press on a note is what selects it. */
  const selectNote = (container: HTMLElement): void => {
    fireEvent.pointerDown(note(container), { button: 0, pointerId: 5 })
  }

  it('offers the size controls once the note is selected', () => {
    const { container } = render(<App />)
    expect(screen.queryByTestId('post-it-font-up')).toBeNull()

    selectNote(container)

    expect(screen.getByTestId('post-it-font-up')).toBeTruthy()
    expect(screen.getByTestId('post-it-font-down')).toBeTruthy()
    expect(screen.getByTestId('post-it-font-reset')).toBeTruthy()
  })

  it('makes the writing bigger and smaller, a step at a time', () => {
    const { container } = render(<App />)
    selectNote(container)
    const start = writing(container).style.fontSize
    expect(start).toBe('12px')

    fireEvent.click(screen.getByTestId('post-it-font-up'))
    expect(writing(container).style.fontSize).toBe('13.5px')

    fireEvent.click(screen.getByTestId('post-it-font-down'))
    fireEvent.click(screen.getByTestId('post-it-font-down'))
    expect(writing(container).style.fontSize).toBe('10.5px')
  })

  it('puts it back to the normal size in one press', () => {
    const { container } = render(<App />)
    selectNote(container)
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByTestId('post-it-font-up'))

    fireEvent.click(screen.getByTestId('post-it-font-reset'))

    expect(writing(container).style.fontSize).toBe('12px')
  })

  it('will not step past either end, rather than going quiet about it', () => {
    const { container } = render(<App />)
    selectNote(container)

    // The button that would take it further is disabled at the limit, so the
    // control says so instead of an extra press doing nothing.
    expect((screen.getByTestId('post-it-font-reset') as HTMLButtonElement).disabled).toBe(true)
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByTestId('post-it-font-up'))
    expect(writing(container).style.fontSize).toBe('24px')
    expect((screen.getByTestId('post-it-font-up') as HTMLButtonElement).disabled).toBe(true)
  })

  it('changes only the note it belongs to', () => {
    const { container } = render(<App />)
    const all = container.querySelectorAll<HTMLTextAreaElement>('textarea[aria-label="Post-it note"]')
    selectNote(container)

    fireEvent.click(screen.getByTestId('post-it-font-up'))

    expect(all[0].style.fontSize).toBe('13.5px')
    expect(all[1].style.fontSize).toBe('12px')
  })
})

describe('App — naming a picture', () => {
  /** The picture whose alt mentions `alt` — the board has three. */
  const card = (container: HTMLElement, alt = 'Saltmarsh'): HTMLElement =>
    Array.from(container.querySelectorAll('[data-image-id]')).find((element) =>
      (element.querySelector('img')?.getAttribute('alt') ?? '').includes(alt),
    ) as HTMLElement

  /** A press on a picture is what selects it, as a press on anything is. */
  const clickPicture = (container: HTMLElement, alt?: string): void => {
    fireEvent.pointerDown(card(container, alt), { button: 0, pointerId: 9, clientX: 100, clientY: 100 })
  }

  it('shows a picture’s title and description once it is clicked', () => {
    const { container } = render(<App />)
    expect(screen.queryByTestId('image-caption')).toBeNull()

    clickPicture(container)

    expect((screen.getByLabelText('Picture title') as HTMLInputElement).value).toBe(
      'The Saltmarsh Map',
    )
    expect((screen.getByLabelText('Picture description') as HTMLTextAreaElement).value).toContain(
      'drowned road',
    )
  })

  it('writes both fields back to the picture', () => {
    const { container } = render(<App />)
    clickPicture(container)

    fireEvent.change(screen.getByLabelText('Picture title'), { target: { value: 'The Map' } })
    fireEvent.change(screen.getByLabelText('Picture description'), {
      target: { value: 'Drawn from the harbormaster’s window.' },
    })

    expect((screen.getByLabelText('Picture title') as HTMLInputElement).value).toBe('The Map')
    expect((screen.getByLabelText('Picture description') as HTMLTextAreaElement).value).toBe(
      'Drawn from the harbormaster’s window.',
    )
  })

  it('makes the new name the one a mention resolves to', () => {
    // A mention is keyed by name, so renaming a picture has to take the old
    // name away with it — and the page that used it has to say so rather than
    // quietly pointing at whatever else might now answer to it.
    const { container } = render(<App />)
    const mention = sheet(container, ARTICLE_ID).querySelector('a.mention') as HTMLElement
    expect(mention.classList.contains('mention--missing')).toBe(false)

    clickPicture(container, 'Black Coin')
    fireEvent.change(screen.getByLabelText('Picture title'), { target: { value: 'The Rubbing' } })

    expect(mention.textContent).toBe('The Black Coin')
    expect(mention.classList.contains('mention--missing')).toBe(true)
  })
})

describe('App — the demo board', () => {
  it('leaves a click on a picture’s pin doing nothing, since a picture has no editor', () => {
    // The string gesture is the same one, so the tap rule has to be scoped to
    // pins — otherwise this opens an editor for an entity that has none.
    const { container } = render(<App />)
    const pin = container.querySelector('[data-testid="image-pin"]') as HTMLElement

    fireEvent.pointerDown(pin, { button: 0, pointerId: 43, clientX: 300, clientY: 200 })
    fireEvent.pointerUp(window, { pointerId: 43, clientX: 300, clientY: 200 })

    expect(screen.queryByTestId('pin-editor')).toBeNull()
  })

  it('opens on four pages with notes, pictures, tacks and yarn around them', () => {
    // A board that opens empty is a board that has to be explained. This is the
    // shape of what a person sees first, and it is asserted here rather than
    // incidentally by every other test in this file.
    //
    // Every kind is represented. Pictures especially: they were the one kind
    // the demo did not have, which meant `ImageCard`, `edges.ts` and the whole
    // picture half of the descriptor were reachable only by dragging a file in.
    const { container } = render(<App />)

    expect(container.querySelectorAll('[data-article-id]').length).toBe(ARTICLE_IDS.length)
    expect(container.querySelectorAll('[aria-label="Post-it note"]').length).toBe(8)
    expect(container.querySelectorAll('button[data-pin-id]').length).toBe(8)
    expect(container.querySelectorAll('[data-image-id]').length).toBe(3)
    expect(screen.getByTestId('string-layer').querySelectorAll('g').length).toBe(12)
  })

  it('leaves some tacks and notes without a description', () => {
    // The board draws the two cases differently — a tack with something written
    // on it wears a ring, and a note is a note because someone wrote on it — so
    // a demo where everything is described shows only half of what it does.
    const { container } = render(<App />)

    const tacks = container.querySelectorAll('button[data-pin-id]')
    const described = container.querySelectorAll('button[data-pin-id][data-described="true"]')
    expect(described.length).toBe(6)
    expect(described.length).toBeLessThan(tacks.length)

    // The label is on the note's own textarea, not on a wrapper — so the node
    // the query returns *is* the field, and its value is what was written.
    const notes = Array.from(container.querySelectorAll<HTMLTextAreaElement>('[aria-label="Post-it note"]'))
    const written = notes.filter((note) => note.value.trim() !== '')
    expect(written.length).toBe(6)
  })

  it('rolls one page up, so the board shows that state too', () => {
    // A rolled-up page is a page with its body hidden and only its tab showing.
    // Nothing in the UI makes one yet, so the demo is the only place a reader
    // meets the state — and the tab is the affordance that opens it again.
    const { container } = render(<App />)

    expect(sheet(container, FOURTH_PAGE).textContent).toContain('▸')
    // The others are open, and say so with the other caret.
    expect(sheet(container, FIRST_PAGE).textContent).toContain('▾')
  })

  it('writes a tag that says what the connection is, not what the note says', () => {
    // A tag that repeats the note it hangs beside is a second copy of something
    // already on the board. These two are the ones that were doing that: the
    // price note asks who paid, so its tag answers with the payer rather than
    // the word "price"; the scratched-name note describes the hand, so its tag
    // draws the inference the ledger supports and the note does not make.
    render(<App />)

    expect(screen.getByText('Molgar paid him')).toBeTruthy()
    expect(screen.getByText('a third hand')).toBeTruthy()
  })

  it('ties yarn to a page, not only to pins', () => {
    // A page is an entity like any other and the descriptor has always said it
    // was connectable — but a string to it was spliced into the anchor map by
    // hand under a constant id. This is the demo board proving the descriptor
    // path works: the yarn from the margin note ends on the page's tab.
    render(<App />)
    const yarn = screen.getByTestId('string-layer').querySelectorAll('g')
    expect(yarn.length).toBe(12)

    // Every string resolved to two board points — a string with an endpoint
    // that resolves to nothing is dropped rather than drawn to the origin, so
    // twelve groups means all twenty-four ends found something. That is the
    // assertion that matters here: the board ties to pages, pictures and tacks
    // alike, and any one of those going unresolved would drop its string.
    for (const group of yarn) {
      expect(group.querySelectorAll('path').length).toBeGreaterThan(0)
    }
  })

  it('does not count a tack in the cork as an anchored pin', () => {
    // The legend used to subtract repaired and orphaned from the total, which
    // counted every free pin as anchored: the demo board has eight cork pins
    // and no anchored ones, and the footer claimed "Anchored exactly (8)".
    render(<App />)

    expect(screen.getByText('Anchored exactly (0)')).toBeTruthy()
    expect(screen.getByText('8 pins · 12 strings')).toBeTruthy()
  })

  it('lays the demo out away from the origin, so a misplacement shows', () => {
    // Content piled at 0,0 hides exactly the bugs a board is prone to — a tack
    // resolved against the wrong page, a string tied to the wrong end — because
    // everything overlaps and nothing looks wrong. The pages are apart, and so
    // is everything around them.
    //
    // Distinct x is the specific rule: two things sharing one are two things
    // stacked in a column, and a demo where a misplacement lands on another
    // entity looks exactly like one where it landed where it belongs.
    const board = demoBoard()
    const placed = board.entities.filter((e) => 'board' in e)
    const xs = placed.map((e) => (e as { board: { x: number } }).board.x)
    expect(new Set(xs).size).toBe(placed.length)
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1000)
  })
})

describe('App — moving a page by its body', () => {
  /** Where a page is drawn, read off its own transform. */
  const posOf = (container: HTMLElement, articleId: string): { x: number; y: number } => {
    const style = sheet(container, articleId).getAttribute('style') ?? ''
    const match = style.match(/translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/)
    if (!match) throw new Error(`no translation on ${articleId}`)
    return { x: Number.parseFloat(match[1]), y: Number.parseFloat(match[2]) }
  }

  /** The page's prose — the largest target on the sheet, and the one you grab. */
  const body = (container: HTMLElement, articleId: string): HTMLElement =>
    sheet(container, articleId).querySelector('.article') as HTMLElement

  /** A press, a travel, a release, and the click the browser sends afterwards. */
  function bodyDrag(
    container: HTMLElement,
    articleId: string,
    from: [number, number],
    to: [number, number],
  ): void {
    const target = body(container, articleId)
    fireEvent.pointerDown(target, { button: 0, pointerId: 3, clientX: from[0], clientY: from[1] })
    fireEvent.pointerMove(target, { pointerId: 3, clientX: to[0], clientY: to[1] })
    fireEvent.pointerUp(target, { button: 0, pointerId: 3, clientX: to[0], clientY: to[1] })
    fireEvent.click(target, { clientX: to[0], clientY: to[1] })
  }

  it('moves the sheet when its prose is dragged', () => {
    const { container } = renderBoard()
    const before = posOf(container, FIRST_PAGE)
    const neighbour = posOf(container, SECOND_PAGE)

    bodyDrag(container, FIRST_PAGE, [400, 400], [540, 460])

    const after = posOf(container, FIRST_PAGE)
    expect(after.x).toBeGreaterThan(before.x)
    expect(after.y).toBeGreaterThan(before.y)
    // And only the page that was grabbed.
    expect(posOf(container, SECOND_PAGE)).toEqual(neighbour)
  })

  it('does not move it when the press never travelled', () => {
    // A click on the body pins a note, and a page that shifted under every one
    // of those clicks would be a page that never sits still.
    const { container } = renderBoard()
    const before = posOf(container, FIRST_PAGE)

    bodyDrag(container, FIRST_PAGE, [400, 400], [402, 401])

    expect(posOf(container, FIRST_PAGE)).toEqual(before)
  })

  it('does not pin a note with the click a drag leaves behind', () => {
    // The browser sends a click wherever the pointer finished, and on a page a
    // click is how a note gets pinned. Without swallowing it, dragging a page
    // in pin mode would leave a tack at the drop point.
    const { container } = renderBoard()
    fireEvent.click(screen.getByLabelText('Pin mode'))
    const before = container.querySelectorAll('button[data-pin-id]').length

    bodyDrag(container, FIRST_PAGE, [400, 400], [540, 460])

    expect(container.querySelectorAll('button[data-pin-id]').length).toBe(before)
  })

  it('still pins a note when the body is clicked and not dragged', () => {
    const { container } = renderBoard()
    fireEvent.click(screen.getByLabelText('Pin mode'))
    const before = container.querySelectorAll('button[data-pin-id]').length

    const target = body(container, FIRST_PAGE)
    fireEvent.pointerDown(target, { button: 0, pointerId: 3, clientX: 400, clientY: 400 })
    fireEvent.pointerUp(target, { button: 0, pointerId: 3, clientX: 400, clientY: 400 })
    fireEvent.click(target, { clientX: 400, clientY: 400 })

    expect(container.querySelectorAll('button[data-pin-id]').length).toBe(before + 1)
  })

  it('says on the sheet that it is being dragged', () => {
    // What the stylesheet hangs the grabbing cursor and `user-select: none` on:
    // the press that grabs a page starts selecting its text on the way.
    const { container } = renderBoard()
    const target = body(container, FIRST_PAGE)

    fireEvent.pointerDown(target, { button: 0, pointerId: 3, clientX: 400, clientY: 400 })
    fireEvent.pointerMove(target, { pointerId: 3, clientX: 500, clientY: 400 })

    expect(sheet(container, FIRST_PAGE).getAttribute('data-dragging')).toBe('true')

    fireEvent.pointerUp(target, { button: 0, pointerId: 3, clientX: 500, clientY: 400 })
    expect(sheet(container, FIRST_PAGE).getAttribute('data-dragging')).toBe('false')
  })
})

describe('App — swinging the page', () => {
  /** A drag: press, travel, release. */
  function drag(element: Element, from: [number, number], to: [number, number]): void {
    fireEvent.pointerDown(element, { button: 0, pointerId: 3, clientX: from[0], clientY: from[1] })
    fireEvent.pointerMove(element, { pointerId: 3, clientX: to[0], clientY: to[1] })
    fireEvent.pointerUp(element, { pointerId: 3, clientX: to[0], clientY: to[1] })
  }

  /** How far one named page is swung, read off its own transform. */
  const tiltOf = (container: HTMLElement, articleId: string): number => {
    const transform = sheet(container, articleId).getAttribute('style') ?? ''
    const match = transform.match(/rotate\(([-\d.]+)deg\)/)
    return match ? Number.parseFloat(match[1]) : 0
  }

  it('hangs each page from a pin at its top-centre', () => {
    const { container } = renderBoard()

    expect(within(sheet(container, FIRST_PAGE)).getByTestId('paper-pin')).toBeTruthy()
    expect(within(sheet(container, SECOND_PAGE)).getByTestId('paper-pin')).toBeTruthy()
  })

  it('offers no rotate handle on an unselected page', () => {
    // An unselected board is a board of things to read, not a control panel.
    const { container } = renderBoard()

    expect(within(sheet(container, FIRST_PAGE)).queryByTestId('article-rotate')).toBeNull()
  })

  it('offers the rotate handle once the page is selected', () => {
    const { container } = renderBoard()
    tap(within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab'))

    expect(within(sheet(container, FIRST_PAGE)).getByTestId('article-rotate')).toBeTruthy()
  })

  it('swings the page when the handle is dragged', () => {
    const { container } = renderBoard()
    tap(within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab'))

    expect(tiltOf(container, FIRST_PAGE)).toBe(0)

    // Grab above the pin and pull down and to the right: a clockwise turn.
    drag(within(sheet(container, FIRST_PAGE)).getByTestId('article-rotate'), [400, 100], [700, 400])

    expect(tiltOf(container, FIRST_PAGE)).not.toBe(0)
  })

  it('holds the swing inside 45 degrees', () => {
    const { container } = renderBoard()
    tap(within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab'))

    // A pull that would be a quarter turn or more if it were allowed.
    drag(
      within(sheet(container, FIRST_PAGE)).getByTestId('article-rotate'),
      [400, 100],
      [1400, 900],
    )

    expect(Math.abs(tiltOf(container, FIRST_PAGE))).toBeLessThanOrEqual(45)
  })

  it('swings only the page whose handle was dragged', () => {
    // The angle is the entity's now, not a board-wide `paperTilt`. One page
    // being turned must leave the other lying exactly as it was — and the
    // ledger is seeded already swung, so "as it was" is a non-zero angle. That
    // is the stronger version of this test: an implementation that reset the
    // other page to upright would pass against a board of straight pages and
    // fails here.
    const { container } = renderBoard()
    const seeded = tiltOf(container, SECOND_PAGE)
    expect(seeded).not.toBe(0)

    tap(within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab'))
    drag(within(sheet(container, FIRST_PAGE)).getByTestId('article-rotate'), [400, 100], [700, 400])

    expect(tiltOf(container, FIRST_PAGE)).not.toBe(0)
    expect(tiltOf(container, SECOND_PAGE)).toBe(seeded)
  })

  it('leaves a page hanging straight unless something swung it', () => {
    // An angle belongs to a page and a page starts straight. The demo seeds one
    // of the four swung, because a page at an angle is a state the board
    // reaches through use and the seed board is where a reader meets it — the
    // pages it did not touch are the ones this asserts on.
    const { container } = renderBoard()

    expect(tiltOf(container, FIRST_PAGE)).toBe(0)
    expect(tiltOf(container, THIRD_PAGE)).toBe(0)
    expect(tiltOf(container, SECOND_PAGE)).not.toBe(0)
  })
})

describe('App — board files', () => {
  /** Open the drawer and arm the import, which is behind a confirmation. */
  function armImport(): HTMLInputElement {
    fireEvent.click(screen.getByRole('button', { name: /open preferences/i }))
    fireEvent.click(screen.getByRole('button', { name: /^import board…$/i }))
    return screen.getByLabelText(/choose a board file/i) as HTMLInputElement
  }

  /** Hand the file input a file, the way the picker would. */
  function choose(text: string, name = 'case-board.json'): void {
    const input = armImport()
    const file = new File([text], name, { type: 'application/json' })
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)
  }

  it('loads a board out of a file, replacing the one that was there', async () => {
    const { container } = render(<App />)
    expect(container.querySelectorAll('[data-article-id]').length).toBe(ARTICLE_IDS.length)

    const page = newArticle(
      { x: 0, y: 0 },
      '# A Loaded Case\n\nThe file this board came from.',
      'A Loaded Case',
      undefined,
      { id: 'loaded-page' },
    )
    choose(serializeBoard({ entities: [page], strings: [] }))

    // The imported page is a real sheet, not just an id in a list: its markdown
    // is rendered into elements and its tab carries its title.
    expect(await screen.findByRole('heading', { name: 'A Loaded Case' })).toBeTruthy()
    expect(within(sheet(container, 'loaded-page')).getByTestId('paper-tab').textContent).toContain(
      'A Loaded Case',
    )
    expect(container.querySelectorAll('[data-article-id]').length).toBe(1)
  })

  it('says why a file could not be read, and leaves the board alone', async () => {
    // A refusal with no reason is what makes somebody think their board is
    // corrupt when it is their JSON that is.
    const { container } = render(<App />)
    choose('{ this is not json')

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('not JSON')
    expect(container.querySelectorAll('[data-article-id]').length).toBe(ARTICLE_IDS.length)
  })

  it('exports the board as a file that loads back', async () => {
    // jsdom implements neither half of the download — there is no
    // createObjectURL and a real anchor click would try to navigate — so both
    // are stubbed, and what the test is left holding is the bytes that would
    // have been saved.
    const downloads: string[] = []
    const urls = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    const saved: Blob[] = []
    URL.createObjectURL = (blob: Blob) => {
      saved.push(blob)
      return 'blob:board'
    }
    URL.revokeObjectURL = () => {}
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download)
      })

    try {
      render(<App />)
      fireEvent.click(screen.getByRole('button', { name: /open preferences/i }))
      fireEvent.click(screen.getByRole('button', { name: /^export board…$/i }))

      expect(downloads).toEqual(['the-drowned-bell.json'])
      expect(saved).toHaveLength(1)
      const round = parseBoardFile(await readBoardFile(saved[0]))
      expect(round.ok).toBe(true)
      if (round.ok) expect(round.board.entities.length).toBe(demoBoard().entities.length)

      // Let the deferred revoke run while the stub is still installed. It is
      // scheduled on a timer on purpose (Safari reads the URL after the
      // handler returns), so restoring the globals first leaves it calling the
      // real API — which jsdom does not have — on the next tick.
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      click.mockRestore()
      URL.createObjectURL = urls.create
      URL.revokeObjectURL = urls.revoke
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
})

describe('App — preferences', () => {
  it('opens the preferences panel from the top bar', () => {
    renderBoard()
    fireEvent.click(screen.getByRole('button', { name: /open preferences/i }))

    expect(screen.getByTestId('preferences-panel')).toBeTruthy()
  })

  it('keeps clear-board inside preferences, behind confirmation', () => {
    // No one-click way to lose the board.
    renderBoard()
    expect(screen.queryByText(/clear board/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /open preferences/i }))
    expect(screen.getByRole('button', { name: /clear board/i })).toBeTruthy()
  })

  it('closes the editor when the board is cleared out from under it', () => {
    // The editor follows the selection, so clearing the board has to clear the
    // selection with it. An editor left open on a page that is no longer there
    // is a textarea whose every keystroke is written to a deleted entity.
    const { container } = renderBoard()
    tap(within(sheet(container, FIRST_PAGE)).getByTestId('paper-tab'))
    expect(screen.getByTestId('paper-editor')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /open preferences/i }))
    // Armed first, then confirmed by typing the word: the two steps are what
    // stands between a visit to the panel and a lost board.
    fireEvent.click(screen.getByRole('button', { name: /^clear board…$/i }))
    fireEvent.change(screen.getByLabelText(/to confirm clearing the board/i), {
      target: { value: 'clear' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^clear board$/i }))

    expect(screen.queryByTestId('paper-editor')).toBeNull()
    expect(container.querySelectorAll('[data-article-id]').length).toBe(0)
  })
})
