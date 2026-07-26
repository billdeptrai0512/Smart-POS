import ChecklistRow from '../ChecklistRow'

// PLACEHOLDER — phase 3 "Báo cáo": chỉ mới đặt tên + checklist tĩnh theo yêu cầu (xem tab
// Dòng tiền/Tồn kho trên /daily-report, ReportViewFilter.jsx). done() luôn false — hint/detect
// logic thật sẽ làm ở phiên sau, guide sẽ dừng ở phase này cho tới lúc đó.
export default {
    name: 'Báo cáo',
    done: () => false,
    Body: () => (
        <>
            <ChecklistRow label="Dòng tiền" done={false} />
            <ChecklistRow label="Tồn kho" done={false} />
        </>
    ),
}
