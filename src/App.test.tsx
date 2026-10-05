// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { App } from './App'
import { DEFAULT_SLACK, sagFor, YARN_COLOR } from './board/yarn'

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

describe('App — the board', () => {
  it('renders without throwing', () => {
    render(<App />)
    expect(screen.getByText('The Case Board')).toBeTruthy()
  })

  it('renders markdown into real elements, not raw text', () => {
    const { container } = render(<App />)
    const article = container.querySelector('.article')
    expect(article).not.toBeNull()

    expect(article!.querySelector('h1')?.textContent).toBe('The Drowned Bell')
    expect(article!.textContent).toContain('Black Coin')
    expect(article!.querySelectorAll('li').length).toBeGreaterThan(0)
  })

  it('sanitizes the article rather than injecting raw html', () => {
    const { container } = render(<App />)
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders the article as prose, with no wiki markup left in it', () => {
    const { container } = render(<App />)
    const article = container.querySelector('.article')!

    expect(article.textContent).not.toContain('[[')
    expect(article.textContent).toContain('Molgar the Pale')
    // Nothing in the article navigates anywhere now that the wiki is gone.
    expect(article.querySelectorAll('a').length).toBe(0)
  })

  it('renders the board grid', () => {
    render(<App />)
    expect(screen.getByTestId('board-grid')).toBeTruthy()
  })
})

describe('App — document selection', () => {
  it('hides the markdown editor until a document is selected', () => {
    // The board is the point of the app; a permanently docked editor would eat
    // a third of it for the majority of the time you are not typing.
    render(<App />)
    expect(screen.queryByLabelText('Article markdown source')).toBeNull()
  })

  it('opens the editor when the document tab is clicked', () => {
    render(<App />)
    tap(screen.getByTestId('paper-tab'))

    const editor = screen.getByTestId('paper-editor')
    expect(editor).toBeTruthy()
    expect(within(editor).getByLabelText('Article markdown source')).toBeTruthy()
  })

  it('shows the formatting toolbar alongside the editor', () => {
    render(<App />)
    tap(screen.getByTestId('paper-tab'))

    const toolbar = screen.getByTestId('markdown-toolbar')
    expect(within(toolbar).getByLabelText(/Bold/)).toBeTruthy()
    expect(within(toolbar).getByLabelText(/Italic/)).toBeTruthy()
  })

  it('closes the editor when the tab is clicked again', () => {
    render(<App />)
    tap(screen.getByTestId('paper-tab'))
    tap(screen.getByTestId('paper-tab'))

    expect(screen.queryByTestId('paper-editor')).toBeNull()
  })

  it('applies a formatting action to the source', () => {
    render(<App />)
    tap(screen.getByTestId('paper-tab'))

    const textarea = screen.getByLabelText('Article markdown source') as HTMLTextAreaElement
    textarea.setSelectionRange(0, 14)
    fireEvent.click(within(screen.getByTestId('markdown-toolbar')).getByLabelText(/Bold/))

    expect(textarea.value.startsWith('**# The Drowned')).toBe(true)
  })
})

