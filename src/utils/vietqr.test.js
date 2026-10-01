import { describe, it, expect } from 'vitest'
import { vietQrPayload } from './vietqr'

describe('vietQrPayload', () => {
    // Chuỗi giải mã từ mã QR tĩnh in sẵn của quán (Loa Ting Ting/9Pay, Techcombank).
    it('khớp từng ký tự mã tĩnh in sẵn của quán', () => {
        expect(vietQrPayload({ bin: '970407', account: 'M99900003951129' }))
            .toBe('00020101021138590010A000000727012900069704070115M999000039511290208QRIBFTTA53037045802VN63040024')
    })
})
