import type { ToppingSource } from '../services/toppingService'

// Danh sách nguyên liệu của topping → cần ghi gì vào nguồn tồn kho.
//   0 dòng: bỏ nguồn (nếu đang có). 1 dòng: mua sẵn, trừ thẳng nguyên liệu đó (lượng/phần; chưa có lượng thì chưa ghi).
//   ≥2 dòng: tự nấu — cần đủ sản lượng mẻ (y) và lượng trừ mỗi phần (s), chưa đủ thì giữ nguyên nguồn cũ.
export type ToppingSyncPlan = { kind: 'none' } | { kind: 'clear' } | { kind: 'direct'; source: ToppingSource } | { kind: 'cook' }

export function toppingSyncPlan(rows: { ingredient: string; amount: number }[], y: number, s: number, hasSource: boolean): ToppingSyncPlan {
    if (rows.length === 0) return hasSource ? { kind: 'clear' } : { kind: 'none' }
    if (rows.length === 1) return rows[0].amount > 0 ? { kind: 'direct', source: { ingredient: rows[0].ingredient, amount: rows[0].amount } } : { kind: 'none' }
    return y > 0 && s > 0 ? { kind: 'cook' } : { kind: 'none' }
}
