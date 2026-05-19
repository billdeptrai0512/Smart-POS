[x] bên trong recieps, khi bấm vào món -> nhảy qua /recieps/:productID thì khi go back lại /recipes tôi không muốn scroll lại từ đầu.
[x] cập nhật báo cáo nên tùy vào chốt tồn kho hay thực thu để direct tới tồn kho hoặc dòng tiền

## Bugs cần xử lý (audit phiên 2026-05-19)


[x] Nút "Xác nhận" chốt ca không chặn submit khi có warning `restockOverflow`. Cảnh báo "Vượt kho tổng" chỉ hiển thị chữ đỏ, vẫn cho lưu → `warehouse_stock` bị `GREATEST(0,...)` clamp về 0 → bug tồn đầu âm trên block daily context của `/ingredients`. Cần block submit hoặc confirm dialog.

[x] Auto-inject fixed costs trong `handleSubmit` chốt ca có race: 2 staff cùng chốt ca lần đầu → cả hai đều thấy `alreadyInjected=false` → fixed costs bị insert nhân đôi cho ngày đó. Khả năng thấp nhưng tồn tại.

[x] `existingClosing` state không refresh sau `updateShiftClosing`. Bình thường navigate đi `/daily-report` nên không ảnh hưởng. Nhưng nếu paywall hiện ra (`hasFeature(reports)=false`) thì ở lại page với snapshot cũ — edit tiếp sẽ tính `effectiveWarehouseStocks` sai.

[x] Nút Check trên ShiftClosingHeader có `disabled={isDisabled}` nhưng className không có `disabled:opacity-50` — staff bấm không phản ứng, không biết tại sao.

[x] Không có confirm dialog trước khi submit chốt ca. Bấm nhầm = chốt luôn.

[x] Flag `shift_finalized_{addrId}_{today}` chỉ được set qua button "Xác nhận chốt ca" trên `/daily-report` (InventoryRefillCard). Save qua `/shift-closing` **không** set flag → expense thêm sau đó bị gán nhãn "Trong ca" thay vì "Sau ca" (vẫn là Vận hành, nhưng sub-label sai).

