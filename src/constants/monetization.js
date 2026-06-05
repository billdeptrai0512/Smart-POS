// ─── Monetization — module metadata & pricing ────────────────────────────────
// Single source of truth cho UI gate/upsell. Khớp docs/MONETIZATION.md §1.
// Giá trị `tier` trong DB = key của MODULE_META (cashflow/inventory/finance).

import { TrendingUp, Package, Wallet } from 'lucide-react'

/** Thứ tự hiển thị + key module (khớp ReportViewFilter + cột address_subscriptions.tier). */
export const MODULE_KEYS = ['cashflow', 'inventory', 'finance']

/**
 * Meta cho từng module: nhãn, mô tả ngắn (1 câu giá trị), icon, và danh sách
 * tính năng hiển thị trong gate/sheet.
 */
export const MODULE_META = {
    cashflow: {
        key: 'cashflow',
        label: 'Dòng tiền',
        icon: Wallet,
        tagline: 'Theo dõi thực thu, chi tiền mặt & chuyển khoản mỗi ngày.',
        features: [
            'Đối soát tiền mặt / chuyển khoản',
            'Chi tiêu trong ngày & theo kỳ',
            'Số ly bán + biểu đồ doanh thu',
        ],
    },
    inventory: {
        key: 'inventory',
        label: 'Tồn kho',
        icon: Package,
        tagline: 'Quản lý nhập – tồn, soi hao hụt và gợi ý đi chợ.',
        features: [
            'Nhập / tồn / sử dụng nguyên liệu',
            'Kiểm kê hao hụt theo ngày & kỳ',
            'Gợi ý bổ sung (đi chợ) tự động',
        ],
    },
    finance: {
        key: 'finance',
        label: 'Báo cáo',
        icon: TrendingUp,
        tagline: 'Lãi lỗ, doanh thu, giá vốn — bức tranh tài chính đầy đủ.',
        features: [
            'Lợi nhuận ròng & biên lãi',
            'Doanh thu, giá vốn (COGS), chi phí',
            'So sánh hiệu suất theo ngày',
        ],
    },
}

/**
 * Bảng giá (đơn vị đồng). Xem MONETIZATION.md §1.
 *   - module: 1 module / 1 chi nhánh
 *   - bundle: cả 3 module / 1 chi nhánh (có chiết khấu)
 *   - all-branches: nhân theo số chi nhánh (tính ở runtime)
 */
export const PRICE = {
    module: { month: 88888, year: 888888 },
    bundle: { month: 222888, year: 2222888 },
}

/** Số ngày trial mặc định (khớp trigger grant_trial_on_address_creation). */
export const TRIAL_DAYS = 3

/** Nhãn chu kỳ hiển thị. */
export const PERIOD_LABEL = { month: 'tháng', year: 'năm' }

/** Số tháng tương ứng cho INSERT subscription. */
export const PERIOD_MONTHS = { month: 1, year: 12 }
