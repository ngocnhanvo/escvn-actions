import { chromium } from 'playwright';

const site = 'https://esc.vn/ban-do-ho-kinh-doanh/';
const browser = await chromium.launch({
  headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function checkMapPage(width, height, mobile = false) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  const mapNetworkErrors = [];
  const goongRequests = [];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('request', r => { if (/goong\\.io|goongmaps/i.test(r.url())) goongRequests.push(r.url()); });
  page.on('response', r => {
    if (r.url().includes('tiles.openfreemap.org') && r.status() >= 400)
      mapNetworkErrors.push(r.status() + ' ' + r.url().slice(0, 160));
  });
  page.on('requestfailed', r => {
    if (r.url().includes('tiles.openfreemap.org'))
      mapNetworkErrors.push('Failed ' + r.url().slice(0, 160) + ': ' + r.failure()?.errorText);
  });
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
    if (!await page.locator('#zin').isVisible()) throw Error('Map controls missing');
    if (!await page.locator('#bottom #bbT').isVisible()) throw Error('Bottom drawer missing');
    const demo = await page.locator('#demoTag').evaluate(el => !el.hidden);
    if (demo) throw Error('Demo label visible on real ESC production');

    await page.waitForFunction(() => document.querySelector('#bbT')?.textContent?.includes('0 phù hợp bộ lọc'), { timeout: 30000 });
    try {
      await page.locator('#map canvas.maplibregl-canvas').first().waitFor({ state: 'attached', timeout: 20000 });
    } catch (error) {
      const info = await page.evaluate(() => ({
        note: document.querySelector('#note')?.textContent?.slice(0, 500),
        app: document.querySelector('#app')?.textContent?.slice(0, 700),
        canvasCount: document.querySelectorAll('#map canvas').length,
        mapNode: document.querySelector('#map')?.outerHTML.slice(0, 320),
        loading: document.querySelector('#busy')?.textContent,
        sdkLoaded: !!window.maplibregl,
        sdkScripts: document.querySelectorAll('script[src*="maplibre-gl"]').length,
      }));
      throw Error('MAPLIBRE_DIAGNOSTIC ' + JSON.stringify(info) + '; ' + String(error).slice(0, 100));
    }
    await page.waitForFunction(() => typeof MAP !== 'undefined' && MAP && typeof MAP.bbox === 'function',
      null, { timeout: 15000 });
    if (goongRequests.length) throw Error('Legacy Goong network requests detected');
    if (mapNetworkErrors.length) throw Error('OpenFreeMap network errors: ' + mapNetworkErrors.join(' | '));
    const size = await page.evaluate(() => ({
      headerHeight: document.querySelector('header')?.getBoundingClientRect().height,
      mapHeight: document.querySelector('#mv')?.getBoundingClientRect().height,
      viewport: window.innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 4,
    }));
    if (size.horizontalOverflow) throw Error('Horizontal overflow at ' + width);
    if (size.mapHeight < height * .70) throw Error('Map no longer fills viewport: ' + JSON.stringify(size));

    console.log('HKD QA map canvas PASS; testing filter panel');
    await page.locator('#btnF').click();
    await page.locator('#panel').waitFor({ state: 'visible', timeout: 7000 });
    console.log('HKD QA panel opened');
    await page.locator('#fProv').selectOption('79');
    console.log('HKD QA province 79 selected');
    await page.waitForFunction(() => document.querySelectorAll('#wardList input[name="ward"]').length === 169, { timeout: 20000 });
    console.log('HKD QA wards input PASS');
    await page.locator('#panel [data-tab="ind"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#indList input[name="ind"]').length === 15, { timeout: 10000 });
    console.log('HKD QA industries PASS');
    await page.locator('#panel [data-a="clear"]').click();
    await page.locator('#panel [data-tab="loc"]').click();
    await page.waitForFunction(() => document.querySelector('#fProv')?.value === '' && document.querySelector('#fbdg')?.hidden === true, null, { timeout: 15000 });

    console.log('HKD QA clear filters PASS');
    await page.locator('#q').fill('quan ca phe');
    await page.waitForFunction(() => document.querySelector('#qclr')?.hidden === false, { timeout: 8000 });
    console.log('HKD QA search clear control visible');
    await page.locator('#qclr').click();
    if (await page.locator('#q').inputValue() !== '') throw Error('Search reset failed');

    await page.locator('#btnF').click();
    console.log('HKD QA bottom drawer phase');
    await page.locator('#bbT').click();
    if (await page.locator('#bbT').getAttribute('aria-expanded') !== 'true') throw Error('Bottom drawer not expanded');
    await page.locator('#bbT').click();
    if (errors.length) throw Error('JavaScript page error: ' + errors.join(' | '));

    console.log('HKD SOURCE UI ' + (mobile ? 'MOBILE' : 'DESKTOP')
      + ' PASS: MapLibre/OpenFreeMap canvas, full-screen layout, floating chips/search, province-wards, industry filters, bottom drawer, no demo, width=' + width);
  } finally { await context.close(); }
}

async function checkRegistrationForm(width, height) {
  const context=await browser.newContext({viewport:{width,height}});
  const page=await context.newPage();
  const posts=[];
  page.on('request',r=>{
    if(r.method()==='POST' && r.url().includes('/esc-hkd/v1/registrations')) posts.push(r.url());
  });
  try {
    const res=await page.goto(site+'#register',{waitUntil:'domcontentloaded',timeout:60000});
    if(res?.status()!==200)throw Error('Registration page HTTP '+res?.status());
    await page.locator('form#rf').waitFor({state:'visible',timeout:25000});
    if(!await page.locator('#n').isVisible()||!await page.locator('#c').isVisible()
      ||!await page.locator('#p').isVisible()||!await page.locator('#a').isVisible())
      throw Error('Registration required fields missing');
    if(!await page.locator('#hkdConsent').isVisible())throw Error('Consent checkbox missing');
    if(!await page.locator('#hkdCompanySite').count())throw Error('Anti-spam honeypot missing');
    await page.locator('#pv').selectOption('79');
    await page.waitForFunction(()=>document.querySelectorAll('#dt option').length===169,null,{timeout:18000});
    if(await page.locator('#ct option').count()!==16)throw Error('Industry choices missing');
    await page.locator('#rf button[type="submit"]').click();
    await page.locator('#e-n').getByText('Nhập tên hộ kinh doanh.').waitFor({state:'visible'});
    if(posts.length)throw Error('Invalid form sent POST to production');
    await page.evaluate(()=>{location.hash='#update-not-a-real-business'});
    await page.getByRole('heading',{name:'Không tìm thấy hồ sơ'}).waitFor({state:'visible',timeout:16000});
    if(posts.length)throw Error('Update lookup sent registration POST');
    const size=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth:innerWidth}));
    if(size.scrollWidth>size.innerWidth+4)throw Error('Registration form horizontal overflow at '+width);
    console.log('HKD Step7 REGISTRATION UI PASS width='+width+': real province/ward/industry options, consent, spam field, required validation, invalid-update fail closed; no production submission');
  }finally{await context.close()}
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
  await checkRegistrationForm(1366, 768);
  await checkRegistrationForm(390, 844);
} finally { await browser.close(); }
