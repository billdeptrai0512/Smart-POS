import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { fetchTodayOrderHeads, fetchOrdersByIds } from '../services/orderService'

// Đồng bộ đơn giữa các máy cùng một địa chỉ (máy ghi món ngoài sân + máy pha trong quầy).
//
// Thay cho kênh realtime `orders-realtime-${addressId}` cũ. Lý do đổi, gọn lại:
//   1. Kênh đó khoá sau cổng countActiveSessions >= 2, mà active_sessions lưu MỘT dòng
//      cho mỗi user_id — hai máy đăng nhập cùng tài khoản đếm ra 1, cổng không bao giờ mở.
//   2. Mỗi sự kiện realtime kéo theo refetch cả ngày kèm join order_items trên MỌI máy;
//      đơn thứ 300 trong ngày kéo 300 dòng về từng máy một.
//   3. Trần ~500 kết nối đồng thời của Supabase Realtime không cõng nổi 1000 quán × 2 máy.
// Xem docs/MONETIZATION.md §7.1 — cùng lập luận đã dùng để bỏ realtime khỏi payment.
//
// Đánh đổi đã biết: trễ tối đa một nhịp poll thay vì ~200ms. Bù lại bằng cú poll ngay khi
// tab hiện lại — thao tác "mở app lên xem" thấy dữ liệu mới tức thì, không phải chờ nhịp.
const FAST_MS = 5000
// Quán vắng thì giãn nhịp. Mốc tính từ lần CUỐI thấy có thay đổi, không phải từ lần poll
// cuối: đang có đơn liên tục là giữ nhịp nhanh.
const IDLE_AFTER_MS = 2 * 60 * 1000
const SLOW_MS = 15000
// Rời app lâu hơn mốc này thì lúc quay lại kéo thêm mấy thứ KHÔNG nằm trong poll (chi phí,
// tổng tiền). Chuyển app qua lại vài giây thì thôi, đừng dồn đọc lên đường mạng yếu.
const RESUME_CATCHUP_MS = 30000
// Sàn tần suất, áp cho MỌI đường gọi tick. Hai nguồn gọi ngoài nhịp đều đo được thật:
// hệ điều hành bắn hidden→visible thành chùm (7 sự kiện/20 giây, có cặp cách nhau 13ms),
// và effect này bị dựng lại liên tục lúc khởi động — mỗi lần dựng là một cú poll ngay.
// Không có sàn thì nhịp tụt từ 5s xuống dưới 1s. Đặt dưới FAST_MS nên nhịp thường không
// bị đụng tới, mà "mở app lên thấy liền" vẫn còn (vắng vài giây trở lên là qua sàn).
const MIN_GAP_MS = 3000
// Nhiều hơn ngần này "đơn mới" trong một nhịp thì không phải quán vừa bận: là mốc đã cũ
// (mới mở màn, vừa ở màn khác về, vừa hết quãng mất mạng). Hydrate từng id qua
// id=in.(...) lúc đó là dựng một URL vài KB — gateway trả 414 và cả vòng đồng bộ chết.
// Nạp đầy một lượt (onResume) vừa ngắn hơn vừa không có trần độ dài.
const MAX_HYDRATE = 25

