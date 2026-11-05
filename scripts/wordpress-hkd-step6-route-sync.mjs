import {chromium} from 'playwright';

const raw=process.env.WP_ADMIN_URL,username=process.env.WP_ADMIN_USERNAME,password=process.env.WP_ADMIN_PASSWORD;
if(!raw||!username||!password) throw Error('Missing WP Admin credentials');
const origin=new URL(raw.includes('://')?raw:'https://'+raw).origin;
if(origin!=='https://admin.esc.vn') throw Error('Wrong WordPress host');
const record=55522, expected='/ban-do-ho-kinh-doanh';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1380,height:960}});
const page=await context.newPage();
const guest=context.request;
try{
  const list=await guest.get(origin+'/wp-json/wp/v2/chuyen-huong-link/'+record,{timeout:45000});
  if(list.status()!==200)throw Error('Target route missing in WordPress');
  const original=await list.json();
  if(original.status!=='publish'||original.acf?.from_link!==expected||
     original.acf?.to_link!=='/ban-do-ho-kinh-doanh/index.html'||
     original.acf?.type!=='Rewrite'||original.acf?.match_type!=='Exact'||original.acf?.enable!==true){
    throw Error('Unexpected WordPress routing metadata; no changes made');
  }

  await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
  if(await page.locator('#user_login').isVisible().catch(()=>false)){
    await page.locator('#user_login').fill(username);
    await page.locator('#user_pass').fill(password);
    const body=await page.locator('body').innerText();
    const match=body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
    if(match){
      const a=Number(match[1]),b=Number(match[3]);
      const answer=match[2]==='+'?a+b:match[2]==='-'?a-b:a*b;
      let target=page.locator('#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[type="number"]').first();
      if(await target.count()===0){
        const fields=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
        if(await fields.count()===1)target=fields.first();
      }
      if(await target.count()===0)throw Error('Unsupported CAPTCHA');
      await target.fill(String(answer));
    }
    await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
  }
  if(page.url().includes('wp-login.php')||await page.locator('#login_error').isVisible().catch(()=>false))throw Error('Cannot authenticate WP admin');

  await page.goto(origin+'/wp-admin/post.php?post='+record+'&action=edit',{waitUntil:'domcontentloaded',timeout:60000});
  const from=page.locator('input[name="acf[field_esc_route_from_link]"]');
  const to=page.locator('input[name="acf[field_esc_route_to_link]"]');
  if(!(await from.count())||!(await to.count()))throw Error('Missing expected ACF form; no changes made');
  if(await from.inputValue()!==expected || await to.inputValue()!=='/ban-do-ho-kinh-doanh/index.html'){
    throw Error('WP edit form does not match expected route; no changes made');
  }
  const update=page.locator('#publish').first();
  if(!await update.isVisible())throw Error('Cannot find Save/Update control');
  await Promise.all([page.waitForLoadState('domcontentloaded'),update.click()]);
  console.log('HKD WordPress route re-saved with existing values');

  const check=await guest.get(origin+'/wp-json/wp/v2/chuyen-huong-link/'+record,{timeout:45000});
  const after=await check.json();
  if(check.status()!==200||after.acf?.from_link!==expected||after.acf?.to_link!=='/ban-do-ho-kinh-doanh/index.html'||after.acf?.type!=='Rewrite'||after.acf?.enable!==true){
    throw Error('Route changed unexpectedly after save');
  }
  const resp=await guest.get(origin+'/wp-json/astro/v1/get-redirect-logs',{timeout:45000});
  const logs=await resp.json();
  if(resp.status()!==200||!Array.isArray(logs))throw Error('Redirect logs unavailable');
  const event=logs.find(item=>Number(item.id)===record && item.action==='modify');
  if(!event)throw Error('WP route saved but incremental redirect event missing');
  if(event.redirect?.from_link!==expected || event.redirect?.to_link!=='/ban-do-ho-kinh-doanh/index.html'||!event.redirect?.enable){
    throw Error('Event redirect payload differs from published route');
  }
  console.log('HKD route event PASS: published route #55522 now appears in incremental WordPress redirect logs');
}finally{await browser.close()}
