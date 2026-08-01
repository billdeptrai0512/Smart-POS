import ChecklistRow from '../ChecklistRow'

export default {
    to: '/ingredients',
    navLabel: 'Đi tới nguyên liệu',
    name: 'Nguyên liệu',
    done: (ctx) => ctx.stockProgress.coffeeWarehouseSet,
    Body: ({ ctx }) => (
        <ChecklistRow label="Nhập tồn kho cuối ngày cho Cà phê" done={ctx.stockProgress.coffeeWarehouseSet} />
    ),
}
