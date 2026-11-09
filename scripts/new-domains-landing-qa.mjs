import { chromium } from 'playwright';
import { strict as assert } from 'node:assert';
import { mkdirSync } from 'node:fs';

const origin = 'https://esc.vn/ten-mien-moi/';
const browser = await chromium.launch({ headless: true });
mkdirSync('new-domains-landing-qa', { recursive: true });
try {
  for (const [name, width, height] of [
    ['desktop', 1440, 900],
    ['tablet', 820, 1100],
    ['mobile', 390, 844],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const response = await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 45000 });
    assert.equal(response?.status(), 200, `${name} route should exist`);
    await page.locator('#ndl-hero-title').waitFor();
    assert.match(await page.locator('h1').first().innerText(), /3 TÊN MIỀN MỚI/i);
    assert.equal(await page.locator('.ndl-domain-card').count(), 3);
    assert.equal(await page.locator('.ndl-faq-item').count(), 5);
    assert.equal(await page.locator('.ndl-final-cta a').getAttribute('href'), '/dang-ky-ten-mien');
    const clock = await page.locator('[data-time="days"]').innerText();
    assert.match(clock, /^\d+$/, 'Countdown should be hydrated');
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
    assert.equal(hasOverflow, false, `${name} has horizontal overflow`);
    await page.locator('.ndl-faq-item').last().locator('summary').click();
    assert.equal(await page.locator('.ndl-faq-item').last().getAttribute('open'), '', 'FAQ should expand');
    await page.locator('#ndl-cf7 form.wpcf7-form').waitFor({ state: 'attached', timeout: 30000 });
    if (name === 'desktop') {
      const layout = await page.locator('#ndl-cf7 form.wpcf7-form').evaluate((form) => {
        const brief = (el) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return { tag: el.tagName, className: typeof el.className === 'string' ? el.className : '', width: Math.round(r.width), x: Math.round(r.x), display: s.display, gridColumns: s.gridTemplateColumns, margin: s.margin, maxWidth: s.maxWidth };
        };
        return {
          host: brief(document.querySelector('#ndl-cf7')),
          wrapper: brief(form.parentElement),
          form: brief(form),
          children: Array.from(form.children).slice(0, 20).map(brief),
          formAncestors: [form.parentElement?.parentElement, form.parentElement?.parentElement?.parentElement].filter(Boolean).map(brief),
          labels: Array.from(form.querySelectorAll('label')).slice(0, 7).map((el) => ({text: (el.textContent||'').trim().slice(0,70), node: brief(el)})),
        };
      });
      console.log('FORM_LAYOUT', JSON.stringify(layout));
      const siteHome = await context.newPage();
      await siteHome.goto('https://esc.vn/', { waitUntil: 'domcontentloaded', timeout: 45000 });
      console.log('REAL_ESC_LOGO', await siteHome.locator('#header-logo').getAttribute('src'));
      await siteHome.close();
    }
    assert.ok(await page.locator('#ndl-cf7 input[name="_wpcf7"]').count(), 'Original CF7 hidden id should exist');
    assert.equal(await page.locator('#ndl-form-status').innerText(), '', 'Form must load without an error');
    await page.screenshot({ path: `new-domains-landing-qa/${name}.png`, fullPage: true, animations: 'disabled' });
    assert.deepEqual(errors, [], `${name} browser errors`);
    console.log(`QA_PASS ${name}: 200, 3 domains, 5 FAQ, CTA, countdown, original CF7, no overflow`);
    await context.close();
  }
} finally {
  await browser.close();
}
