import { DISCOUNT_TYPE_LABELS } from '../../constants/discountTypes'

// Hàng nút chọn 1 trong N — mặc định là 3 kiểu chương trình giảm giá (form tạo ở
// DiscountProgramsPage + form sửa ở DiscountProgramDetailPage); truyền `labels` để dùng cho
// lựa chọn khác (VD: loại bàn áp dụng).
interface Props { value: string; onChange: (value: string) => void; disabled?: boolean; labels?: Record<string, string> }

export default function DiscountTypePicker({ value, onChange, disabled, labels = DISCOUNT_TYPE_LABELS }: Props) {
    return (
        <div className="flex gap-2">
            {Object.entries(labels).map(([t, label]) => (
                <button
                    key={t}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(t)}
                    className={`flex-1 py-2 rounded-[12px] border font-bold text-[12px] transition-colors disabled:opacity-60 ${value === t ? 'bg-primary/10 border-primary/50 text-primary' : 'bg-bg border-border/60 text-text-secondary hover:text-text'}`}
                >
                    {label}
                </button>
            ))}
        </div>
    )
}
