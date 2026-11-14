import { chromium } from 'playwright';

const site = 'https://esc.vn/ban-do-ho-kinh-doanh/';
const expectedProvider='google';
const browser = await chromium.launch({
  headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});

async function checkMapPage(width, height, mobile = false) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  const mapApiErrors = [];
  const legacyMapRequests = [];
  let googleSdkRequests=0;
  const sdkReferrerOrigins=[];
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  page.on('console',m=>{
    if(m.type()!=='error')return;
    const text=m.text();
    if(/Google Maps JavaScript API error|MapError/i.test(text)){
      const code=text.match(/\b[A-Za-z]+MapError\b/)?.[0]||'GoogleMapsApiError';
      mapApiErrors.push(code);
    }
  });
  page.on('request', r => {
    if (/goong\.io|goong-js|openfreemap\.org/i.test(r.url())) legacyMapRequests.push('Legacy provider request');
    if(r.url().startsWith('https://maps.googleapis.com/maps/api/js')){
      googleSdkRequests++;
      const referrer=r.headers()['referer']||'';
      let origin='(missing)';
      try{if(referrer)origin=new URL(referrer).origin+'/'}catch(e){origin='(unparseable)'}
      sdkReferrerOrigins.push(origin);
    }
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

    await page.waitForFunction(() => document.querySelector('#bbT')?.textContent?.includes('phù hợp bộ lọc'), null, { timeout: 30000 });
    try {
      const canvasOrMap=page.locator('#map .gm-style').first();
      await canvasOrMap.waitFor({state:'attached',timeout:15000});
    } catch (error) {
      const info = await page.evaluate(() => ({
        note: document.querySelector('#note')?.textContent?.slice(0, 500),
        app: document.querySelector('#app')?.textContent?.slice(0, 700),
        canvasCount: document.querySelectorAll('#map canvas').length,
        mapNode: document.querySelector('#map')?.outerHTML.slice(0, 320),
        loading: document.querySelector('#busy')?.textContent,
        googleSdkLoaded: !!window.google?.maps?.importLibrary,
      }));
      throw Error('MAP_DIAGNOSTIC ' + JSON.stringify({...info,googleErrorCodes:[...new Set(mapApiErrors)],sdkReferrerOrigins:[...new Set(sdkReferrerOrigins)]}) + '; ' + String(error).slice(0, 100));
    }
    await page.waitForFunction(() => typeof MAP !== 'undefined' && MAP && typeof MAP.bbox === 'function',
      null, { timeout: 15000 });
    if (legacyMapRequests.length) throw Error('Legacy map SDK or tile requests observed');
    if (mapApiErrors.length) throw Error('Google Maps API errors: '+[...new Set(mapApiErrors)].join(', '));
    if (await page.locator('#map').getAttribute('data-hkd-map-provider') !== expectedProvider)
      throw Error('Map provider mismatch: expected '+expectedProvider);
    const noteText = await page.locator('#note').innerText().catch(() => '');
    if (noteText.includes('Không tải được bản đồ')) throw Error('HKD map failure notice: '+noteText.slice(0,100));
    if(googleSdkRequests===0 || !await page.evaluate(()=>Boolean(window.google?.maps?.importLibrary)))
      throw Error('Google Maps JavaScript API not loaded');
    console.log('HKD '+expectedProvider+' map provider and viewport PASS (credentials redacted)');
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
    await page.waitForFunction(() => document.querySelectorAll('#wardList input[name="ward"]').length > 1, { timeout: 20000 });
    console.log('HKD QA wards input PASS');
    await page.locator('#panel [data-tab="ind"]').click();
    await page.waitForFunction(() => document.querySelectorAll('#indList input[name="ind"]').length > 0, { timeout: 10000 });
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
      + ' PASS: '+expectedProvider+' map, full-screen layout, floating chips/search, province-wards, industry filters, bottom drawer, no demo, width=' + width);
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
    const canvas=page.locator('#hkd-coordinate-map .gm-style').first();
    await canvas.waitFor({state:'visible',timeout:30000});
    await canvas.click({position:{x:120,y:125}});
    await page.waitForFunction(()=>{
      const lat=document.querySelector('#hkd-lat')?.value;
      const lng=document.querySelector('#hkd-lng')?.value;
      return lat && lng && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng));
    },null,{timeout:12000});
    await page.locator('#hkd-clear-location').click();
    if(await page.locator('#hkd-lat').inputValue()!=='' || await page.locator('#hkd-lng').inputValue()!=='')
      throw Error('Coordinate clear button failed');
    await page.locator('#hkd-lat').fill('10.823100');
    await page.locator('#hkd-lng').fill('106.629700');
    await page.locator('#hkd-lng').dispatchEvent('change');
    if(await page.locator('#hkd-lat').inputValue()!=='10.823100'
       || await page.locator('#hkd-lng').inputValue()!=='106.629700')
      throw Error('Manual coordinate fallback failed');
    console.log('HKD '+expectedProvider+' coordinate picker PASS: map click, clear, manual edit; no registration POST');

    await page.locator('#pv').selectOption('79');
    await page.waitForFunction(()=>document.querySelectorAll('#dt option').length>1,null,{timeout:18000});
    if(await page.locator('#ct option').count()<2)throw Error('Industry choices missing');
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
  if (response.status() !== 200 || meta.demo !== false
      || !Array.isArray(meta.provinces) || meta.provinces.length === 0
      || !Array.isArray(meta.industries) || meta.industries.length === 0
      || !Number.isInteger(meta.stats?.businesses) || meta.stats.businesses < 0) {
    throw Error('ESC REST metadata invalid: HTTP '+response.status()
      +', demo='+String(meta.demo)+', provinces='+String(meta.provinces?.length)
      +', industries='+String(meta.industries?.length)+', businesses='+String(meta.stats?.businesses));
  }
  console.log('HKD REST metadata PASS: published business count '+meta.stats.businesses);
  const configResponse = await api.request.get('https://admin.esc.vn/wp-json/esc-hkd/v1/map-config', { timeout: 45000 });
  const config = await configResponse.json().catch(() => null);
  const keyValid=typeof config?.googleMapsApiKey==='string' && /^[A-Za-z0-9_-]{20,200}$/.test(config.googleMapsApiKey);
  const mapIdValid=typeof config?.googleMapId==='string' && (config.googleMapId==='' || /^[A-Za-z0-9_-]{6,128}$/.test(config.googleMapId));
  const legacyKeyExposed=Object.prototype.hasOwnProperty.call(config||{},'goongMaptilesKey');
  console.log('Google Maps configuration status (no values logged): '+JSON.stringify({
    http:configResponse.status(),provider:config?.provider,keyValid,mapIdValid,mapIdConfigured:Boolean(config?.googleMapId),legacyKeyExposed
  }));
  if(configResponse.status()!==200||config?.provider!=='google'||legacyKeyExposed||!keyValid||!mapIdValid)
    throw Error('Google Maps configuration incomplete or legacy key exposed');
  console.log('HKD Google Maps map-config PASS (credentials redacted)');
  await api.close();

  await checkMapPage(1366, 642, false);
  await checkMapPage(390, 844, true);
  await checkRegistrationForm(1366, 768);
  await checkRegistrationForm(390, 844);
} finally { await browser.close(); }
