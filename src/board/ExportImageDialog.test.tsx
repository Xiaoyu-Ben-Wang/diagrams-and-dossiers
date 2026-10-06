// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExportImageDialog, type ExportOptions } from './ExportImageDialog'
import { EXPORT_MARGIN } from './export-image'
import type { BoardState } from './store'

/** The board below is 400x200, and the export pads it on every side. */
const BOARD_W = 400 + EXPORT_MARGIN * 2
const BOARD_H = 200 + EXPORT_MARGIN * 2

const rect = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

const BOARD: BoardState = { entities: [], strings: [] }

function open(overrides: Partial<Parameters<typeof ExportImageDialog>[0]> = {}) {
  const onRender = vi.fn(async () => new Blob(['x'], { type: 'image/png' }))
  const onClose = vi.fn()
  const rendered = render(
    <ExportImageDialog
      board={BOARD}
      rects={[rect(0, 0, 400, 200)]}
      surface="cork"
      theme="dark"
      onRender={onRender}
      onClose={onClose}
      {...overrides}
    />,
  )
  return { ...rendered, onRender, onClose }
}

beforeEach(() => {
  // jsdom has no object URLs.
  URL.createObjectURL = vi.fn(() => 'blob:stub')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the export dialog', () => {
  it('offers the sizes of the whole board, with the margin', () => {
    open()

    // The whole board plus the margin, at the default 2x.
    const text = screen.getByTestId('export-size').textContent ?? ''
    expect(text).toMatch(new RegExp(`${BOARD_W * 2} × ${BOARD_H * 2}`))
  })

  it('follows the chosen resolution', () => {
    open()

    fireEvent.click(screen.getByTestId('export-scale-1'))
    expect(screen.getByTestId('export-size').textContent).toMatch(
      new RegExp(`${BOARD_W} × ${BOARD_H}`),
    )

    fireEvent.click(screen.getByTestId('export-scale-3'))
    expect(screen.getByTestId('export-size').textContent).toMatch(
      new RegExp(`${BOARD_W * 3} × ${BOARD_H * 3}`),
    )
  })

  it('says so when the board is too large for the resolution asked for', () => {
    // A board that cannot be drawn at 3x: the dialog reports the scale it will
    // use rather than silently exporting something else.
    open({ rects: [rect(0, 0, 30_000, 20_000)] })

    fireEvent.click(screen.getByTestId('export-scale-3'))

    expect(screen.getByTestId('export-clamped').textContent).toMatch(/instead/)
  })

  it('has nothing to offer on an empty board', () => {
    open({ rects: [] })

    expect(screen.getByTestId('export-size').textContent).toMatch(/Nothing on the board/)
    expect((screen.getByTestId('export-download') as HTMLButtonElement).disabled).toBe(true)
  })

  it('hands the board the chosen options when downloading', async () => {
    const onRender = vi.fn(async (_options: ExportOptions) => new Blob(['x'], { type: 'image/png' }))
    open({ onRender })

    fireEvent.click(screen.getByTestId('export-fill-white'))
    fireEvent.click(screen.getByTestId('export-scale-1'))
    fireEvent.click(screen.getByTestId('export-download'))

    await vi.waitFor(() => expect(onRender).toHaveBeenCalled())
    expect(onRender.mock.calls.at(-1)![0]).toEqual({
      fill: 'white',
      surface: 'cork',
      custom: expect.any(String),
      pattern: 'plain',
      scale: 1,
    })
  })

  it('reports a refused render rather than failing quietly', async () => {
    const onRender = vi.fn(async () => 'A picture on this board could not be included.')
    open({ onRender })

    fireEvent.click(screen.getByTestId('export-download'))

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not be included/)
  })

  it('says the clipboard would not take it, rather than claiming a copy', async () => {
    // jsdom has no `ClipboardItem`, which is the same situation as a browser
    // refusing an image this size.
    open()

    fireEvent.click(screen.getByTestId('export-copy'))

    expect((await screen.findByRole('alert')).textContent).toMatch(/download it instead/)
  })

  it('closes on Escape, and on a press on the darkening itself', () => {
    const { onClose, container } = open()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.pointerDown(container.querySelector('.export-scrim')!)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not close on a press inside the panel', () => {
    const { onClose } = open()

    fireEvent.pointerDown(screen.getByRole('dialog'))

    expect(onClose).not.toHaveBeenCalled()
  })
})
