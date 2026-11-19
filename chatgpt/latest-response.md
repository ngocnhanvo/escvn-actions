# ESC.VN — Latest ChatGPT response

- Time (Asia/Ho_Chi_Minh): 2026-11-19, 19:18:15
- Project: ESC.VN — Member Product ID mapping from boss-provided CSV
- Repository: ngocnhanvo/escvn-actions
- Branch: main
- State: PARTIAL (all safely matched WordPress products are complete; 223 unmatched CSV rows require mapping review)
- Actions code: 0c39181fcc8dc9b33a1c9c8c9eac91050a7397ce
- Exact-identifier/title import: SUCCESS #44516972778
- Uniquely normalized-name import: SUCCESS #44521515816
- Independent WordPress audit: SUCCESS #44503486720 (attempt 6)

---

## Kết quả bổ sung Mã định danh và Member Product ID trên ESC.VN

**Đã nhập thành công dữ liệu ghép được chắc chắn** từ file `products (3).csv` do chủ dự án cung cấp. Không sử dụng `woo_id` từ CSV làm khóa để cập nhật, không suy đoán những sản phẩm chỉ giống tên một phần.

- CSV Member: **596 dòng**.
- WordPress công khai: **554 sản phẩm**.
- **373 mã Member** đã có ánh xạ theo `acf.tld` (trường hiển thị "Mã định danh").
- **375 bản ghi WordPress** tương ứng, do một số sản phẩm có bản tiếng Việt và tiếng Anh.
- **308 sản phẩm** vừa được điền Mã định danh `acf.tld` đúng bằng `product_name` đã trim từ CSV.
- **310 bản ghi** được điền mới ACF `member_product_id` (308 bản ghi vừa điền cả hai trường, hai bản ghi `.vinhlong.vn` và `.org.uk` trước đó có Mã định danh).
- **65 bản ghi** đã đúng và được giữ nguyên. Lỗi/xung đột cả hai đợt: **0**.
- **223 mã Member** chưa tìm được sản phẩm WordPress tương ứng đủ chắc chắn. Chưa tự tạo Product, chưa tự gắn theo tên mơ hồ, chưa ghi đè dữ liệu cũ.

Ví dụ đã kiểm chứng: `.ap.vn` → `225600`, `.bacninh.vn` → `40500`, `GlobalSignAlphaSSL` → `102800`, `DSSUN1` → `120090`. Trong 39 tên bổ sung đợt hai, việc chuẩn hóa chỉ loại dấu phân cách/khoảng trắng, yêu cầu khớp toàn bộ tên chuẩn hóa và chỉ một ứng viên WordPress.

### Bằng chứng

- [Import chính: GitHub Actions #44516972778](https://github.com/ngocnhanvo/escvn-actions/actions/runs/44516972778): 271 UPDATED, 65 UNCHANGED, 0 ERROR, 0 CONFLICT.
- [Import tên chuẩn hóa: GitHub Actions #44521515816](https://github.com/ngocnhanvo/escvn-actions/actions/runs/44521515816): 39 UPDATED, 1 canary UNCHANGED, 0 ERROR, 0 CONFLICT.
- [Kiểm toán đọc lại WordPress #44503486720](https://github.com/ngocnhanvo/escvn-actions/actions/runs/44503486720), attempt 6: 373 EXACT_KEY và 223 UNMATCHED; 380 WordPress records có Mã định danh (bao gồm các record khác không thuộc CSV).

Chưa sửa source frontend Astro hoặc backend PHP trong yêu cầu này, chưa chạy build/deploy Astro. Các ghi ACF đi qua GitHub Actions sử dụng WordPress REST có xác thực, kiểm tra sản phẩm trước ghi và đọc lại sau ghi.

**Còn lại:** rà soát 223 dòng CSV thiếu ánh xạ thật (bao gồm tên khác nhiều, biến thể hoặc sản phẩm chưa tồn tại trên WordPress); chỉ nhập tiếp sau khi có định danh chắc chắn.

Chế độ code: auto-build
Cổng ghi source: source-commit-actions
Trạng thái: PARTIAL — chưa hoàn tất
