import ChecklistRow from '../ChecklistRow'

// Từng có packagingStockStep.jsx song song (checklist giống hệt, khác field prefix) đi qua
// 1 factory dùng chung — đã gộp lại thành 1 lượt quét ingredientConfigs, nên giờ chỉ còn
// đúng bước này; inline thẳng thay vì giữ factory cho 1 caller duy nhất.
export default {
    name: 'Tồn kho nguyên liệu',
    done: (ctx) => {
        const { totalAll, allWarehouse, allCounter } = ctx.stockProgress
        return totalAll <= 0 || (allWarehouse >= totalAll && allCounter >= totalAll)
    },
    Body: ({ ctx }) => {
        const { totalAll, allWarehouse, allCounter } = ctx.stockProgress
        return totalAll > 0 && (
            <>
                <ChecklistRow label={`Nhập tồn kho ${allWarehouse}/${totalAll}`} done={allWarehouse >= totalAll} />
                <ChecklistRow label={`Nhập tồn quầy ${allCounter}/${totalAll}`} done={allCounter >= totalAll} />
            </>
        )
    },
}
