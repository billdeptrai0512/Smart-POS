import { fireAndForget } from './rpcFireAndForget'

export function trackPwaShown(platform) {
    fireAndForget('track_pwa_shown', { p_platform: platform }, 'pwa')
}

// Gọi khi phát hiện app đang chạy standalone (đã cài) — đúng cho cả iOS lẫn Android,
// xem ghi chú trong migration.
export function trackPwaInstalled(platform) {
    fireAndForget('track_pwa_installed', { p_platform: platform }, 'pwa')
}
