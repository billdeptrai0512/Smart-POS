// Số ly/doanh thu hôm qua tính đến cùng giờ này → delta %. prev = 0 (chưa migrate RPC /
// hôm qua nghỉ) thì ẩn delta, tránh chia 0.
export const deltaPct = (cur: number, prev: number) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null
