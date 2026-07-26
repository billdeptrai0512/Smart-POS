import ChecklistRow from '../ChecklistRow'

function items(ctx) {
    const { totalMain, stockProgress } = ctx
    return totalMain > 0 ? [
        { key: 'mainWarehouse', label: `Nhập tồn kho ${stockProgress.mainWarehouse}/${totalMain}`, done: stockProgress.mainWarehouse >= totalMain },
        { key: 'mainCounter', label: `Nhập tồn quầy ${stockProgress.mainCounter}/${totalMain}`, done: stockProgress.mainCounter >= totalMain },
    ] : []
}

export default {
    to: '/ingredients',
    state: { viewMode: 'main' },
    navLabel: 'Đi tới nguyên liệu',
    name: 'Tồn kho nguyên liệu',
    done: (ctx) => items(ctx).every(item => item.done),
    Body: ({ ctx }) => (
        <>
            {items(ctx).map(item => <ChecklistRow key={item.key} label={item.label} done={item.done} />)}
        </>
    ),
}
