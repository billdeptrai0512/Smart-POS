import { useState, useEffect, useCallback, useRef, type Dispatch, type SetStateAction } from 'react'
import { fetchOpenTables, closeTable, reopenTable, markOrder, dropTableByName, restoreTable, moveRoundsIntoTable, moveTableRounds as moveTableRoundsService, type OpenTable, type TableRound } from '../services/orderService'
import { isNetworkError } from '../services/cartOps'
import { addPendingTableClose, removePendingTableClose } from './useOfflineSync'
import type { UUID } from '../types/domain'

// Bàn đang mở của địa chỉ hiện tại (lưới bàn + tổng tiền bàn ở CheckoutBar): state, tải lại, ra món/tính tiền, dọn bàn, gộp/tách đợt.
// Tách khỏi POSContext để mảnh này có "đã tải xong" riêng và đọc được một mình. setOpenTables vẫn trả ra: doSubmit / xoá đơn / sửa đợt
// ở POSContext áp lạc quan thẳng vào lưới. markTablesStale = lần vào /pos kế tiếp phải tải lại (poll ở /history chỉ đánh dấu cũ).
interface Deps {
    addressId: UUID | null
    isPosPage: boolean
    setTableName: Dispatch<SetStateAction<string>>
    showToast: (message: string, type?: string, action?: { label: string; onClick: () => void } | null) => void
    showError: (err: unknown, actionLabel: string) => void
}

