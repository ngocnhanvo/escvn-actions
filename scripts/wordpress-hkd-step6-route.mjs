import {chromium} from 'playwright';

const raw=process.env.WP_ADMIN_URL,user=process.env.WP_ADMIN_USERNAME,password=process.env.WP_ADMIN_PASSWORD;
if(!raw||!user||!password)throw Error('Missing WP Admin login secrets');
const origin=new URL(raw.includes('://')?raw:'https://'+raw).origin;
if(origin!=='https://admin.esc.vn')throw Error('Invalid WordPress origin');
const source='/ban-do-ho-kinh-doanh',target='/ban-do-ho-kinh-doanh/index.html';
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:1024}});
const page=await ctx.newPage();
const visible=async selector=>page.locator(selector).first().isVisible().catch(()=>false);
function math(s){const x=s.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);if(!x)return null;return x[2]==='+'?+x[1]+ +x[3]:x[2]==='-'?+x[1]- +x[3]:+x[1]* +x[3]}
try{
 await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
 if(await visible('#user_login')){
  await page.locator('#user_login').fill(user);await page.locator('#user_pass').fill(password);
  const answer=math(await page.locator('body').innerText());
  if(answer!==null){
   let field=page.locator('#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[type="number"]').first();
   if(await field.count()===0){
    const candidates=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
    if(await candidates.count()===1)field=candidates.first();
   }
   if(await field.count()===0)throw Error('Unknown CAPTCHA');
   await field.fill(String(answer));
  }
  await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
 }
 if(page.url().includes('wp-login.php')||await visible('#login_error'))throw Error('WordPress admin login failed');
 // Prevent duplicates; published rule exact match is sufficient.
 const listing=await ctx.request.get(origin+'/wp-json/wp/v2/chuyen-huong-link?per_page=100&page=1',{timeout:45000});
 if(listing.status()===200){
  const routes=await listing.json();
  if(Array.isArray(routes)&&routes.some(r=>r?.redirect?.from_link===source||r?.acf?.from_link===source)){
   console.log('HKD URL route already exists; no duplicate will be created');
   return;
  }
 }
 await page.goto(origin+'/wp-admin/post-new.php?post_type=chuyen-huong-link',{waitUntil:'domcontentloaded',timeout:60000});
 const title=page.locator('#title,.editor-post-title__input,[aria-label="Add title"],[aria-label="Thêm tiêu đề"]').first();
 await title.waitFor({timeout:30000});
 await title.fill('Bản đồ hộ kinh doanh — URL nội bộ');
 const fields={
  from:'input[name="acf[field_esc_route_from_link]"]',
  to:'input[name="acf[field_esc_route_to_link]"]',
  type:'select[name="acf[field_esc_route_type]"]',
  match:'select[name="acf[field_esc_route_match_type]"]',
  enable:'input[name="acf[field_esc_route_enable]"]'
 };
 const from=page.locator(fields.from);
 await from.waitFor({state:'attached',timeout:20000});
 if(await page.locator(fields.to).count()!==1||await page.locator(fields.type).count()!==1||await page.locator(fields.match).count()!==1)throw Error('Unexpected WordPress ACF route form');
 await from.fill(source);
 await page.locator(fields.to).fill(target);
 await page.locator(fields.type).selectOption('Rewrite');
 await page.locator(fields.match).selectOption('Exact');
 const enable=page.locator(fields.enable);
 if(await enable.count() && await enable.getAttribute('type')==='checkbox' && !(await enable.isChecked()))await enable.check();
 const classic=page.locator('#publish');
 if(await classic.isVisible().catch(()=>false)){
  await Promise.all([page.waitForLoadState('domcontentloaded'),classic.click()]);
 }else{
  const publish=page.getByRole('button',{name:/^(Publish|Đăng|Đăng bài)$/}).first();
  if(!await publish.count())throw Error('No WordPress Publish action');
  await publish.click();
  const confirmation=page.getByRole('button',{name:/^(Publish|Đăng|Đăng bài)$/}).last();
  if(await confirmation.isVisible().catch(()=>false))await confirmation.click();
 }
 console.log('HKD Step6 route WordPress submission made');
 // Ensure the actual route metadata is now present through public WordPress CPT API.
 const check=await ctx.request.get(origin+'/wp-json/wp/v2/chuyen-huong-link?per_page=100&page=1',{timeout:45000});
 if(check.status()!==200)throw Error('Cannot confirm routing list');
 const items=await check.json();
 const match=Array.isArray(items)?items.find(r=>r?.redirect?.from_link===source||r?.acf?.from_link===source):null;
 if(!match)throw Error('Created route not visible in WordPress REST');
 const dest=match.redirect?.to_link||match.acf?.to_link;
 const type=match.redirect?.type||match.acf?.type;
 if(dest!==target||String(type).toLowerCase()!=='rewrite')throw Error('Route metadata mismatched');
 console.log('HKD Step6 WordPress route VERIFIED: exact internal rewrite to index.html');
}finally{await browser.close()}
