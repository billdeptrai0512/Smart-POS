type Named = { id: string; is_batch?: boolean | null }

// Back / sau khi xoá ở trang chi tiết công thức: về đúng loại đang xem của danh sách Công thức (món · topping · thành phẩm).
export function recipeBackUrl(id: string, products: Named[], batchProducts: Named[], toppings: { id: string }[]) {
    const product = products.find(p => p.id === id) ?? batchProducts.find(p => p.id === id)
    const kind = product ? (product.is_batch ? '?kind=batch' : '') : toppings.some(t => t.id === id) ? '?kind=topping' : ''
    return '/category/recipes' + kind
}
