import { chromium } from 'playwright';
const raw=process.env.WP_ADMIN_URL,username=process.env.WP_ADMIN_USERNAME,password=process.env.WP_ADMIN_PASSWORD;
if(!raw || !username || !password) throw Error('Missing WP credentials');
const origin=new URL(raw.includes('://')?raw:'https://'+raw).origin;
if(origin!=='https://admin.esc.vn') throw Error('Wrong WordPress origin');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
const page=await context.newPage();
try {
  const response=await context.request.get(origin+'/wp-json/esc-hkd/v1/map-config',{timeout:45000});
  const body=await response.json().catch(()=>null);
  if(response.status()!==200 || body?.provider!=='google'
      || typeof body?.googleMapsApiKey!=='string'
      || typeof body?.googleMapId!=='string'
      || Object.prototype.hasOwnProperty.call(body,'goongMaptilesKey')) {
    throw Error('HKD must expose Google Maps configuration only');
  }
  if(!/^[A-Za-z0-9_-]{20,200}$/.test(body.googleMapsApiKey)
     || !/^[A-Za-z0-9_-]{6,128}$/.test(body.googleMapId))
    throw Error('Google Maps API Key or Map ID is missing or invalid');
  console.log('HKD map-config PASS; provider='+body.provider+'; keys redacted');
  const meta=await context.request.get(origin+'/wp-json/esc-hkd/v1/meta',{timeout:45000});
  const data=await meta.json().catch(()=>null);
  if(meta.status()!==200 || !Array.isArray(data?.provinces) || !Array.isArray(data?.industries))
    throw Error('HKD REST regression detected');

  await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
  if(await page.locator('#user_login').isVisible().catch(()=>false)){
    await page.locator('#user_login').fill(username);
    await page.locator('#user_pass').fill(password);
    const match=(await page.locator('body').innerText()).match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
    if(match) {
      const a=+match[1],b=+match[3];
      const answer=match[2]==='+'?a+b:match[2]==='-'?a-b:a*b;
      let field=page.locator('#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[type="number"]').first();
      if(!await field.count()) {
        const candidates=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
        if(await candidates.count()===1)field=candidates.first();
      }
      if(!await field.count())throw Error('Unsupported CAPTCHA');
      await field.fill(String(answer));
    }
    await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
  }
  if(page.url().includes('wp-login.php')||await page.locator('#login_error').isVisible().catch(()=>false))
    throw Error('WP login failed');
  await page.goto(origin+'/wp-admin/admin.php?page=esc-hkd-google',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('heading',{name:'Cấu hình bản đồ Hộ kinh doanh'}).waitFor({timeout:20000});
  if(!await page.locator('#esc-hkd-google-key').isVisible())throw Error('Google Maps key field missing');
  if(!await page.locator('#esc-hkd-google-map-id').isVisible())throw Error('Google Maps Map ID field missing');
  if(await page.locator('#esc-hkd-goong-key').count())throw Error('Legacy map key field still visible');
  console.log('HKD Google Maps WordPress Admin PASS; REST references unchanged; keys redacted');
} finally {await browser.close();}