export function usePosTables({ addressId, isPosPage, setTableName, showToast, showError }: Deps) {
    // Các bàn còn khách, gộp từ DB (fetchOpenTables). Nguồn cho lưới chọn bàn và cho
    // số tổng cộng của bàn ở CheckoutBar.
    const [openTables, setOpenTables] = useState<OpenTable[]>([])
    const [tablesLoaded, setTablesLoaded] = useState(false) // false → lưới bàn hiện giữ chỗ thay vì "Trống" giả
    // Bản sao đọc-đồng-bộ cho refreshTables: fetch hỏng thì trả lại danh sách ĐANG có
    // thay vì rỗng, để người gọi không tưởng là bàn đã hết khách.
    const openTablesRef = useRef<OpenTable[]>([])
    useEffect(() => { openTablesRef.current = openTables }, [openTables])

    // ---- Bàn đang mở ----
    // Gọi lúc mở lưới bàn và sau khi đóng bàn. Không cắm vào realtime: đợt gửi
    // từ chính máy này đã cộng lạc quan ngay bên dưới (doSubmit), còn máy khác thì
    // lần mở lưới kế tiếp là khớp lại — rẻ hơn nhiều so với một kênh nữa.
    // Trả về luôn danh sách vừa lấy: chỗ tính tiền cần con số MỚI NHẤT ngay trong cùng
    // lượt bấm, không đợi state của vòng render sau.
    const refreshTables = useCallback(() => {
        if (!addressId) return Promise.resolve([])
        return fetchOpenTables(addressId)
            .then(list => { setOpenTables(list); setTablesLoaded(true); return list })
            // Lỗi fetch KHÔNG phải là "bàn hết khách" — giữ nguyên lưới đang có. Nuốt
            // lỗi rồi setOpenTables([]) là xoá trắng bàn của khách đang ngồi.
            .catch(err => { console.error('refreshTables:', err); setTablesLoaded(true); return openTablesRef.current })
    }, [addressId])

    // "Đã tải" reset mỗi khi ĐỔI địa chỉ (đứng riêng, không gộp deps vào effect dưới) — quay
    // lại /pos cho CÙNG địa chỉ thì khỏi load lại (poll lo phần cập nhật tiếp theo), nhưng đổi
    // sang địa chỉ khác rồi quay về địa chỉ cũ vẫn phải tải lại (dữ liệu có thể đã đổi lúc vắng).
    const tablesRequestedRef = useRef(false)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- đổi địa chỉ = đánh dấu lưới bàn chưa tải
    useEffect(() => { tablesRequestedRef.current = false; setTablesLoaded(false) }, [addressId])
    useEffect(() => {
        if (!isPosPage || tablesRequestedRef.current) return
        tablesRequestedRef.current = true
        refreshTables()
    }, [isPosPage, refreshTables])

    // Ra món (key 'servedAt') / Tính tiền ('paidAt') của một đợt: lật cờ NGAY trong state rồi
    // mới gọi server, lỗi thì lật lại. Chờ PATCH xong rồi refreshTables (một lượt join
    // order_items, đo được ~1s) là nhân viên bấm xong đứng nhìn nút không đổi màu. Không fetch
    // lại sau khi PATCH thành công: thứ duy nhất đổi là đúng cái cờ vừa lật.
    const toggleMark = useCallback(async (round: TableRound, key: 'servedAt' | 'paidAt') => {
        const [column, label] = key === 'paidAt' ? ['paid_at', 'Tính tiền'] : ['served_at', 'Đánh dấu ra món']
        const next = round[key] ? null : new Date().toISOString()
        const apply = (v: string | null) => setOpenTables(prev => prev.map(t => ({
            ...t,
            rounds: t.rounds.map(r => (r.id === round.id ? { ...r, [key]: v } : r)),
        })))
        apply(next)
        try {
            await markOrder(round.id, { [column]: next })
        } catch (err) {
            apply(round[key])
            showError(err, label)
        }
    }, [showError])

    // Dọn bàn = đóng bàn (khách đã về). Tiền đã vào doanh thu từng đợt nên ở đây không cộng
    // trừ gì. Nhận cả object bàn (không phải mỗi tên) để hoàn tác dựng lại được thẻ mà không
    // cần fetch — quan trọng khi đang mất mạng.
    const handleCloseTable = useCallback(async (table: OpenTable, { printFailed = false }: { printFailed?: boolean } = {}) => {
        const name = table?.name
        if (!addressId || !name) return
        const closedAt = new Date().toISOString()
        const drop = () => {
            setOpenTables(prev => dropTableByName(prev, name))
            setTableName(prev => (prev === name ? '' : prev))
        }
        const restore = () => setOpenTables(prev => restoreTable(prev, table))

        try {
            await closeTable(addressId, name, closedAt)
            drop()
            // printFailed (TableDetailModal.handleBill: in trước, tính tiền sau): toast lỗi
            // in đã bị nuốt (reportError-only, xem handlePrint) để khỏi bị toast "Đã tính
            // tiền" đè mất ngay sau — gộp cả hai ý vào đây thay vì hai toast xếp hàng.
            // Không có hoàn tác thì bấm nhầm là phải vào DB mới cứu được bàn.
            showToast(printFailed ? `Đã dọn ${name} — in lỗi, in lại tay` : `Đã dọn ${name}`, printFailed ? 'warning' : 'success', {
                label: 'Hoàn tác',
                onClick: () => reopenTable(addressId, name, closedAt)
                    .then(() => { restore(); refreshTables(); showToast(`Đã mở lại ${name}`, 'info') })
                    .catch(err => showError(err, 'Mở lại bàn')),
            })
        } catch (err) {
            if (isNetworkError(err)) {
                // Khách đang đứng trả tiền, mất mạng không được phép chặn. Xếp hàng như đơn.
                addPendingTableClose(addressId, name, closedAt)
                drop()
                showToast(`Đã dọn ${name} — chờ mạng để đồng bộ`, 'warning', {
                    label: 'Hoàn tác',
                    onClick: () => { removePendingTableClose(closedAt); restore(); showToast(`Đã mở lại ${name}`, 'info') },
                })
            } else {
                showError(err, 'Dọn bàn')
            }
        }
    }, [addressId, refreshTables, setTableName, showToast, showError])

    // Gộp (chuyển hết đợt của bàn) / tách (chuyển một đợt) đều gọi hàm này — chỉ khác
    // orderIds truyền vào. Áp lạc quan NGAY vào openTables (như handleCloseTable/
    // toggleMark) rồi mới gọi mạng — đợi round-trip xong mới vẽ lại là lý do bấm xong
    // đứng khựng một nhịp mới thấy đợt nhảy bàn. Đợt tự mang nguyên total/lines/orderNo
    // của nó (xem comment orderNo ở TableDetailModal), chỉ đổi NHÓM nó thuộc về, nên dựng
    // lại state từ dữ liệu đang có mà không cần hỏi lại server.
    const moveTableRounds = useCallback(async (orderIds: UUID[], targetTableName: string | null) => {
        const idSet = new Set(orderIds)
        // targetTableName === null là ý định rõ ràng "chuyển thành mang đi" (đích không có
        // tên) — khác với chuỗi rỗng/chưa gõ gì, vẫn phải chặn. "Mang đi" chẳng qua là bàn
        // có name = null trong openTables (xem fetchOpenTables), nên logic dưới đây so sánh
        // t.name === name generic, không cần rẽ nhánh riêng cho null.
        const name = targetTableName === null ? null : targetTableName?.trim()
        if (!addressId || !idSet.size || (name !== null && !name)) return

        const prevTables = openTablesRef.current
        const { nextTables, moved } = moveRoundsIntoTable(prevTables, idSet, name)

        // orderIds không khớp round nào đang có trong state (VD state vừa đổi ở máy khác) —
        // không có gì để áp lạc quan, cứ gọi mạng rồi refreshTables như đường cũ.
        if (!moved.length) {
            try { await moveTableRoundsService(addressId, orderIds, name); await refreshTables() }
            catch (err) { showError(err, 'Chuyển bàn') }
            return
        }

        setOpenTables(nextTables)
        try {
            await moveTableRoundsService(addressId, orderIds, name)
        } catch (err) {
            setOpenTables(prevTables)
            showError(err, 'Chuyển bàn')
        }
    }, [addressId, refreshTables, showError])

    // Lần vào /pos kế tiếp tải lại (ở /history có đổi bàn thì chỉ đánh dấu cũ — lưới bàn chỉ có ở /pos).
    const markTablesStale = () => { tablesRequestedRef.current = false }

    return { openTables, setOpenTables, tablesLoaded, refreshTables, toggleMark, handleCloseTable, moveTableRounds, markTablesStale }
}
