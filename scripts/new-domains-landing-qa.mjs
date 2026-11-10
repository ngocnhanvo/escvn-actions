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
    const heroImage = page.locator('.ndl-hero-upload-image');
    assert.equal(await heroImage.count(), 1, 'Approved WordPress banner must remain in place');
    const imageMetrics = await heroImage.evaluate(async (img) => {
      try { await img.decode(); } catch (error) { return { loaded: false, error: String(error) }; }
      const rect = img.getBoundingClientRect();
      return {
        loaded: img.complete && img.naturalWidth > 0,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        renderedWidth: Math.round(rect.width),
        renderedHeight: Math.round(rect.height),
        src: img.currentSrc,
      };
    });
    console.log('HERO_IMAGE', JSON.stringify(imageMetrics));
    assert.ok(imageMetrics.loaded && imageMetrics.naturalWidth >= 1000, 'Original banner must load');
    assert.ok(imageMetrics.renderedWidth <= imageMetrics.naturalWidth + 1, 'Banner must not be upscaled beyond natural width');
    const heroCTA = page.locator('.ndl-hero-upload-cta[href="#dang-ky-tu-van"]');
    assert.equal(await heroCTA.count(), 1, 'Banner consultation CTA must be preserved');
    await heroCTA.click();
    assert.equal(new URL(page.url()).hash, '#dang-ky-tu-van', 'CTA should navigate to consultation form');
    if (name === 'desktop') {
      const cmsResponse = await context.request.get('https://admin.esc.vn/wp-json/wp/v2/pages/55546', { timeout: 30000 });
      assert.equal(cmsResponse.status(), 200, 'WordPress Page must exist');
      const cmsPage = await cmsResponse.json();
      assert.equal(cmsPage.status, 'publish', 'Landing Page must be published');
      const buildResponse = await context.request.get('https://esc.vn/data/page-' + cmsPage.slug + '.json', { timeout: 30000 });
      assert.equal(buildResponse.status(), 200, 'WordPress Page data must be exported by Astro build');
      const buildPage = await buildResponse.json();
      const content = buildPage.contents?.find((p) => p.shortcode === 'tenmienmoi_00');
      assert.equal(buildPage.id, cmsPage.id, 'Published Astro data must match WordPress Page');
      assert.ok(content?.data?.items?.length >= 60, 'ESC Table must contain all editable landing fields');
      console.log('CMS_BINDING_PASS', JSON.stringify({ page_id: cmsPage.id, table: 'tenmienmoi_00', fields: content.data.items.length }));
    }
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
