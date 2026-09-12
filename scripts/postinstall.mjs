// postinstall: chạy patch-package, TRỪ khi đang build trên Vercel.
//
// patches/ chỉ vá mã Java của plugin ESC/POS (timeout TCP 30ms — xem 921c1ad), thứ chỉ Gradle
// dùng khi đóng gói APK. Bản web Vercel không đụng tới file đó.
//
// Vì sao phải bỏ qua: patch-package áp rất khắt khe (mã gốc lệch 1 dòng là fail), mà Vercel giữ
// lại node_modules giữa các lần build. Sửa nội dung bản vá xong thì cache còn mang bản vá CŨ,
// patch-package không áp chồng được → "Failed to apply patch" → npm install exit 1 → deploy chết,
// dù chẳng liên quan gì tới bản web. Đã xảy ra thật ngày 11/09/2026.
import { spawnSync } from 'node:child_process'

if (process.env.VERCEL) {
    console.log('postinstall: bỏ qua patch-package trên Vercel (bản vá chỉ dành cho APK Android)')
    process.exit(0)
}

const { status } = spawnSync('patch-package', [], { stdio: 'inherit', shell: true })
process.exit(status ?? 1)
