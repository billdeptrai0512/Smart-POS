// Ingredients split by domain — kept as re-exports here so existing call sites
// (`from '../services/ingredientService'` or the orderService barrel) keep working:
//   - recipeService            (recipes)
//   - ingredientCostService    (ingredient_costs CRUD)
//   - ingredientStockService   (warehouse/counter stock reads)
//   - restockService           (restock/adjustment mutations)
export * from './recipeService'
export * from './ingredientCostService'
export * from './ingredientStockService'
export * from './restockService'
