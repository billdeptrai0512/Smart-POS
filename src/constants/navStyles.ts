// Nút icon vuông 40px trên thanh nav (TopNav POS, posShell, header /addresses).
export const NAV_ICON_BTN = 'relative shrink-0 w-10 h-10 flex items-center justify-center rounded-[14px] bg-bg border border-border/60 text-text-secondary active:bg-border/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'

// Nền + màu chữ của vòng tròn icon theo tone (ActionPill, menu điều hướng).
export const PILL_TONES: Record<string, string> = {
    primary: 'bg-primary/10 text-primary',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    info: 'bg-info/10 text-info',
    neutral: 'bg-text-secondary/15 text-text-secondary', // cấu hình / danh mục: trầm, không tranh chú ý
    solid: 'bg-primary text-white [&_svg]:[stroke-width:2.5]', // hành động chính (Bán hàng): đặc, nổi nhất danh sách
}
