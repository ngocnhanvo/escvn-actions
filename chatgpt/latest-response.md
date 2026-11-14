# ESC.VN — Latest ChatGPT response

- Time (Asia/Ho_Chi_Minh): 2026-11-14, 08:38:35
- Project: ESC.VN — Hộ Kinh Doanh Google Maps
- Repository: ngocnhanvo/escvn-actions
- Branch: main
- State: PARTIAL
- Astro source: a376ccf6191a4635db43b8325edcc914d562cd6e
- PHP source: 5615ad65c2a8c15bdfd2c6721ccae29f1dbd1b90
- Backend deploy+QA: SUCCESS #43541184996
- Astro deploy: SUCCESS #43541293377
- Post-deploy smoke: SUCCESS #43541497430
- HKD browser QA: SUCCESS #43541578026 (Goong fallback; not Google live)
- Pending: Google Cloud billing, Maps JS browser key, Map ID, Google browser QA

---

## Chuyển Google Maps cho Hộ kinh doanh ESC.VN

Tôi đã xác định được các thành phần cần thay đổi trong mã nguồn hiện tại:

- **Bản đồ chính:** Thay Goong Maps JS bằng Google Maps JavaScript API, giữ nguyên giao diện, bộ lọc, ghim ngành nghề và chức năng xem chi tiết.
- **Biểu mẫu đăng ký/cập nhật:** Chuyển bản đồ chọn tọa độ sang Google Maps, hỗ trợ nhấp chọn và kéo ghim.
- **WordPress:** Thay cấu hình Goong Maptiles bằng Google Maps API Key.
- **Dữ liệu:** Giữ nguyên MySQL và REST API, chỉ đưa các hộ kinh doanh có trong dữ liệu đã công khai lên bản đồ.

Không cần di chuyển hay tạo lại dữ liệu hộ kinh doanh để thay nhà cung cấp bản đồ.

## Kết quả triển khai bước đầu

**Backend WordPress đã triển khai và kiểm thử thành công** qua [GitHub Actions #43541184996](https://github.com/ngocnhanvo/escvn-actions/actions/runs/43541184996).

- Commit PHP: `5615ad65`
- Commit Astro: `a376ccf6`
- Đã bổ sung cấu hình Google Maps trong WordPress và giữ lại khóa Goong để dự phòng.
- Đã cập nhật bài kiểm thử để nhận diện cả Google Maps và Goong.

Bản build production của Astro đã được kích hoạt qua workflow hiện có. Việc chuyển hẳn sang Google vẫn phụ thuộc API Key và Map ID hợp lệ trong Google Cloud.

**Triển khai đã PASS:** Astro production [#43541293377](https://github.com/ngocnhanvo/escvn-actions/actions/runs/43541293377) build/deploy đúng source `a376ccf6`; smoke test [#43541497430](https://github.com/ngocnhanvo/escvn-actions/actions/runs/43541497430) PASS; kiểm thử HKD desktop/mobile [#43541578026](https://github.com/ngocnhanvo/escvn-actions/actions/runs/43541578026) PASS (bản đồ, bộ lọc, nhấp chọn và xóa tọa độ, nhập tay, kiểm tra form; không gửi hồ sơ giả).

**Chưa hoàn tất chuyển sang Google Maps thực tế:** WordPress REST `map-config` vẫn báo `provider=goong` vì chưa có Google Maps browser API Key và Map ID. Google SDK/Advanced Markers đã tích hợp nhưng chưa thể kiểm thử với Google thực khi thiếu cấu hình.

**Việc cần làm:** Google Cloud bật Billing và Maps JavaScript API, tạo HTTP-referrer-restricted browser key (esc.vn) và Map ID. Cấu hình Cloud Map Style ẩn POI thương mại để bản đồ chỉ hiển thị ghim HKD đã duyệt; nhập hai giá trị qua [WordPress → Hộ kinh doanh → Bản đồ HKD](https://admin.esc.vn/wp-admin/admin.php?page=esc-hkd-goong). Sau đó hệ thống tự chọn Google Maps và cần chạy QA Google thực tế.

Chế độ code: auto-build
Cổng ghi source: bypass
Trạng thái: PARTIAL — chưa hoàn tất
