// Barrel for shared utilities — keeps `from '../utils'` imports working.
// Add new helpers to a dedicated file and re-export them here.

export { formatVND, formatVNDInput, parseVNDInput, computeDiscount, discountToPercent, cartLineSubtotal, NO_DISCOUNT } from './money'
export { capitalizeWords, capFirst } from './text'
export { calculateItemCost } from './inventory'
