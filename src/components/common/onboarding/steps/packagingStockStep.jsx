import ChecklistRow from '../ChecklistRow'

function items(ctx) {
    const { totalPackaging, stockProgress } = ctx
    return totalPackaging > 0 ? [
        { key: 'packagingWarehouse', label: `Nhập tồn kho ${stockProgress.packagingWarehouse}/${totalPackaging}`, done: stockProgress.packagingWarehouse >= totalPackaging },
        { key: 'packagingCounter', label: `Nhập tồn quầy ${stockProgress.packagingCounter}/${totalPackaging}`, done: stockProgress.packagingCounter >= totalPackaging },
    ] : []
}

export default {
    to: '/ingredients',
    state: { viewMode: 'packaging' },
    navLabel: 'Đi tới bao bì',
    name: 'Tồn kho bao bì',
    done: (ctx) => items(ctx).every(item => item.done),
    Body: ({ ctx }) => (
        <>
            {items(ctx).map(item => <ChecklistRow key={item.key} label={item.label} done={item.done} />)}
        </>
    ),
}
