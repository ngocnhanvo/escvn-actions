import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const origin = 'https://admin.esc.vn';
const site = 'https://esc.vn';
const route = '/ten-mien-moi';
const destination = '/ten-mien-moi/index.html';
const login = process.env.WP_ADMIN_URL;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!login || !username || !password || new URL(login.startsWith('http') ? login : 'https://' + login).origin !== origin) throw new Error('Missing or wrong WordPress admin credentials/host');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const get = (path) => context.request.get(origin + path, { timeout: 45000 });
const math = (body) => {
  const match = body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
  if (!match) return null;
  return match[2] === '+' ? +match[1] + +match[3] : match[2] === '-' ? +match[1] - +match[3] : +match[1] * +match[3];
};
const assertRouting = (item) => {
  assert.equal(item?.status, 'publish');
  assert.equal(item?.acf?.from_link, route);
  assert.equal(item?.acf?.to_link, destination);
  assert.equal(item?.acf?.type, 'Rewrite');
  assert.equal(item?.acf?.match_type, 'Exact');
  assert.equal(item?.acf?.enable, true);
};
try {
  // The actual static output must exist before modifying the routing table.
  const output = await context.request.get(site + destination, { timeout: 45000 });
  const html = await output.text();
  assert.equal(output.status(), 200, 'Astro static index.html was not published');
  assert.match(html, /3 TÊN MIỀN MỚI/i, 'Static HTML has an unexpected title');
  console.log('Astro generated static output reachable directly: HTTP 200');

  let existing = null;
  for (let pageNumber = 1; pageNumber <= 30; pageNumber++) {
    const response = await get(`/wp-json/wp/v2/chuyen-huong-link?per_page=100&page=${pageNumber}&status=publish`);
    if (response.status() !== 200) throw new Error(`Cannot inventory WP routes: HTTP ${response.status()}`);
    const items = await response.json();
    if (!Array.isArray(items)) throw new Error('Invalid WP route response');
    existing = items.find((item) => item?.acf?.from_link === route);
    if (existing) break;
    const totalPages = Number(response.headers()['x-wp-totalpages'] || 1);
    if (pageNumber >= totalPages) break;
  }
  if (existing) {
    assertRouting(existing);
    console.log('WP exact route already published; no write needed, id:', existing.id);
    process.exitCode = 0;
  } else {
    await page.goto(origin + '/wp-admin/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (await page.locator('#user_login').isVisible().catch(() => false)) {
      await page.locator('#user_login').fill(username);
      await page.locator('#user_pass').fill(password);
      const answer = math(await page.locator('body').innerText());
      if (answer !== null) {
        let field = page.locator('#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[type="number"]').first();
        if (await field.count() === 0) {
          const others = page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
          if (await others.count() === 1) field = others.first();
        }
        if (await field.count() === 0) throw new Error('Unsupported WP CAPTCHA');
        await field.fill(String(answer));
      }
      await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('#wp-submit').click()]);
    }
    if (page.url().includes('wp-login.php') || await page.locator('#login_error').isVisible().catch(() => false)) throw new Error('WP login unsuccessful');
    await page.goto(origin + '/wp-admin/post-new.php?post_type=chuyen-huong-link', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const title = page.locator('#title,.editor-post-title__input,[aria-label="Add title"],[aria-label="Thêm tiêu đề"]').first();
    await title.waitFor({ timeout: 30000 });
    await title.fill('Tên miền mới — URL nội bộ');
    const from = page.locator('input[name="acf[field_esc_route_from_link]"]');
    const to = page.locator('input[name="acf[field_esc_route_to_link]"]');
    const type = page.locator('select[name="acf[field_esc_route_type]"]');
    const match = page.locator('select[name="acf[field_esc_route_match_type]"]');
    const enabled = page.locator('input[type="checkbox"][name="acf[field_esc_route_enable]"]');
    await from.waitFor({ state: 'attached', timeout: 20000 });
    assert.equal(await to.count(), 1);
    assert.equal(await type.count(), 1);
    assert.equal(await match.count(), 1);
    await from.fill(route);
    await to.fill(destination);
    await type.selectOption('Rewrite');
    await match.selectOption('Exact');
    if (await enabled.count() && !(await enabled.isChecked())) await enabled.check();
    const publish = page.locator('#publish');
    if (await publish.isVisible().catch(() => false)) {
      await Promise.all([page.waitForLoadState('domcontentloaded'), publish.click()]);
    } else {
      const button = page.getByRole('button', { name: /^(Publish|Đăng|Đăng bài)$/ }).first();
      await button.click();
      const confirmation = page.getByRole('button', { name: /^(Publish|Đăng|Đăng bài)$/ }).last();
      if (await confirmation.isVisible().catch(() => false)) await confirmation.click();
    }
    console.log('WordPress post editor after save:', page.url());
    let record = null;
    for (let pageNumber = 1; pageNumber <= 30; pageNumber++) {
      const check = await get(`/wp-json/wp/v2/chuyen-huong-link?per_page=100&page=${pageNumber}&status=publish`);
      assert.equal(check.status(), 200);
      const list = await check.json();
      record = list.find((item) => item?.acf?.from_link === route);
      if (record) break;
      if (pageNumber >= Number(check.headers()['x-wp-totalpages'] || 1)) break;
    }
    if (!record) throw new Error('New route is not published in WordPress; check the post editor save/publish state');
    assertRouting(record);
    console.log('WP URL route created, read-after-write verified. Route ID:', record.id);
  }
} finally {
  await context.close();
  await browser.close();
}
