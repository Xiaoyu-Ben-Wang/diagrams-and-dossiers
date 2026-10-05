// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import { firstImage, isImageFile } from './image-file'

/** A stand-in for a dropped file. jsdom has File, but not the FileList around it. */
function file(name: string, type = ''): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

describe('isImageFile', () => {
  it('accepts anything the browser has already identified as an image', () => {
    expect(isImageFile(file('scan.png', 'image/png'))).toBe(true)
    expect(isImageFile(file('whatever', 'image/webp'))).toBe(true)
  })

  it('falls back to the extension when the type is missing', () => {
    // A file dragged out of some file managers arrives with an empty type, and
    // refusing it would look like the board simply does not take pictures.
    for (const name of ['a.png', 'a.PNG', 'a.jpg', 'a.jpeg', 'a.gif', 'a.webp', 'a.svg']) {
      expect(isImageFile(file(name)), name).toBe(true)
    }
  })

  it('turns away things that are not pictures', () => {
    expect(isImageFile(file('notes.txt', 'text/plain'))).toBe(false)
    expect(isImageFile(file('archive.zip', 'application/zip'))).toBe(false)
    expect(isImageFile(file('notes.txt'))).toBe(false)
    // A picture's name inside a non-picture type is not a picture.
    expect(isImageFile(file('holiday.png.txt', 'text/plain'))).toBe(false)
  })
})

describe('firstImage', () => {
  it('picks the first picture out of a mixed drop', () => {
    const dropped = [file('notes.txt', 'text/plain'), file('scan.png', 'image/png'), file('b.jpg', 'image/jpeg')]

    expect(firstImage(dropped)?.name).toBe('scan.png')
  })

  it('finds nothing in a drop with no pictures in it', () => {
    expect(firstImage([file('notes.txt', 'text/plain'), file('a.zip')])).toBeNull()
  })

  it('finds nothing in an empty drop', () => {
    expect(firstImage([])).toBeNull()
  })
})
