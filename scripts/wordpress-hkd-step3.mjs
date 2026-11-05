import { chromium } from 'playwright';
import fs from 'node:fs';

const raw = process.env.WP_ADMIN_URL, user = process.env.WP_ADMIN_USERNAME, password = process.env.WP_ADMIN_PASSWORD;
if (!raw || !user || !password) throw new Error('Missing WordPress Admin secrets');
const origin = new URL(raw.includes('://') ? raw : 'https://' + raw).origin;
if (origin !== 'https://admin.esc.vn') throw new Error('Unexpected WordPress host');

const adminPath = 'hkd/data/admin.vn-2025.json';
const industriesPath = 'hkd/data/industries.json';
const admin = JSON.parse(fs.readFileSync(adminPath,'utf8'));
const industries = JSON.parse(fs.readFileSync(industriesPath,'utf8'));
if (admin.provinces.length !== 34 || admin.wards.length !== 3321 || industries.length !== 15) throw new Error('Source fixture count mismatch');
if (new Set(admin.provinces.map(x=>x.code)).size !== 34 || new Set(admin.wards.map(x=>x.code)).size !== 3321 || new Set(industries.map(x=>x.code)).size !== 15) throw new Error('Duplicate source codes');
const provinceCodes = new Set(admin.provinces.map(x=>x.code));
if (admin.wards.some(x=>!provinceCodes.has(x.province_code))) throw new Error('Orphan ward in source data');

function arithmetic(body) {
  const m=body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
  if (!m) return null;
  const a=Number(m[1]), b=Number(m[3]);
  return m[2]==='+' ? a+b : m[2]==='-' ? a-b : a*b;
}
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1300,height:940}});
try {
  await page.goto(origin + '/wp-admin/', {waitUntil:'domcontentloaded',timeout:60000});
  if (await page.locator('#user_login').isVisible().catch(()=>false)) {
    await page.locator('#user_login').fill(user);
    await page.locator('#user_pass').fill(password);
    const answer = arithmetic(await page.locator('body').innerText());
    if (answer !== null) {
      const selectors = '#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[name*="math" i], #loginform input[id*="math" i], #loginform input[type="number"]';
      let field=page.locator(selectors).first();
      if (await field.count() === 0) {
        const candidates=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
        if (await candidates.count()===1) field=candidates.first();
      }
      if (await field.count()===0) throw new Error('Unknown CAPTCHA challenge');
      await field.fill(String(answer));
    }
    await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
  }
  if (page.url().includes('wp-login.php') || await page.locator('#login_error').isVisible().catch(()=>false)) throw new Error('Login failed');
  const target=origin + '/wp-admin/tools.php?page=esc-hkd-step3';
  await page.goto(target,{waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('h1').filter({hasText:'HKD Reference Import'}).waitFor({timeout:15000});
  const counts=async()=>page.locator('#hkd-step3-counts li').evaluateAll(nodes=>Object.fromEntries(nodes.map(n=>[n.getAttribute('data-hkd-type'),Number(n.getAttribute('data-hkd-count'))])));
  const before=await counts();
  if (Object.keys(before).length !== 5 || Object.values(before).some(x=>x!==0)) throw new Error('Preflight: expected five empty HKD tables');
  console.log('HKD Step3 preflight: five tables empty, sources validated');
  await page.locator('input[name="esc_hkd_admin_json"]').setInputFiles(adminPath);
  await page.locator('input[name="esc_hkd_industries_json"]').setInputFiles(industriesPath);
  await page.locator('input[name="esc_hkd_step3_confirm"]').check();
  await Promise.all([
    page.waitForLoadState('domcontentloaded',{timeout:90000}),
    page.locator('button[name="esc_hkd_step3_apply"]').click(),
  ]);
  const fail=await page.locator('.notice-error').first().textContent().catch(()=>null);
  if (fail) throw new Error('Import rejected: '+fail.slice(0,180));
  await page.locator('#hkd-step3-success').waitFor({timeout:15000});
  const expected={provinces:34,wards:3321,industries:15,businesses:0,registrations:0};
  const after=await counts();
  if (JSON.stringify(after)!==JSON.stringify(expected)) throw new Error('Read-back counts mismatch: '+JSON.stringify(after));
  console.log('HKD Step3 DATA PASS '+JSON.stringify(after)+'; 0 demo records; relationships checked by WordPress');
  await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  const verified=await counts();
  if (JSON.stringify(verified)!==JSON.stringify(expected)) throw new Error('Independent reload verification failed');
  console.log('HKD Step3 persistence PASS: counts match after reload');
} finally {await browser.close();}
