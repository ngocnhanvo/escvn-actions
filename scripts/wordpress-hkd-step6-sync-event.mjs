import {chromium} from 'playwright';

const raw=process.env.WP_ADMIN_URL,user=process.env.WP_ADMIN_USERNAME,password=process.env.WP_ADMIN_PASSWORD;
if(!raw||!user||!password) throw Error('WordPress login secrets unavailable');
const origin=new URL(raw.includes('://')?raw:'https://'+raw).origin;
if(origin!=='https://admin.esc.vn') throw Error('Wrong WordPress origin');
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
const page=await context.newPage();
try{
  await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
  if(await page.locator('#user_login').isVisible().catch(()=>false)){
    await page.locator('#user_login').fill(user);
    await page.locator('#user_pass').fill(password);
    const x=(await page.locator('body').innerText()).match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
    if(x){
      const a=Number(x[1]),b=Number(x[3]);
      const v=x[2]==='+'?a+b:x[2]==='-'?a-b:a*b;
      let input=page.locator('#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[type="number"]').first();
      if(!(await input.count())){
        const c=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
        if(await c.count()===1)input=c.first();
      }
      if(!(await input.count()))throw Error('Unsupported CAPTCHA');
      await input.fill(String(v));
    }
    await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
  }
  if(page.url().includes('wp-login.php')||await page.locator('#login_error').isVisible().catch(()=>false))throw Error('Not authenticated');
  await page.goto(origin+'/wp-admin/tools.php?page=esc-hkd-route-sync-once',{waitUntil:'domcontentloaded',timeout:60000});
  await page.getByRole('heading',{name:'HKD route — one-time reconciliation'}).waitFor({timeout:20000});
  const button=page.locator('button[name="esc_hkd_sync_once"]');
  if(!(await button.count()))throw Error('Verified route preflight failed');
  await Promise.all([page.waitForLoadState('domcontentloaded'),button.click()]);
  await page.locator('#esc-hkd-sync-success').waitFor({timeout:20000});

  const resp=await context.request.get(origin+'/wp-json/astro/v1/get-redirect-logs',{timeout:45000});
  const events=await resp.json();
  if(resp.status()!==200||!Array.isArray(events))throw Error('Redirect logs unavailable');
  const e=events.find(x=>Number(x.id)===55522 && x.action==='modify');
  if(!e||e.redirect?.from_link!=='/ban-do-ho-kinh-doanh'||
     e.redirect?.to_link!=='/ban-do-ho-kinh-doanh/index.html'||
     e.redirect?.type!=='Rewrite'||!e.redirect?.enable)
    throw Error('Expected WordPress incremental routing event was not recorded');
  console.log('HKD route sync PASS: route #55522 modify event visible via WordPress redirect logs');
} finally {await browser.close()}
