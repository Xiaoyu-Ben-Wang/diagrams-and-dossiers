// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { App } from './App'

/**
 * Smoke tests.
 *
 * jsdom has no layout engine, so every pin resolves to a null rect and nothing
 * is positioned. That is exactly what makes this worth running: it proves the
 * component tree renders end to end — markdown pipeline, sanitizer, anchor
 * projection, timeline — without any of the measurement machinery throwing.
 */
describe('App', () => {
  it('renders the board without throwing', () => {
    render(<App />)
    expect(screen.getByText('The Case Board')).toBeTruthy()
  })

  it('renders markdown into real elements, not raw text', () => {
    const { container } = render(<App />)
    const article = container.querySelector('.article')
    expect(article).not.toBeNull()

    // The heading must have become an <h1>, which is what proves the markdown
    // pipeline ran rather than the source being dumped into the page.
    expect(article!.querySelector('h1')?.textContent).toBe('The Drowned Bell')
    // And a phrase from deep in the body survived sanitizing.
    expect(article!.textContent).toContain('Black Coin')
    expect(article!.querySelectorAll('li').length).toBeGreaterThan(0)
    expect(article!.querySelector('blockquote')).not.toBeNull()
  })

  it('sanitizes the article rather than injecting raw html', () => {
    const { container } = render(<App />)
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders wikilinks as anchors, without their brackets', () => {
    const { container } = render(<App />)
    const article = container.querySelector('.article')!
    const links = article.querySelectorAll('a.wikilink')

    expect(links.length).toBeGreaterThan(0)
    // The brackets are consumed — this is why linkifying must run before the
    // article is projected for anchoring.
    expect(article.textContent).not.toContain('[[')
    expect(article.textContent).toContain('Molgar the Pale')
  })

  it('marks a link to a missing article rather than dropping it', () => {
    const { container } = render(<App />)
    // [[The Sea Ghost]] is deliberately not in the demo index.
    const missing = container.querySelectorAll('.article a.wikilink-missing')
    expect(missing.length).toBeGreaterThan(0)
    expect(missing[0].textContent).toBe('Sea Ghost')
  })

  it('gives wikilinks an href so they are keyboard reachable', () => {
    const { container } = render(<App />)
    const link = container.querySelector('.article a.wikilink')!
    expect(link.getAttribute('href')).toBeTruthy()
  })

  it('shows the chronology ribbon', () => {
    render(<App />)
    expect(screen.getByTestId('timeline-ribbon')).toBeTruthy()
  })

  it('explains that the chronology is empty before anything is dated', () => {
    render(<App />)
    expect(screen.getByText(/Pin something to start the chronology/)).toBeTruthy()
    expect(screen.getAllByText(/no dated items/).length).toBeGreaterThan(0)
  })

  it('offers the recap controls, disabled while there is nothing to play', () => {
    render(<App />)
    const play = screen.getByRole('button', { name: /play the campaign as a recap/i })
    expect(play).toBeTruthy()
    expect((play as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the markdown source alongside the board', () => {
    render(<App />)
    const editor = screen.getByLabelText('Article markdown source') as HTMLTextAreaElement
    expect(editor.value).toContain('# The Drowned Bell')
  })

  it('switches to the wiki view, hiding the source editor', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'wiki' }))

    // The reader renders the same article...
    expect(screen.getByLabelText('Notes in this article')).toBeTruthy()
    // ...but the board's editing surface is gone.
    expect(screen.queryByLabelText('Article markdown source')).toBeNull()
  })

  it('switches back to the board', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'wiki' }))
    fireEvent.click(screen.getByRole('button', { name: 'board' }))

    expect(screen.getByLabelText('Article markdown source')).toBeTruthy()
  })

  it('keeps the chronology ribbon visible in both views', () => {
    render(<App />)
    expect(screen.getByTestId('timeline-ribbon')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'wiki' }))
    expect(screen.getByTestId('timeline-ribbon')).toBeTruthy()
  })

  it('says so when the article has no notes yet', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'wiki' }))
    expect(screen.getByText(/No notes in this article yet/)).toBeTruthy()
  })
})
