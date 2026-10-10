import { useLocation, useNavigate, useParams } from 'react-router-dom'

// Tab của trang nằm trên URL (/history/sales, /report/cashflow, /inventory/stocking, /category/recipes…):
// đọc từ param :tab, đổi tab = thay URL (replace, giữ query ngày + state điều hướng). Danh sách tab hợp lệ
// do TabGuard ở App.tsx kiểm — tab lạ bị đẩy về tab đầu trước khi trang render.
export function useTabRoute(base: string) {
    const { tab } = useParams()
    const navigate = useNavigate()
    const { search, state } = useLocation()
    const setTab = (key: string) => navigate({ pathname: `${base}/${key}`, search }, { replace: true, state })
    return [tab as string, setTab] as const // TabGuard đảm bảo luôn có tab hợp lệ
}
