import { useEffect } from 'react'
import { usePOS } from '../contexts/POSContext'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate, useLocation } from 'react-router-dom'

import HistoryView from '../components/HistoryPage/HistoryView'

export default function HistoryPage() {
    const navigate = useNavigate()
    const location = useLocation()
    const backTo = location.state?.from || '/pos'
    const { products, recipes, ingredientCosts, extraIngredients } = useProducts()
    const { todayOrders, todayExpenses, isLoadingHistory, handleDeleteOrder, handleAddExpense, handleDeleteExpense, handleLoadHistory, retrySync, fixedCosts, handleAddFixedCost, handleUpdateFixedCost, handleDeleteFixedCost } = usePOS()
    const { isManager, isAdmin } = useAuth()

    useEffect(() => {
        if (todayOrders.length === 0 && !isLoadingHistory) {
            handleLoadHistory()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    return (
        <HistoryView
            todayOrders={todayOrders}
            todayExpenses={todayExpenses || []}
            recipes={recipes}
            products={products}
            ingredientCosts={ingredientCosts}
            extraIngredients={extraIngredients}
            isLoadingHistory={isLoadingHistory}
            onBack={() => navigate(backTo)}
            onDeleteOrder={handleDeleteOrder}
            onAddExpense={handleAddExpense}
            onDeleteExpense={handleDeleteExpense}
            onRetrySync={retrySync}
            fixedCosts={fixedCosts}
            handleAddFixedCost={handleAddFixedCost}
            handleUpdateFixedCost={handleUpdateFixedCost}
            handleDeleteFixedCost={handleDeleteFixedCost}
            isManager={isManager || isAdmin}
        />
    )
}
