[] /Shift-Closing -> Bỏ tab ghi chú.
[] Gộp tính năng của shift-closing dòng tiền vào thẳng báo cáo dòng tiền luôn -> staff nhập lưu dòng tiền trong trang báo cáo /daily-report luôn.
[] Nút "Cập nhật báo cáo" => "Lưu báo cáo" ở trang /daily-report - tab cashflow

[] Tách InventoryRefillCard (~500 LOC) thành component nhỏ: <AuditTab>, <RefillTab>, hook useInventoryCalculations (gom audit + refill memos). Hiện đang là god component mix audit/refill/fetch/UI.
