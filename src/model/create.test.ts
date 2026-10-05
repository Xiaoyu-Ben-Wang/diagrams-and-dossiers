import { describe, expect, it } from 'vitest'

import { IMAGE_SIZE, NOTE_SIZE } from './kinds'
import { imageFootprint, MAX_IMAGE_EDGE, newImage, newNote } from './create'

describe('imageFootprint', () => {
  it('leaves a picture that already fits exactly as it is', () => {
    expect(imageFootprint(240, 120)).toEqual({ width: 240, height: 120 })
  })

  it('shrinks a photograph to the longest edge, keeping its shape', () => {
    // A picture straight off a phone is several thousand pixels across; at its
    // own size it would be bigger than the article it sits beside.
    const landscape = imageFootprint(4032, 3024)

    expect(landscape.width).toBe(MAX_IMAGE_EDGE)
    expect(landscape.height).toBeCloseTo((MAX_IMAGE_EDGE * 3024) / 4032, 0)
  })

  it('shrinks by the longest edge whichever way up the picture is', () => {
    const portrait = imageFootprint(3024, 4032)

    expect(portrait.height).toBe(MAX_IMAGE_EDGE)
    expect(portrait.width).toBeLessThan(MAX_IMAGE_EDGE)
  })

  it('never enlarges, only shrinks', () => {
    // Blowing a 40px icon up to fill the board would look like a mistake, and
    // the picture would be no more readable for it.
    expect(imageFootprint(40, 30)).toEqual({ width: 40, height: 30 })
  })

  it('keeps a very wide picture wide', () => {
    const banner = imageFootprint(4000, 200)

    expect(banner.width).toBe(MAX_IMAGE_EDGE)
    expect(banner.height).toBeLessThan(40)
  })

  it('falls back to a usable box when the picture has no size of its own', () => {
    // An SVG with no intrinsic dimensions decodes to zeroes, and a zero-sized
    // entity is one nothing can hit-test or frame.
    for (const [w, h] of [[0, 0], [Number.NaN, 10], [-5, 10]]) {
      expect(imageFootprint(w, h)).toEqual(IMAGE_SIZE)
    }
  })
})

describe('newImage', () => {
  it('hangs straight, at the size it was measured', () => {
    const picture = newImage({ x: 10, y: 20 }, 'data:image/png;base64,AAAA', { width: 240, height: 120 })

    expect(picture.kind).toBe('image')
    expect(picture.board).toEqual({ x: 10, y: 20 })
    expect(picture.width).toBe(240)
    expect(picture.height).toBe(120)
    expect(picture.rotation).toBe(0)
  })

  it('arrives whole, with no crop', () => {
    // A picture comes to the board as it was; the damage is something you do
    // to it. Defaulting to a burnt edge would have every photograph arrive
    // pretending to have survived a fire.
    const picture = newImage({ x: 0, y: 0 }, 'data:,', { width: 10, height: 10 })

    expect(picture.edge).toBe('clean')
  })

  it('takes an edge when it is given one', () => {
    const picture = newImage({ x: 0, y: 0 }, 'data:,', { width: 10, height: 10 }, { edge: 'torn' })

    expect(picture.edge).toBe('torn')
  })

  it('gives each picture an id of its own', () => {
    const size = { width: 10, height: 10 }
    const a = newImage({ x: 0, y: 0 }, 'data:,', size)
    const b = newImage({ x: 0, y: 0 }, 'data:,', size)

    expect(a.id).not.toBe(b.id)
  })

  it('does not disturb the other kinds', () => {
    // A note still takes the plain footprint it always did — the image size is
    // the picture's own, not a board-wide constant that leaked.
    const note = newNote({ x: 0, y: 0 })

    expect(note.kind).toBe('note')
    expect('width' in note).toBe(false)
    expect(NOTE_SIZE.width).toBeGreaterThan(0)
  })
})
