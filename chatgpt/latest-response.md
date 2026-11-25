# ESC.VN — Latest ChatGPT response

- Date (Asia/Ho_Chi_Minh): 2026-11-25
- Project: ESC.VN — Member Cart API integration
- Astro repo: ngocnhanvo/escvn-astro
- Astro branch: github
- Astro HEAD: 4c44d75778dc6a4baefb6eae7be19884535d0d25
- Production master untouched: 37ef3f189d1cb23ddc61a07f7d463eca8ce8a676
- Actions repo: ngocnhanvo/escvn-actions@main
- State: CODE_READY / CI_PASS; PUBLIC_TUNNEL_QA_PENDING

## Changes

- Browser Member cart TEST API client at src/lib/memberCart/client.ts: add.php, check.php, count.php, view.php, remove.php, status.php. LocalStorage opaque 64-hex cart key isolated for TEST; no price supplied by client.
- Config src/lib/memberCart/config.ts, Member ID mapping from WordPress ACF, categories to Member service types. Feature enabled automatically in Astro DEV, or explicitly PUBLIC_MEMBER_CART_ENABLED=true in local built DEV; default target https://id.esc.vn.
- Domain search uses Member check API prices/status; product detail uses Member service ID; header cart badge/status and navigation to Member; cart SSR renders MemberCartPanel with line items/addons, remove, total, promotion preview and checkout URL.
- Member client contract tests 6/6 PASS; no actual test orders or member production requests.
- Existing Astro development verification #45553746114 SUCCESS (on source 0e96c13, preceding panel/tests).
- Targeted Member TEST QA #45554572661 SUCCESS (exact source 4c44d757, 6 unit tests, production-mode Astro DEV build with Member TEST enabled, artifact guards).
- Earlier run #45554034203 failed only from incorrect artifact path, not build or tests; workflow corrected.

## Next user-dependent step

User needs to pull escvn-astro github locally and make the Cloudflare Tunnel site publicly reachable. Verify Member TEST sat_sites allows the exact tunnel origin, e.g. https://esc-test.webnvn.com. Run Playwright live after tunnel public: domain available/unavailable, prices, adding/updating domain, mixed addons/only-addon cart, badge, status, preview promo, redirect, errors/429, without creating actual orders. Code may require fixes based on tunnel QA. Do not modify master or deploy production without explicit owner approval.

Chế độ code: auto-build
Cổng ghi source: bypass
Trạng thái: PARTIAL — chưa hoàn tất
