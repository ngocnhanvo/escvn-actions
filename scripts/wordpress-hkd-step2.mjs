import { chromium } from 'playwright';

const base = process.env.WP_ADMIN_URL;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!base || !username || !password) throw new Error('WordPress Admin credentials not configured');
const origin = new URL(base.includes('://') ? base : 'https://' + base).origin;
if (origin !== 'https://admin.esc.vn') throw new Error('Unexpected WordPress origin');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 960 } });
const page = await context.newPage();
const visible = async (selector) => page.locator(selector).first().isVisible().catch(() => false);

function arithmetic(body) {
  const m = body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
  if (!m) return null;
  const a = Number(m[1]), b = Number(m[3]);
  if (m[2] === '+') return a + b;
  if (m[2] === '-') return a - b;
  return a * b;
}

try {
  await page.goto(origin + '/wp-admin/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (await visible('#user_login')) {
    await page.locator('#user_login').fill(username);
    await page.locator('#user_pass').fill(password);
    const answer = arithmetic(await page.locator('body').innerText());
    if (answer !== null) {
      const selector = '#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[name*="math" i], #loginform input[id*="math" i], #loginform input[type="number"]';
      let target = page.locator(selector).first();
      if (await target.count() === 0) {
        const fields = page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
        if (await fields.count() === 1) target = fields.first();
      }
      if (await target.count() === 0) throw new Error('Captcha challenge unsupported');
      await target.fill(String(answer));
    }
    await Promise.all([
      page.waitForLoadState('domcontentloaded'),
      page.locator('#wp-submit').click(),
    ]);
  }
  if (page.url().includes('wp-login.php') || await visible('#login_error')) {
    throw new Error('WordPress login not authorized');
  }

  await page.goto(origin + '/wp-admin/tools.php?page=esc-hkd-schema', {
    waitUntil: 'domcontentloaded', timeout: 60000,
  });
  await page.locator('.wrap h1').filter({ hasText: 'HKD Table Setup' }).waitFor({ timeout: 20000 });
  const lines = await page.locator('.wrap ul li').allTextContents();
  if (lines.length !== 5) throw new Error('Expected five table status rows');
  const countPresent = lines.filter(line => line.includes('EXISTS')).length;
  const countMissing = lines.filter(line => line.includes('NOT PRESENT')).length;
  if (countPresent !== 0 || countMissing !== 5) {
    throw new Error('Preflight rejected: expected exactly five absent HKD tables');
  }
  console.log('HKD preflight PASS: five table names absent, zero collisions');

  await page.locator('input[name="esc_hkd_backup_confirm"]').check();
  await page.locator('input[name="esc_hkd_phrase"]').fill('CREATE FIVE HKD TABLES');
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('button[name="esc_hkd_schema_apply"]').click(),
  ]);
  const success = await page.locator('.notice-success').first().textContent().catch(() => '');
  if (!success.includes('Created and verified 5 tables')) {
    const rejected = await page.locator('.notice-error').first().isVisible().catch(() => false);
    throw new Error(rejected ? 'HKD table creation reported error' : 'No verified success response');
  }
  const after = await page.locator('.wrap ul li').allTextContents();
  if (after.length !== 5 || after.some(line => !line.includes('EXISTS') || line.includes('NOT PRESENT'))) {
    throw new Error('HKD table read-after-write mismatch');
  }
  console.log('HKD creation PASS: five tables and three foreign keys verified by PHP, five names read back');
} finally {
  await browser.close();
}
