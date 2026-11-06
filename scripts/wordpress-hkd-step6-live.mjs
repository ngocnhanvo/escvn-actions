import { chromium } from 'playwright';

const site = 'https://esc.vn/ban-do-ho-kinh-doanh/';
const browser = await chromium.launch({
  headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function checkMapPage(width, height, mobile = false) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  try {
    const response = await page.goto(site, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (response?.status() !== 200) throw Error('HKD page returned HTTP ' + response?.status());
    await page.locator('#mv.mapview').waitFor({ timeout: 20000 });
    const header = page.locator('header .nav');
    await header.waitFor({ state: 'visible' });
    const name = await header.locator('.logo').innerText();
    if (!name.includes('Bản đồ HKD')) throw Error('Expected standalone source HKD header');
    if (!await page.locator('.ov-search #q').isVisible()) throw Error('Floating search missing');
    if (!await page.locator('#chips .chip2').first().isVisible()) throw Error('Source industry chips missing');
    if (!await page.locator('#zin').isVisible()) throw Error('Goong map controls missing');
    if (!await page.locator('#bottom #bbT').isVisible()) throw Error('Bottom drawer missing');
    const demo = await page.locator('#demoTag').evaluate(el => !el.hidden);
    if (demo) throw Error('Demo label visible on real ESC production');

    await page.waitForFunction(() => document.querySelector('#bbT')?.textContent?.includes('0 phù hợp bộ lọc'), { timeout: 30000 });
    try {
      await page.locator('#map .goongjs-canvas').first().waitFor({ state: 'attached', timeout: 20000 });
    } catch (error) {
      const info = await page.evaluate(() => ({
        note: document.querySelector('#note')?.textContent?.slice(0, 500),
        app: document.querySelector('#app')?.textContent?.slice(0, 700),
        canvasCount: document.querySelectorAll('#map canvas').length,
        mapNode: document.querySelector('#map')?.outerHTML.slice(0, 320),
        loading: document.querySelector('#busy')?.textContent,
        sdkLoaded: !!window.goongjs,
        sdkScripts: document.querySelectorAll('script[src*="goong-js"]').length,
      }));
      throw Error('GOONG_DIAGNOSTIC ' + JSON.stringify(info) + '; ' + String(error).slice(0, 100));
    }
    const size = await page.evaluate(() => ({
      headerHeight: document.querySelector('header')?.getBoundingClientRect().height,
      mapHeight: document.querySelector('#mv')?.getBoundingClientRect().height,
      viewport: window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 4,
    }));
    if (size.horizontalOverflow) throw Error('Horizontal overflow at ' + width);
    if (size.mapHeight < height * .70) throw Error('Map no longer fills viewport: ' + JSON.stringify(size));

    await page.locator('#btnF').click();
    await page.locator('#panel').waitFor({ state: 'visible', timeout: 7000 });
    await page.locator('#fProv').selectOption('79');
    await page.waitForFunction(() => document.querySelectorAll('#wardList input[name="ward"]').length === 169, { timeout: 20000 });
    await page.locator('#panel [data-tab="ind"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#indList input[name="ind"]').length === 15, { timeout: 10000 });
    await page.locator('#panel [data-a="clear"]').click();
    await page.waitForFunction(() => document.querySelector('#fProv')?.value === '', { timeout: 15000 });

    await page.locator('#q').fill('quan ca phe');
    await page.waitForFunction(() => document.querySelector('#qclr')?.hidden === false, { timeout: 8000 });
    await page.locator('#qclr').click();
    if (await page.locator('#q').inputValue() !== '') throw Error('Search reset failed');

    await page.locator('#btnF').click();
    await page.locator('#bbT').click();
    if (await page.locator('#bbT').getAttribute('aria-expanded') !== 'true') throw Error('Bottom drawer not expanded');
    await page.locator('#bbT').click();
    if (errors.length) throw Error('JavaScript page error: ' + errors.join(' | '));

    console.log('HKD SOURCE UI ' + (mobile ? 'MOBILE' : 'DESKTOP')
      + ' PASS: Goong canvas, full-screen layout, floating chips/search, province-wards, industry filters, bottom drawer, no demo, width=' + width);
  } finally { await context.close(); }
}

try {
  const api = await browser.newContext();
  const response = await api.request.get('https://admin.esc.vn/wp-json/esc-hkd/v1/meta', { timeout: 45000 });
  const meta = await response.json();
  if (response.status() !== 200 || meta.demo !== false || meta.provinces.length !== 34
      || meta.industries.length !== 15 || meta.stats.businesses !== 0) {
    throw Error('ESC real REST metadata differs from expected baseline');
  }
  await api.close();

  await checkMapPage(1366, 642, false);
  await checkMapPage(390, 844, true);
} finally { await browser.close(); }