// So bản đang giữ trong máy với danh sách "đầu đơn" vừa lấy từ DB.
//   newIds       = đơn máy khác vừa tạo (mình chưa có id này)
//   patched      = đơn đã có nhưng lệch: tiền, bị xoá, ra món, hoặc bàn đã tính tiền
//   moneyChanged = trong đám trên có thứ động tới TIỀN
//   tableChanged = trong đám trên có thứ động tới LƯỚI BÀN
//
// Hai cờ tách riêng vì hai loại thay đổi tốn khác nhau hẳn: lật cờ "Ra món" chỉ cần lưới
// bàn vẽ lại, còn sửa chiết khấu một đơn mang đi thì lưới bàn không đổi gì. Kéo cả hai
// trên mọi máy cho mỗi thay đổi là đúng cái lãng phí đã cắt khỏi handler realtime cũ.
// (fetchOpenTables join order_items + products cho từng bàn — không rẻ.)
//
// Cờ bàn so bằng có/không chứ không so mốc giờ: chỉ cần biết đã ra món / đã tính tiền chưa.
// Hàng lạc quan (doSubmit) thiếu hẳn hai cột này — undefined và null đều "không", nên nó
// không bị báo lệch oan mỗi nhịp poll.
//
// Hàng lạc quan của chính máy mình cũng được soi ở đây, và đó là chủ đích: nó mang total do
// client tính, còn bulk_create_orders tính lại giá ở server. Lệch thì rơi vào patched và
// được sửa về đúng số của server — trước đây con số sai nằm im tới lần mở lại trang.
// knownIds: id vòng poll đã thấy ở nhịp trước. null = nhịp ĐẦU (chưa có mốc) → không coi
// đơn nào là mới, chỉ lấy danh sách này làm mốc.
//
// Không có mốc đó thì màn /pos hỏng: nó KHÔNG gọi handleLoadHistory (chỉ /history gọi),
// nên localOrders rỗng và nhịp đầu đọc thành "cả ngày đều là đơn mới" → một request
// id=in.(...) ôm mọi đơn trong ngày. 200 đơn là URL ~7.4KB, gateway trả 414, tick hỏng,
// thẻ Nhật ký thôi cập nhật — hỏng nặng dần về cuối ngày, đúng lúc quán đông nhất.
// Kiểm cả localOrders lẫn knownIds: đơn /history vừa nạp thì nằm ở cái đầu, đơn máy này
// vừa chốt (hàng lạc quan) cũng vậy, cả hai đều không phải "đơn mới từ máy khác".
export function diffOrderHeads(localOrders, heads, knownIds = null) {
    const byId = new Map(localOrders.map(o => [o.id, o]))
    const newIds = []
    const patched = []
    let moneyChanged = false
    let tableChanged = false
    for (const head of heads) {
        const local = byId.get(head.id)
        if (!local) {
            if (knownIds && !knownIds.has(head.id)) {
                newIds.push(head.id)
                moneyChanged = true
                // table_name có trong heads chỉ để trả lời đúng câu này: đơn mang đi của
                // máy khác không đụng gì tới lưới bàn.
                if (head.table_name) tableChanged = true
            }
            continue
        }
        const money = local.total !== head.total
            || (local.discount_amount || 0) !== (head.discount_amount || 0)
            || !local.deleted_at !== !head.deleted_at
        const table = !local.served_at !== !head.served_at
            || !local.table_closed_at !== !head.table_closed_at
        if (money) moneyChanged = true
        // Xoá mềm một đơn của bàn đang mở cũng đổi tổng bàn, nên cờ bàn ăn theo cả `money`
        // khi đơn đó có bàn.
        if (table || (money && head.table_name)) tableChanged = true
        // Vá cả loại chỉ-đổi-cờ-bàn: không ghi lại vào bản local thì nhịp sau vẫn thấy lệch
        // và gọi refreshTables mãi mãi.
        if (money || table) patched.push(head)
    }
    return { newIds, patched, moneyChanged, tableChanged }
}

