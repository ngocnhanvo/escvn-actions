import { chromium } from 'playwright';

const raw=process.env.WP_ADMIN_URL;
const username=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
if(!raw||!username||!password)throw Error('Missing WordPress admin credentials');
const origin=new URL(raw.includes('://')?raw:'https://'+raw).origin;
if(origin!=='https://admin.esc.vn')throw Error('Unexpected WordPress origin');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
try{
 await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
 if(await page.locator('#user_login').isVisible().catch(()=>false)){
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  const body=await page.locator('body').innerText();
  const m=body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
  if(m){
   const a=Number(m[1]),b=Number(m[3]);
   const answer=m[2]==='+'?a+b:m[2]==='-'?a-b:a*b;
   let field=page.locator('#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[type="number"]').first();
   if(!(await field.count())){
    const fields=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
    if((await fields.count())!==1)throw Error('Unsupported login challenge');
    field=fields.first();
   }
   await field.fill(String(answer));
  }
  await page.locator('#wp-submit').click();
  await page.waitForLoadState('domcontentloaded');
 }
 if(page.url().includes('wp-login.php')||await page.locator('#login_error').isVisible().catch(()=>false))
  throw Error('WordPress admin login failed');
 const pageUrl=origin+'/wp-admin/tools.php?page=esc-hkd-coordinates';
 await page.goto(pageUrl,{waitUntil:'domcontentloaded',timeout:60000});
 const status=page.locator('#hkd-coordinate-schema-status');
 await status.waitFor({state:'visible',timeout:15000});
 if((await status.getAttribute('data-ready'))!=='1'){
  const button=page.getByRole('button',{name:'Bổ sung cột tọa độ'});
  await button.click();
  await page.waitForLoadState('domcontentloaded');
  await status.waitFor({state:'visible',timeout:20000});
 }
 if((await status.getAttribute('data-ready'))!=='1')
  throw Error('HKD registration coordinates schema still missing');
 console.log('HKD registration latitude/longitude schema READY; only additive nullable columns');
}finally{await browser.close()}