describe('App — chronology', () => {
  it('shows the ribbon', () => {
    render(<App />)
    expect(screen.getByTestId('timeline-ribbon')).toBeTruthy()
  })

  it('explains that the chronology is empty before anything is dated', () => {
    render(<App />)
    expect(screen.getByText(/Pin something to start the chronology/)).toBeTruthy()
    expect(screen.getAllByText(/no dated items/).length).toBeGreaterThan(0)
  })

  it('disables playback while there is nothing to play', () => {
    render(<App />)
    const play = screen.getByRole('button', { name: /play the campaign as a recap/i })
    expect((play as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('App — routing', () => {
  it('serves the board at the root', () => {
    render(<App />)
    expect(window.location.pathname).toBe('/')
    expect(screen.getByTestId('board-canvas')).toBeTruthy()
  })

  it('has no nav to anywhere else', () => {
    // The board is the only page; a tab strip with one always-active tab was
    // chrome with no function.
    render(<App />)
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull()
  })
})

describe('App — pin mode', () => {
  const freePins = (container: HTMLElement) =>
    container.querySelectorAll('[data-status="free"]').length

  it('does not pin on a plain click by default', () => {
    // A board you can accidentally pin while trying to select something is a
    // board you stop trusting.
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('board-canvas'))
    expect(freePins(container)).toBe(0)
  })

  it('pins on a ctrl-click without any mode', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true })
    expect(freePins(container)).toBe(1)
  })

  it('pins on a cmd-click too, since ctrl-click is the macOS context menu', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('board-canvas'), { metaKey: true })
    expect(freePins(container)).toBe(1)
  })

  it('pins on a plain click once pin mode is on', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByLabelText('Pin mode'))
    fireEvent.click(screen.getByTestId('board-canvas'))
    expect(freePins(container)).toBe(1)
  })

  it('stops pinning when pin mode is switched back off', () => {
    const { container } = render(<App />)
    const toggle = screen.getByLabelText('Pin mode')
    fireEvent.click(toggle)
    fireEvent.click(toggle)

    fireEvent.click(screen.getByTestId('board-canvas'))
    expect(freePins(container)).toBe(0)
  })

  it('announces its pressed state', () => {
    render(<App />)
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
    const { container } = render(<App />)
    rightClick(screen.getByTestId('board-canvas'))

    fireEvent.click(screen.getByText('Add pin'))
    expect(freePins(container)).toBe(1)
  })

  it('offers the context menu on bare board', () => {
    render(<App />)
    rightClick(screen.getByTestId('board-canvas'))
    expect(screen.getByText('Create post-it')).toBeTruthy()
  })

  it('creates a post-it from the context menu', () => {
    const { container } = render(<App />)
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
    const { container } = render(<App />)
    const article = container.querySelector('.article')!

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

    const { container } = render(<App />)
    const article = container.querySelector('.article')!

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

  it('connects two pins on the board with a string', () => {
    // The whole point of the board: drag from one pin to another and get yarn.
    const { container } = render(<App />)
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
    const { container } = render(<App />)
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
    const { container } = render(<App />)
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
    const { container } = render(<App />)
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
    const { container } = render(<App />)
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    fireEvent.click(canvas, { ctrlKey: true, clientX: 520, clientY: 260 })

    const tacks = container.querySelectorAll('button[data-pin-id]')
    fireEvent.pointerDown(tacks[0], { button: 0, pointerId: 31, clientX: 300, clientY: 200 })
    fireEvent.pointerMove(canvas, { pointerId: 31, clientX: 520, clientY: 260 })
    fireEvent.pointerUp(canvas, { pointerId: 31, clientX: 520, clientY: 260 })

    const yarn = container.querySelector('svg[aria-hidden="true"]') as SVGElement
    const paper = screen.getByTestId('paper')

    // The yarn must come after the paper in document order, since these are
    // absolutely positioned siblings and later wins.
    expect(yarn.compareDocumentPosition(paper) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
  })

  it('starts a string from a pin drag rather than a selection', async () => {
    // A pin is a place yarn attaches to, so the drag means the same thing on a
    // free pin as on an anchored one. The band is for bare board only.
    const { container } = render(<App />)
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
    const { container } = render(<App />)
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.click(canvas, { ctrlKey: true, clientX: 300, clientY: 200 })
    expect(container.querySelectorAll('.is-selected').length).toBe(0)

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 250, clientY: 150 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 })

    expect(container.querySelectorAll('.is-selected').length).toBe(1)
  })

  it('shows the rubber band while it is being dragged', () => {
    render(<App />)
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 250, clientY: 150 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 })

    expect(screen.getByTestId('marquee')).toBeTruthy()
  })

  it('hides the rubber band on release', () => {
    render(<App />)
    const canvas = screen.getByTestId('board-canvas')

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 9, clientX: 250, clientY: 150 })
    fireEvent.pointerMove(canvas, { pointerId: 9, clientX: 350, clientY: 250 })
    fireEvent.pointerUp(canvas, { pointerId: 9, clientX: 350, clientY: 250 })

    expect(screen.queryByTestId('marquee')).toBeNull()
  })

  it('clears the selection on a plain click', () => {
    const { container } = render(<App />)
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
    render(<App />)
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
    const { container } = render(<App />)
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
    const { container } = render(<App />)
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
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })

    const tack = container.querySelector('button[data-pin-id]') as HTMLElement
    fireEvent.pointerEnter(tack)

    const card = await screen.findByRole('tooltip')
    expect(card).toBeTruthy()
  })

  it('shows the written description in the hover card', async () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)
    fireEvent.change(screen.getByLabelText('Pin note'), {
      target: { value: 'The ferryman was lying.' },
    })
    fireEvent.keyDown(document, { key: 'Escape' })

    fireEvent.pointerEnter(container.querySelector('button[data-pin-id]') as HTMLElement)
    expect((await screen.findByRole('tooltip')).textContent).toContain('The ferryman was lying.')
  })

  it('drops the hover card when the camera moves under it', async () => {
    // The card measures its pin's screen position when it appears, and a zoom
    // relocates every pin without firing the scroll event the card listens for.
    // Left alone it would sit where the pin used to be, pointing at nothing.
    const { container } = render(<App />)
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
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })

    const tack = container.querySelector('button[data-pin-id]') as HTMLElement
    expect(tack.getAttribute('aria-describedby')).toMatch(/^pin-tooltip-/)
  })

  it('offers Move pin in the editor', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)

    expect(screen.getByText('Move pin')).toBeTruthy()
  })

  it('closes the editor and prompts for the drag when Move pin is chosen', () => {
    // You cannot drag a pin accurately with a card sitting over it.
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)

    fireEvent.click(screen.getByText('Move pin'))

    expect(screen.queryByTestId('pin-editor')).toBeNull()
    expect(screen.getByRole('status').textContent).toMatch(/Drag the pin/)
  })

  it('finishes the move on Escape', () => {
    const { container } = render(<App />)
    fireEvent.click(screen.getByTestId('board-canvas'), { ctrlKey: true, clientX: 300, clientY: 200 })
    openPinEditor(container)
    fireEvent.click(screen.getByText('Move pin'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('repositions the pin when dragged in move mode', async () => {
    const { container } = render(<App />)
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

describe('App — swinging the page', () => {
  /** A drag: press, travel, release. */
  function drag(element: Element, from: [number, number], to: [number, number]): void {
    fireEvent.pointerDown(element, { button: 0, pointerId: 3, clientX: from[0], clientY: from[1] })
    fireEvent.pointerMove(element, { pointerId: 3, clientX: to[0], clientY: to[1] })
    fireEvent.pointerUp(element, { pointerId: 3, clientX: to[0], clientY: to[1] })
  }

  const tiltOf = (container: HTMLElement): number => {
    const transform = container.querySelector('[data-testid="paper"]')?.getAttribute('style') ?? ''
    const match = transform.match(/rotate\(([-\d.]+)deg\)/)
    return match ? Number.parseFloat(match[1]) : 0
  }

  it('hangs the page from a pin at its top-centre', () => {
    render(<App />)

    expect(screen.getByTestId('paper-pin')).toBeTruthy()
  })

  it('offers no rotate handle on an unselected page', () => {
    // An unselected board is a board of things to read, not a control panel.
    render(<App />)

    expect(screen.queryByTestId('article-rotate')).toBeNull()
  })

  it('offers the rotate handle once the page is selected', () => {
    render(<App />)
    tap(screen.getByTestId('paper-tab'))

    expect(screen.getByTestId('article-rotate')).toBeTruthy()
  })

  it('swings the page when the handle is dragged', () => {
    const { container } = render(<App />)
    tap(screen.getByTestId('paper-tab'))

    expect(tiltOf(container)).toBe(0)

    // Grab above the pin and pull down and to the right: a clockwise turn.
    drag(screen.getByTestId('article-rotate'), [400, 100], [700, 400])

    expect(tiltOf(container)).not.toBe(0)
  })

  it('holds the swing inside 45 degrees', () => {
    const { container } = render(<App />)
    tap(screen.getByTestId('paper-tab'))

    // A pull that would be a quarter turn or more if it were allowed.
    drag(screen.getByTestId('article-rotate'), [400, 100], [1400, 900])

    expect(Math.abs(tiltOf(container))).toBeLessThanOrEqual(45)
  })

  it('leaves the page hanging straight until it is swung', () => {
    const { container } = render(<App />)

    expect(tiltOf(container)).toBe(0)
  })
})

describe('App — preferences', () => {
  it('opens the preferences panel from the top bar', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: /open preferences/i }))

    expect(screen.getByTestId('preferences-panel')).toBeTruthy()
  })

  it('keeps clear-board inside preferences, behind confirmation', () => {
    // No one-click way to lose the board.
    render(<App />)
    expect(screen.queryByText(/clear board/i)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /open preferences/i }))
    expect(screen.getByRole('button', { name: /clear board/i })).toBeTruthy()
  })
})
