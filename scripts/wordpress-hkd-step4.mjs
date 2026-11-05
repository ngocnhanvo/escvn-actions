import { chromium } from 'playwright';

const base = process.env.WP_ADMIN_URL;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!base || !username || !password) throw new Error('WordPress Admin credentials not configured');
const origin = new URL(base.includes('://') ? base : 'https://' + base).origin;
if (origin !== 'https://admin.esc.vn') throw new Error('Unexpected WordPress target');

const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1360,height:920}});
const visible = async (selector) => page.locator(selector).first().isVisible().catch(() => false);
function solve(body) {
  const m=body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
  if (!m) return null;
  const a=Number(m[1]), b=Number(m[3]);
  return m[2]==='+'?a+b:m[2]==='-'?a-b:a*b;
}
try {
  await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
  if (await visible('#user_login')) {
    await page.locator('#user_login').fill(username);
    await page.locator('#user_pass').fill(password);
    const answer=solve(await page.locator('body').innerText());
    if (answer!==null) {
      const selector='#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[name*="math" i], #loginform input[id*="math" i], #loginform input[type="number"]';
      let field=page.locator(selector).first();
      if (await field.count()===0) {
        const candidates=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
        if (await candidates.count()===1) field=candidates.first();
      }
      if (await field.count()===0) throw new Error('Captcha challenge unsupported');
      await field.fill(String(answer));
    }
    await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
  }
  if (page.url().includes('wp-login.php') || await visible('#login_error')) throw new Error('WordPress login failed');
  await page.goto(origin+'/wp-admin/plugins.php?plugin_status=inactive',{waitUntil:'commit',timeout:90000});
  const row=page.locator('tr[data-slug="esc-hkd"]');
  await row.waitFor({timeout:60000});
  const activate=row.locator('a:has-text("Activate"), a:has-text("Kích hoạt")').first();
  if (await activate.count() && await activate.isVisible()) {
    await Promise.all([page.waitForLoadState('domcontentloaded'),activate.click()]);
    console.log('HKD plugin activation submitted');
  } else {
    const deactivate=row.locator('a:has-text("Deactivate"), a:has-text("Vô hiệu hóa")').first();
    if (!(await deactivate.count() && await deactivate.isVisible())) throw new Error('HKD plugin activation state unclear');
    console.log('HKD plugin already active');
  }

  // Use anonymous requests: only the public API is in scope.
  const guest=await browser.newContext({ignoreHTTPSErrors:false});
  const get=async(path)=>{
    const response=await guest.request.get(origin+'/wp-json/esc-hkd/v1'+path,{timeout:45000});
    const text=await response.text();
    let body; try {body=JSON.parse(text);} catch {throw new Error('Invalid JSON response '+path+' status '+response.status());}
    return {status:response.status(),body};
  };

  const health=await get('/health');
  if (health.status!==200 || health.body.ok!==true || health.body.provinces!==34) throw new Error('Health check failed '+JSON.stringify(health).slice(0,220));
  const meta=await get('/meta');
  if (meta.status!==200 || meta.body.stats?.businesses!==0 || meta.body.provinces?.length!==34 || meta.body.industries?.length!==15)
    throw new Error('Meta parity failed');
  const provinces=await get('/provinces');
  if (provinces.status!==200 || !Array.isArray(provinces.body) || provinces.body.length!==34) throw new Error('Province parity failed');
  const wards=await get('/provinces/79/wards');
  if (wards.status!==200 || !Array.isArray(wards.body) || wards.body.length!==168 || wards.body.some(w=>w.provCode!=='79')) throw new Error('Ward HCM parity failed');
  const industries=await get('/industries');
  if (industries.status!==200 || !Array.isArray(industries.body) || industries.body.length!==15) throw new Error('Industry parity failed');
  const list=await get('/businesses?limit=20&page=1');
  if (list.status!==200 || list.body.total!==0 || !Array.isArray(list.body.items) || list.body.items.length!==0) throw new Error('Empty directory response wrong');
  const pts=await get('/map/points?bbox=8,102,24,110');
  if (pts.status!==200 || pts.body.truncated!==false || !Array.isArray(pts.body.points) || pts.body.points.length!==0) throw new Error('Map points response wrong');
  const ext=await get('/map/extent');
  if (ext.status!==200 || ext.body.total!==0 || ext.body.withGeo!==0 || ext.body.bounds!==null) throw new Error('Map extent response wrong');
  const detail=await get('/businesses/unknown-no-record');
  if (detail.status!==404 || detail.body.code!=='hkd_not_found') throw new Error('Business 404 contract wrong');
  const invalid=await get('/map/points?bbox=not-a-bbox');
  if (invalid.status!==400 || invalid.body.code!=='hkd_bad_bbox') throw new Error('Malformed bbox not rejected');
  const badPage=await get('/businesses?page=0');
  if (badPage.status!==400) throw new Error('Invalid page not rejected');
  const noWrite=await guest.request.post(origin+'/wp-json/esc-hkd/v1/businesses',{data:{name:'test'},timeout:30000});
  if (noWrite.status()!==404 && noWrite.status()!==405) throw new Error('Unexpected write route');

  console.log('HKD Step4 PASS: health 34; meta 34 provinces/15 industries/0 businesses; HCM 168 wards; list/points/extent; 404/400; no write route');
  await guest.close();
} finally {
  await browser.close();
}
