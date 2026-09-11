// Chuỗi VietQR (chuẩn EMVCo của NAPAS) — app ngân hàng nào quét cũng điền sẵn STK + số tiền.
// Tự sinh rồi vẽ bằng QRCodeSVG thay vì nhúng ảnh img.vietqr.io: in bill không phụ thuộc mạng
// (rớt wifi vẫn in được), và không phải đợi tải ảnh ngoài trước khi html2canvas chụp.
const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`

// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — trường 63 bắt buộc, sai là app ngân hàng từ chối mã.
export function crc16(str) {
    let crc = 0xFFFF
    for (let i = 0; i < str.length; i++) {
        crc ^= str.charCodeAt(i) << 8
        for (let b = 0; b < 8; b++) crc = (crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1) & 0xFFFF
    }
    return crc.toString(16).toUpperCase().padStart(4, '0')
}

// bin: mã NAPAS của ngân hàng (Techcombank 970407). amount (đ) > 0 → QR "động" (01=12), app tự
// điền số tiền; không có thì QR tĩnh (01=11), khách tự gõ tiền.
export function vietQrPayload({ bin, account, amount }) {
    const merchant = tlv('00', 'A000000727') + tlv('01', tlv('00', bin) + tlv('01', account)) + tlv('02', 'QRIBFTTA')
    const body = tlv('00', '01') + tlv('01', amount > 0 ? '12' : '11') + tlv('38', merchant) + tlv('53', '704')
        + (amount > 0 ? tlv('54', String(Math.round(amount))) : '') + tlv('58', 'VN') + '6304'
    return body + crc16(body)
}
