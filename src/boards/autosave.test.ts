// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createBoardStore } from '../board/store'
import { newNote } from '../model/create'
import { LOCAL_VIEWER } from '../access/permissions'
import { attachAutosave } from './autosave'

function open() {
  const store = createBoardStore({ viewer: LOCAL_VIEWER })
  const save = vi.fn()
  const autosave = attachAutosave({ store, save, delay: 400, maxDelay: 2000 })
  return { store, save, autosave }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('writing the board back', () => {
  it('writes nothing at all until something changes', async () => {
    const { save, autosave } = open()

    await vi.advanceTimersByTimeAsync(5000)

    expect(save).not.toHaveBeenCalled()
    autosave.detach()
  })

  it('writes once the quiet time has passed', async () => {
    const { store, save, autosave } = open()

    store.addEntities(() => [newNote({ x: 0, y: 0 })])
    await vi.advanceTimersByTimeAsync(400)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].entities).toHaveLength(1)
    autosave.detach()
  })

  it('writes the state it has when it gets there, not the state it saw', async () => {
    const { store, save, autosave } = open()

    store.addEntities(() => [newNote({ x: 0, y: 0 })])
    await vi.advanceTimersByTimeAsync(100)
    store.addEntities(() => [newNote({ x: 50, y: 50 })])
    await vi.advanceTimersByTimeAsync(400)

    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].entities).toHaveLength(2)
    autosave.detach()
  })

  it('does not let continuous writing put off the write forever', async () => {
    const { store, save, autosave } = open()

    // A change every 100ms for longer than the ceiling: the trailing timer alone
    // would never fire.
    for (let step = 0; step < 25; step += 1) {
      store.addEntities(() => [newNote({ x: step, y: 0 })])
      await vi.advanceTimersByTimeAsync(100)
    }

    expect(save).toHaveBeenCalled()
    expect(save.mock.calls[0][0].entities.length).toBeLessThanOrEqual(20)
    autosave.detach()
  })

  it('writes on the way out, so walking back to the library does not lose anything', async () => {
    const { store, save, autosave } = open()

    store.addEntities(() => [newNote({ x: 0, y: 0 })])
    autosave.detach()
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(1)
  })

  it('writes nothing on the way out if there was nothing to write', async () => {
    const { save, autosave } = open()

    autosave.detach()
    await vi.advanceTimersByTimeAsync(1000)

    expect(save).not.toHaveBeenCalled()
  })

  it('writes when the page is put away', async () => {
    const { store, save, autosave } = open()

    store.addEntities(() => [newNote({ x: 0, y: 0 })])
    window.dispatchEvent(new Event('pagehide'))
    await vi.advanceTimersByTimeAsync(0)

    expect(save).toHaveBeenCalledTimes(1)
    autosave.detach()
  })

  it('writes when the tab is hidden, and not when it is shown again', async () => {
    const { store, save, autosave } = open()

    store.addEntities(() => [newNote({ x: 0, y: 0 })])
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
    autosave.detach()
  })

  it('stops watching once it is detached', async () => {
    const { store, save, autosave } = open()

    autosave.detach()
    store.addEntities(() => [newNote({ x: 0, y: 0 })])
    await vi.advanceTimersByTimeAsync(5000)

    expect(save).not.toHaveBeenCalled()
  })
})
