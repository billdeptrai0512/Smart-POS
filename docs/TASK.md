[x] Nhật ký của nguyên vật liệu nên bao gồm cả card rút từ kho ra quầy. Định nghĩa ở card hao hụt là nhập thêm cho bạn dễ hình dung và phân loại

[x] Làm gọn báo cáo dòng tiền ở mục mua nguyên liệu / bao bì . Phân loại và có tổng cộng

[x] Xoá nhãn chi phí ĐANG CÓ chi phí gắn vào → BUỘC phân loại lại, không đổ mặc định về "Chi phí khác"
   Bối cảnh: hiện xoá nhãn = soft-delete, mọi chi phí của nhãn đó tự dồn về "Chi phí khác" (Vận hành)
   trong báo cáo Lợi nhuận → dễ làm sai cơ cấu chi phí. Muốn manager BẮT BUỘC tự tay chuyển từng chi phí
   sang nhãn khác đang có trước khi nhãn biến mất, để báo cáo chính xác.
   - Khi bấm Xoá một nhãn mà nhãn đó còn chi phí gắn (đếm > 0): KHÔNG xoá ngay.
   - Hiện flow chọn nhãn đích để CHUYỂN HÀNG LOẠT các chi phí đó sang (picker các nhãn đang có,
     có thể cho phép chuyển tất cả về 1 nhãn, hoặc tối thiểu chặn xoá tới khi không còn chi phí orphan).
   - Nhãn không còn chi phí gắn (đếm = 0) thì xoá bình thường như hiện tại.
   - Mục tiêu: không còn chi phí "Nhãn đã xoá" / dồn nhầm "Chi phí khác" làm méo báo cáo Lợi nhuận.
