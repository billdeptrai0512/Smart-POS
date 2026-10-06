import { useCallback } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'

// Tab của trang nằm trên URL (/history/sales, /report/cashflow, /inventory/stocking, /category/recipes…):
// đọc từ param :tab, đổi tab = thay URL (replace, giữ query ngày + state điều hướng). Danh sách tab hợp lệ
// do TabGuard ở App.jsx kiểm — tab lạ bị đẩy về tab đầu trước khi trang render.
export function useTabRoute(base) {
    const { tab } = useParams()
    const navigate = useNavigate()
    const { search, state } = useLocation()
    const setTab = useCallback(
        (key) => navigate({ pathname: `${base}/${key}`, search }, { replace: true, state }),
        [navigate, base, search, state],
    )
    return [tab, setTab]
}
