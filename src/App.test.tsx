// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { App } from './App'

/**
 * Smoke tests.
 *
 * jsdom has no layout engine, so every pin resolves to a null rect and nothing
 * is positioned. That is what makes these worth running: the tree renders end to
 * end — markdown pipeline, sanitizer, linkifier, anchor projection, canvas,
 * timeline — without any of the measurement machinery throwing.
 *
 * The URL is real state that persists across tests in a file, so it is reset
 * between them; otherwise a test that navigates to /wiki leaves every later test
 * on the wiki page.
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

  it('renders wikilinks as anchors, without their brackets', () => {
    const { container } = render(<App />)
    const article = container.querySelector('.article')!

    expect(article.querySelectorAll('a.wikilink').length).toBeGreaterThan(0)
    expect(article.textContent).not.toContain('[[')
    expect(article.textContent).toContain('Molgar the Pale')
  })

  it('marks a link to a missing article rather than dropping it', () => {
    const { container } = render(<App />)
    const missing = container.querySelectorAll('.article a.wikilink-missing')
    expect(missing.length).toBeGreaterThan(0)
    expect(missing[0].textContent).toBe('Sea Ghost')
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
    expect(within(toolbar).getByLabelText(/Wikilink/)).toBeTruthy()
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
  it('links to the wiki rather than toggling a mode', () => {
    // A real href, so middle-click and cmd-click open a new tab for free.
    render(<App />)
    const link = screen.getByRole('link', { name: 'Wiki' })
    expect(link.getAttribute('href')).toBe('/wiki')
  })

  it('navigates to the wiki and changes the URL', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Wiki' }))

    expect(window.location.pathname).toBe('/wiki')
    expect(screen.getByLabelText('Notes in this article')).toBeTruthy()
    // The board's editing surface belongs to the board page.
    expect(screen.queryByTestId('paper-editor')).toBeNull()
    expect(screen.queryByTestId('board-canvas')).toBeNull()
  })

  it('comes back to the board', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Wiki' }))
    fireEvent.click(screen.getByRole('link', { name: 'Board' }))

    expect(window.location.pathname).toBe('/')
    expect(screen.getByTestId('board-canvas')).toBeTruthy()
  })

  it('shows the wiki directly when the app loads at /wiki', () => {
    // A deep link has to work — that is the point of giving a page a URL.
    window.history.replaceState(null, '', '/wiki')
    render(<App />)

    expect(screen.getByLabelText('Notes in this article')).toBeTruthy()
  })

  it('says so when the article has no notes yet', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('link', { name: 'Wiki' }))
    expect(screen.getByText(/No notes in this article yet/)).toBeTruthy()
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
