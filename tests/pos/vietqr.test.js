// QR chuyển khoản in trên bill (PrintBill) — sai 1 ký tự là app ngân hàng báo mã không hợp lệ,
// hoặc tệ hơn: chuyển nhầm số tiền. Nguồn: src/utils/vietqr.js

import { describe, it, expect } from 'vitest'
import { crc16, vietQrPayload } from '../../src/utils/vietqr'

describe('vietQrPayload', () => {
    it('CRC-16/CCITT-FALSE đúng giá trị kiểm chuẩn', () => {
        expect(crc16('123456789')).toBe('29B1')
    })

    it('QR động: STK Techcombank + số tiền hoá đơn, CRC khớp phần thân', () => {
        const qr = vietQrPayload({ bin: '970407', account: '2274868686', amount: 300000 })

        expect(qr.slice(0, -4)).toBe(
            '000201' + '010212'
            + '3854' + '0010A000000727' + '0124' + '0006970407' + '01102274868686' + '0208QRIBFTTA'
            + '5303704' + '5406300000' + '5802VN' + '6304'
        )
        expect(qr.slice(-4)).toBe(crc16(qr.slice(0, -4)))
    })

    it('không có số tiền → QR tĩnh, bỏ trường 54', () => {
        const qr = vietQrPayload({ bin: '970407', account: '2274868686', amount: 0 })

        expect(qr.startsWith('000201010211')).toBe(true)
        expect(qr).not.toContain('5406')
    })
})
