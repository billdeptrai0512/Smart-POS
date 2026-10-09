import { describe, it, expect, vi, afterEach } from 'vitest'
import { entryOf, hasNewVersion } from './staleChunk'

const page = (hash) => `<script type="module" crossorigin src="/assets/index-${hash}.js"></script>`

describe('entryOf', () => {
  it('lấy đường dẫn bundle entry từ index.html', () => {
    expect(entryOf(page('Ab1_-x'))).toBe('/assets/index-Ab1_-x.js')
  })
  it('không có entry → undefined', () => {
    expect(entryOf('<html></html>')).toBeUndefined()
  })
})

describe('hasNewVersion', () => {
  afterEach(() => vi.unstubAllGlobals())

  const run = async (running, served) => {
    vi.stubGlobal('document', {
      querySelector: () => running && { getAttribute: () => `/assets/index-${running}.js` },
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => served })))
    return hasNewVersion()
  }

  it('hash khác → có bản mới', async () => {
    expect(await run('old', page('new'))).toBe(true)
  })
  it('hash giống → không', async () => {
    expect(await run('same', page('same'))).toBe(false)
  })
  it('dev (không có script hash) → không', async () => {
    expect(await run(null, page('new'))).toBe(false)
  })
  it('lỗi mạng → không', async () => {
    vi.stubGlobal('document', { querySelector: () => ({ getAttribute: () => '/assets/index-a.js' }) })
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await hasNewVersion()).toBe(false)
  })
})
