# ESC DEV registration CTAs — checkpoint 2026-11-28

- Scope: approved user request for all pricing "Đăng ký ngay" CTAs on DEV, no production deployment.
- Astro DEV: `ngocnhanvo/escvn-astro@github` HEAD `d31d79e4c533462a85e5398cb8bcbc8abbe1d1e7`.
- Astro production `master` confirmed unchanged at `0135ff27513d5912aae28f4cc1728c99fecbb9fc`.
- Source changes: 33 TablePress pricing components, shared Layout, `src/lib/memberCart/registerNow.ts`, and tests. Reuses `addMemberService` then `viewMemberCart`; redirects to WordPress-owned /gio-hang only after confirming matching Member product. Blocks missing Member ID, unsupported billing cycles, and wrong domain routes. Does not mutate CMS.
- QA workflow: `ngocnhanvo/escvn-actions/.github/workflows/esc-member-cart-dev-qa.yml`.
- QA run: https://github.com/ngocnhanvo/escvn-actions/actions/runs/46095187898 — SUCCESS. 28/28 Vitest tests, Astro build PASS, 9/9 local rebuilt-site Playwright assertions PASS; `mockMemberWrites=1`, `realMemberWrites=0`, `ordersCreated=0`.
- IMPORTANT: This is a local rebuilt-site browser test with mocked Member TEST API; it is NOT proof that the updated source has been deployed at https://esc-test.webnvn.com or that Member accepts all real plan codes.
- DEV deployment BLOCKED pending verified DEV-only credentials/config. Latest examined preflight run: https://github.com/ngocnhanvo/escvn-actions/actions/runs/45550862407 — `ENV_FILE_DEV`, `FTP_SERVER_DEV`, `FTP_USERNAME_DEV`, `FTP_PASSWORD_DEV` missing, `DEV_DEPLOY_READY=NO`.
- Next: re-run DEV preflight after DEV credentials are configured, use an existing approved DEV-only deployment path (not production deploy.yml), verify deployed SHA, then Playwright click on live DEV for all eligible CTA categories with safe Member test mocks. Also validate live Member product-code acceptance without creating real orders.
- State: CODE_READY, LOCAL_BUILD_PASS, LOCAL_BROWSER_QA_PASS, DEV_DEPLOY_NOT_DONE, LIVE_DEV_QA_NOT_DONE, PRODUCTION_UNCHANGED.

## Checkout-flow correction — 28/11/2026
- User clarified the acceptance contract: click pricing `Đăng ký ngay` = add Member cart in place, no navigation; click header cart icon = direct Member checkout `https://id.esc.vn/cart.php?c=...`.
- DEV source HEAD `43d3fd352318af14ae651a1a4b0c055321d2ef22` (branch `github`), no Astro production source change.
- Changes: `registerNow.ts` now stays on current page and renders success/error, no `/gio-hang` redirect; `Layout.astro` removes obsolete cart-route prop; regression unit tests updated.
- Member header already uses `memberCartUrl` (current 64-hex cart key) and counts cart add-ons after `MEMBER_CART_EVENT`; this behavior is exercised in browser QA.
- Actions run https://github.com/ngocnhanvo/escvn-actions/actions/runs/46096598757: SUCCESS. 30/30 Vitest PASS, Astro build PASS, Playwright 13/13 PASS incl stays-on-page, success label, Member add request, header badge=1, header icon enters Member checkout URL; no real Member writes or order created.
- Reminder: Live Member TEST previously rejected Google Workspace ID `131600` (HTTP 422); that product mapping/eligibility issue is separate and remains uncorrected, so real add can still show refusal. No DEV remote upload was performed.
- Current: SOURCE_READY + MOCKED_BROWSER_QA_PASS; LIVE_DEV_API_ACCEPTANCE_UNVERIFIED; PRODUCTION_UNCHANGED.
