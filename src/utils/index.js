// Barrel for shared utilities — keeps `from '../utils'` imports working.
// Add new helpers to a dedicated file and re-export them here.

export { formatVND, formatVNDInput, parseVNDInput, computeDiscount } from './money'
export { capitalizeWords } from './text'
// calculateProductCost is the public name for what inventory.js calls
// calculateItemCost (same signature, same behavior — friendlier domain term).
export { calculateItemCost as calculateProductCost } from './inventory'