// localOrdersRef: bản đọc-đồng-bộ của todayOrders (POSContext.todayOrdersRef). Phải là ref —
// vòng poll sống trong effect, đọc state trực tiếp là đọc mãi bản của lần mount đầu.
export function useOrdersPoll({ addressId, isGuest, localOrdersRef, onChange, onResume }) {
    const { pathname } = useLocation()
    const active = !!addressId && !isGuest
    // Hai màn này là chỗ DUY NHẤT hiển thị đơn trong ngày. Cổng theo màn hình: không tốn
    // query nào để tính và không bao giờ trả lời sai — khác hẳn cổng đếm phiên nó thay thế.
    // Chỉ chặn VÒNG POLL; onResume vẫn chạy ở mọi màn, vì mấy thứ nó kéo về (chi phí,
    // tổng ngày) là của trang Báo cáo — trước đây nằm trong effect realtime không gác màn.
    const polling = active && (pathname === '/pos' || pathname === '/history')

    // Callback dựng inline ở POSContext nên đổi định danh mỗi render; đi qua ref để vòng
    // poll không bị dựng lại (và mất nhịp) sau mỗi lần gõ phím.
    const onChangeRef = useRef(onChange)
    onChangeRef.current = onChange
    const onResumeRef = useRef(onResume)
    onResumeRef.current = onResume

    // Mốc id vòng poll đã thấy — xem diffOrderHeads. null = chưa có mốc; nhịp đầu chỉ dựng
    // mốc chứ không tuyên bố đơn nào là mới.
    //
    // Ref chứ không phải biến trong effect: effect dựng lại mỗi lần rời/quay lại /pos (và
    // vài lần lúc khởi động, trong lúc auth/địa chỉ còn đang ổn định). Để mốc chết theo
    // effect thì đơn máy khác tạo đúng quãng đó bị nuốt thẳng vào mốc mới mà không ai
    // hydrate — thẻ Nhật ký đứng im cho tới lần tải lại trang.
    const knownIdsRef = useRef(null)
    // Cùng lý do: sàn tần suất phải là sàn thật, không phải sàn của riêng một lần effect.
    const lastPollRef = useRef(0)

    // Đổi chi nhánh = tập đơn khác hẳn, mốc cũ vô nghĩa.
    const addressRef = useRef(addressId)
    if (addressRef.current !== addressId) {
        addressRef.current = addressId
        knownIdsRef.current = null
    }

    useEffect(() => {
        if (!active) return

        let timer = null
        let inFlight = false
        let lastChangeAt = Date.now()
        let hiddenAt = 0
        // clearTimeout lúc dọn dẹp KHÔNG đủ: một tick đang chờ mạng sẽ chạy tiếp tới
        // schedule() sau khi effect đã tháo, hẹn một timer mồ côi rồi tự nuôi mình mãi mãi.
        // Rời khỏi /pos vài lần là có vài vòng poll chạy ngầm cho một màn không ai xem.
        let stopped = false

        const tick = async () => {
            // Mạng 3G chậm hơn một nhịp poll: bỏ tick này thay vì dồn hàng đợi.
            if (stopped || inFlight || document.visibilityState !== 'visible') return
            if (Date.now() - lastPollRef.current < MIN_GAP_MS) return
            inFlight = true
            lastPollRef.current = Date.now()
            try {
                const heads = await fetchTodayOrderHeads(addressId)
                const { newIds, patched, moneyChanged, tableChanged } = diffOrderHeads(localOrdersRef.current, heads, knownIdsRef.current)
                // Dựng mốc TRƯỚC khi thoát sớm: nhịp sau phải biết đám này không còn mới.
                knownIdsRef.current = new Set(heads.map(h => h.id))
                if (!newIds.length && !patched.length) return
                lastChangeAt = Date.now()
                if (newIds.length > MAX_HYDRATE) {
                    if (!stopped) onResumeRef.current?.()
                    return
                }
                const newOrders = newIds.length ? await fetchOrdersByIds(newIds) : []
                // Đổi màn trong lúc chờ mạng → đừng setState vào một provider đã tháo.
                if (!stopped) onChangeRef.current({ newOrders, patched, moneyChanged, tableChanged })
            } catch (err) {
                // Rớt mạng giữa ca là chuyện thường — lần poll sau tự bắt kịp vì mỗi lượt
                // đều quét lại cả ngày. Không toast: người dùng không làm gì được, và cái
                // họ đang bấm không hỏng.
                console.error('useOrdersPoll:', err)
            } finally {
                inFlight = false
            }
        }

        const schedule = () => {
            clearTimeout(timer)
            // Tab ẩn: đừng hẹn tiếp. Tick có tự bỏ qua lúc ẩn, nhưng vẫn hẹn lại thì thành
            // một chuỗi timer quay không tải trên máy đang khoá màn. handleVisibility khởi
            // động lại khi quay về.
            if (stopped || !polling || document.visibilityState !== 'visible') return
            timer = setTimeout(run, Date.now() - lastChangeAt > IDLE_AFTER_MS ? SLOW_MS : FAST_MS)
        }
        // clearTimeout ở đầu: một timer cũ có thể nổ trong lúc tick còn đang chờ mạng.
        // Dọn trước rồi mới hẹn lại → luôn đúng một timer đang chạy.
        async function run() {
            clearTimeout(timer)
            await tick()
            schedule()
        }

        const handleVisibility = () => {
            if (document.visibilityState !== 'visible') {
                hiddenAt = Date.now()
                clearTimeout(timer)
                return
            }
            // Trình duyệt/webview bắn 'visible' cả khi CHƯA từng 'hidden' (đo được vài cú
            // ngay sau khi tải trang). Không có mốc ẩn thì đây không phải "quay lại app":
            // xử lý nó là vừa nạp lại nguyên trang dữ liệu vừa đá nhịp poll loạn lên.
            if (!hiddenAt) return
            const away = Date.now() - hiddenAt
            hiddenAt = 0
            if (away > RESUME_CATCHUP_MS) {
                // Vắng lâu thì nạp đầy một lượt rẻ hơn hydrate từng đơn đã lỡ. Bỏ mốc để
                // nhịp tới dựng lại từ đầu (MAX_HYDRATE ở tick cũng bắt được ca này, đây
                // là đường ngắn hơn cho ca đã biết chắc).
                knownIdsRef.current = null
                onResumeRef.current?.()
            }
            // Quay lại app = có người đang nhìn: kéo nhịp về nhanh rồi poll ngay.
            lastChangeAt = Date.now()
            if (polling) run()
        }

        if (polling) run()
        document.addEventListener('visibilitychange', handleVisibility)
        return () => {
            stopped = true
            clearTimeout(timer)
            document.removeEventListener('visibilitychange', handleVisibility)
        }
    }, [active, polling, addressId, localOrdersRef])
}
