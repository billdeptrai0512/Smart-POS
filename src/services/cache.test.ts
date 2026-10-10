import { describe, it, expect, vi } from 'vitest'
import { reportCache, inflightCache, invalidateReportCache } from './cache'

const deferred = () => {
    let resolve, reject
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

describe('cache.through', () => {
    it('đọc đồng thời cùng key dùng chung 1 lần fetch (cùng object trả về)', async () => {
        const d = deferred()
        const fn = vi.fn(() => d.promise)
        const a = reportCache.through(['t-share', 'k'], fn)
        const b = reportCache.through(['t-share', 'k'], fn)
        d.resolve({ v: 1 })
        const [ra, rb] = await Promise.all([a, b])
        expect(fn).toHaveBeenCalledTimes(1)
        expect(ra).toBe(rb)
        // và đã vào cache: lần sau không fetch nữa
        await reportCache.through(['t-share', 'k'], fn)
        expect(fn).toHaveBeenCalledTimes(1)
    })

    it('lỗi không bị cache và không kẹt: lần sau fetch lại', async () => {
        const fn = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')
        await expect(reportCache.through(['t-err', 'k'], fn)).rejects.toThrow('boom')
        await expect(reportCache.through(['t-err', 'k'], fn)).resolves.toBe('ok')
        expect(fn).toHaveBeenCalledTimes(2)
    })

    it('invalidate khi đang bay: caller sau đó fetch mới, kết quả cũ không ghi đè cache', async () => {
        const stale = deferred()
        const first = reportCache.through(['t-inv', 'k'], () => stale.promise)
        invalidateReportCache('t-inv')
        const fresh = vi.fn().mockResolvedValue('fresh')
        expect(await reportCache.through(['t-inv', 'k'], fresh)).toBe('fresh')
        stale.resolve('stale')
        expect(await first).toBe('stale')                       // caller cũ vẫn nhận số của nó
        expect(await reportCache.through(['t-inv', 'k'], fresh)).toBe('fresh') // cache giữ bản mới
        expect(fresh).toHaveBeenCalledTimes(1)
    })
})

describe('inflightCache (TTL 0)', () => {
    it('chia sẻ lần đọc đang bay nhưng KHÔNG giữ kết quả; invalidateReportCache huỷ lần đang bay', async () => {
        const d = deferred()
        const fn = vi.fn(() => d.promise)
        const a = inflightCache.through(['t-if', 'k'], fn)
        const b = inflightCache.through(['t-if', 'k'], fn)
        expect(fn).toHaveBeenCalledTimes(1)
        d.resolve(1)
        await Promise.all([a, b])
        await inflightCache.through(['t-if', 'k'], fn) // đã xong → phải fetch lại (không cache)
        expect(fn).toHaveBeenCalledTimes(2)

        const slow = deferred()
        const first = inflightCache.through(['t-if2', 'k'], () => slow.promise)
        invalidateReportCache('t-if2')                  // vd ghi kho xong → reload không được nhập vào lần đọc cũ
        const fresh = vi.fn().mockResolvedValue('new')
        expect(await inflightCache.through(['t-if2', 'k'], fresh)).toBe('new')
        slow.resolve('old')
        expect(await first).toBe('old')
    })
})
