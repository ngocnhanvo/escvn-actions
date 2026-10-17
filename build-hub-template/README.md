# ESC Private Build Hub: hai dự án, hai runner, KHÔNG FTP

Đây là bộ template có sẵn trong repo ngocnhanvo/escvn-actions. File workflow dưới build-hub-template không tự chạy: phải tạo repository private mới cho Build Hub và đăng ký runner vào đó.

Mục tiêu:
- ESC (esc.vn) và Ánh Sáng Cuộc Sống (anhsangvacuocsong.vn) được build đồng thời trên Windows VPS.
- Mỗi project giữ node_modules và pnpm store lâu dài trong thư mục riêng dưới USERPROFILE/ESC-Build.
- Giữ nguyên production FTP và dịch vụ FTPS Gateway; chỉ tạo báo cáo build.

## 1. Private Build Hub

1. Tạo repository PRIVATE có tên chính xác ngocnhanvo/esc-build-hub, với branch mặc định main.
2. Trong repository private đó, tạo .github/workflows/vps-build.yml, copy nguyên nội dung build-hub-template/.github/workflows/vps-build.yml từ escvn-actions/main.
3. Trong Settings > Secrets and variables > Actions của Build Hub, cấu hình:
   - SOURCE_REPO_PAT: token Contents:read trên cả hai repo private ngocnhanvo/escvn-astro và ngocnhanvo/anhsangvacuocsong-astro.
   - ENV_FILE_ESC: nội dung .env production của riêng ESC.
   - ENV_FILE_ANHSANG: nội dung .env production của riêng Ánh Sáng.
4. Trong mỗi Actions Hub công khai, escvn-actions và anhsangvacuocsong-actions, cấu hình riêng secret BUILD_HUB_DISPATCH_TOKEN với quyền Contents:write (bắt buộc cho API repository_dispatch) chỉ đến repository private esc-build-hub.
5. Tuyệt đối không gửi giá trị token, mật khẩu hoặc ENV_FILE qua chat. Không đặt FTP secrets trong Build Hub.

## 2. Cài hai runner riêng trên VPS

Đăng nhập Windows Server 2016 bằng user không phải Administrator. Không dừng, sửa hay cập nhật FTPS Gateway.

1. Download ZIP của ngocnhanvo/escvn-actions, giải nén và mở PowerShell trong folder build-hub-template.
2. Trong repository private esc-build-hub vào Settings > Actions > Runners > New self-hosted runner để lấy registration token mới. Token thuộc private Hub, không dùng của repo public hoặc escvn-astro cũ.
3. Chạy: powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\tools\setup-hub-runners.ps1"
4. Dán token khi script hỏi. Script cài ESC-HUB-WORKER-01 và ESC-HUB-WORKER-02 dưới USERPROFILE/ESC-Build/runners.
5. Chạy: .\tools\start-hub-runners.cmd
6. Xác nhận cả hai runner ở trạng thái Online / Listening for Jobs và cùng nhãn esc-build-worker.

Runner chạy trong cửa sổ CMD sẽ dừng khi user log off hoặc đóng cửa sổ. Sau QA mới bố trí Task Scheduler hoặc dịch vụ chuyên dụng, không tự sửa Windows Services hiện tại.

## 3. Kiểm thử và nghiệm thu

Trong private Build Hub, mở workflow Private ESC Build Hub - Multi Project (NO FTP).

- Test 1: project=esc, cache_mode=fresh -> build ESC thành công và xuất build-report.json.
- Test 2: ESC chạy lần hai -> deps_reused=true, không cài lại dependencies đã hợp lệ.
- Test 3: project=anhsang, cache_mode=fresh -> build thành công; có sitemap.xml, robots.txt, llms.txt và dist/server/entry.mjs hợp lệ.
- Test 4: Ánh Sáng chạy lần hai -> deps_reused=true.
- Test 5: Kích hoạt hai project trong khoảng thời gian gần nhau, chứng minh cả hai job in_progress đồng thời trên hai worker Online. Nếu quá tải VPS phải chặn concurrency cho tới khi đủ tài nguyên.
- Test 6: Dùng workflow VPS Build Request (NO FTP) trong từng Actions Hub để gửi job đến đúng project private.
- Test 7: WordPress GitHub Trigger gửi event repository_dispatch type wp_trigger_vps_build tới Actions Hub của dự án, không dùng wp_trigger_build vốn là event deploy FTP production.

Các workflow request hiện có ở escvn-actions và anhsangvacuocsong-actions. Chúng không tự động thay thế chức năng deploy production.

## 4. Quy tắc bảo mật và vận hành

- KHÔNG sửa các workflow deploy.yml production.
- KHÔNG tạo GitHub Actions workflow mới trong Astro private (trừ private Hub riêng).
- Build chỉ checkout source master của từng dự án, không tùy ý chọn repo từ payload.
- Mỗi dự án có cache dependencies, WordPress .cache, source directory và secrets riêng.
- Hai runner dưới cùng Windows user là tách workspace, chưa đủ cách ly bảo mật cho khách hàng không tin cậy; khi cung cấp rộng cần Windows account/VM riêng.
- Không upload dist từ Windows lên hosting cho tới khi được kiểm chứng riêng cơ chế packaging/deploy.
- Giữ domain Ánh Sáng đúng anhsangvacuocsong.vn và bộ kiểm tra SEO production.
- Secret thiếu hoặc runner chưa đăng ký là trạng thái CHƯA TRIỂN KHAI, không được công bố là PASS.

## 5. Thành phần

- scripts/persistent-deps.mjs: workspace cố định, install fingerprint, pnpm store riêng.
- scripts/run-project-build.ps1: build Windows 2016, kiểm tra dữ liệu/output và SEO Ánh Sáng.
- .github/workflows/vps-build.yml: workflow CHỈ dùng trong private Hub, không deploy.
- tools/setup-hub-runners.ps1: cài 2 runner chính thức có SHA-256.
- tools/start-hub-runners.cmd: chạy hai runner đồng thời.
- tests/persistent-deps.test.mjs: QA tự động, không cần truy cập VPS hoặc secret.
