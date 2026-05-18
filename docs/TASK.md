[] bug khi mà tạo mới ingredient ở default address cũng đồng thời tạo mới ingredient trong mấy cái address đang hoạt động luôn - và ở những cái address đang hoạt động thì không có xóa mấy ingredient mới được tạo được.

[] fix bug giá vốn hôm nay có địa chỉ 16 Dương Bá Trạc, giá cà phê bị ghi nhầm thành 217.000đ /g . lẽ ra nên là 250đ/g

[] nếu tồn kho của mỗi ingredient, được hiển thị theo quy cách => 5350g cà phê = 5 bịch + 350g cà phê, vậy nó nên được đồng bộ với nhập thêm như thế nào ? 
Timing nào của nhân viên để thêm chi tiết nhập thêm ? 
Nhập thêm có nên được đồng bộ với quy cách ?
Chốt lại : Báo cáo kho = Báo cáo quầy / Tồn kho tổng
=> Tồn cuối của quầy + Tồn kho tổng - Nhập thêm = Tồn kho mới
Liệu có nên hiển thi số tồn kho tổng trước và sau khi rút nhập thêm ?

=> Chốt lại rằng ở /shift-closing => chúng ta phải có đủ context để nhìn vào hiểu được rằng 
tồn kho tổng là bao nhiêu ?
tồn quầy đầu ngày là bao nhiêu ? 
rút ra nhập thêm vô quầy là bao nhiêu ? ( điều kiện phải nhỏ hơn tồn kho tổng ) 
tồn cuối ngày là bao nhiêu 

- edge case : nếu như manager nhập kho tổng giữa ca -> thì tồn kho tổng trong /shift-closing phải tự đồng bộ để monitor

tồn kho tổng ở ingredient phải đủ context để manager hiểu rằng ngày hôm nay , tồn đầu kho tổng là bao nhiêu 
rút ra bao nhiêu 
tồn kho tổng cuối ngày còn bao nhiêu