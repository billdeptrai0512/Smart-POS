import { useEffect, useRef } from 'react'
import { useProducts } from '../contexts/ProductContext'

// Công thức mới nhất cho withCounterEstimate qua ref (không đưa vào deps của loader tồn kho: refreshProducts đổi
// identity recipes sẽ kéo theo tải lại cả danh sách). canPersist = context đã tải xong, mới được ghi số đóng băng.
export function useCounterCalc() {
    const { recipes, extraIngredients, loading } = useProducts()
    const calc = { recipes, extraIngredients, canPersist: !loading }
    const ref = useRef(calc)
    useEffect(() => { ref.current = calc })
    return ref
}
