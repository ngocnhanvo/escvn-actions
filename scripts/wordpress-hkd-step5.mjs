import { chromium } from 'playwright';

const raw=process.env.WP_ADMIN_URL;
const user=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
if(!raw||!user||!password) throw new Error('WordPress credentials unavailable');
const origin=new URL(raw.includes('://')?raw:'https://'+raw).origin;
if(origin!=='https://admin.esc.vn') throw new Error('Wrong WordPress origin');

const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({ignoreHTTPSErrors:false});
const page=await ctx.newPage();
const visible=async s=>page.locator(s).first().isVisible().catch(()=>false);
const path=s=>origin+s;
function arithmetic(body){
  const m=body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
  if(!m)return null;
  return m[2]==='+'?+m[1]+ +m[3]:m[2]==='-'?+m[1]- +m[3]:+m[1]* +m[3];
}
try{
  // Anonymous users must not access admin pages or actions.
  const guest=await browser.newContext();
  const guestBiz=await guest.request.get(path('/wp-admin/admin.php?page=esc-hkd-businesses'),{timeout:45000,maxRedirects:0});
  if(guestBiz.status()!==302&&guestBiz.status()!==301&&guestBiz.status()!==403)
    throw new Error('Anonymous HKD admin access was not denied: '+guestBiz.status());
  const guestPost=await guest.request.post(path('/wp-admin/admin-post.php'),{
    form:{action:'esc_hkd_review',id:'bad',decision:'approve'},timeout:45000,maxRedirects:0
  });
  if(guestPost.status()!==400 && guestPost.status()!==403 && guestPost.status()!==404 && guestPost.status()!==302)
    throw new Error('Anonymous approval response unexpected: '+guestPost.status());
  await guest.close();
  console.log('HKD Step5 anonymous restriction PASS');

  await page.goto(path('/wp-admin/'),{waitUntil:'domcontentloaded',timeout:60000});
  if(await visible('#user_login')){
    await page.locator('#user_login').fill(user);
    await page.locator('#user_pass').fill(password);
    const answer=arithmetic(await page.locator('body').innerText());
    if(answer!==null){
      const select='#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[name*="math" i], #loginform input[id*="math" i], #loginform input[type="number"]';
      let target=page.locator(select).first();
      if(await target.count()===0){
        const candidate=page.locator('#loginform input:visible:not(#user_login):not(#user_pass):not(#wp-submit):not([type="hidden"]):not([type="checkbox"]):not([type="submit"])');
        if(await candidate.count()===1)target=candidate.first();
      }
      if(await target.count()===0)throw new Error('Unsupported CAPTCHA');
      await target.fill(String(answer));
    }
    await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
  }
  if(page.url().includes('wp-login.php')||await visible('#login_error'))throw new Error('WordPress login failed');
  console.log('HKD Step5 WordPress admin authentication PASS');

  const fetchAdmin=async url=>{
    const r=await ctx.request.get(path(url),{timeout:45000});
    if(r.status()!==200)throw new Error('Unexpected admin HTTP status '+r.status());
    const body=await r.text();
    if(body.includes('id="user_login"')||body.includes('name="log"'))throw new Error('Admin session not authorized');
    return body;
  };
  const biz=await fetchAdmin('/wp-admin/admin.php?page=esc-hkd-businesses');
  if(!biz.includes('Danh sách hộ kinh doanh')||!biz.includes('Chưa có hồ sơ.')||!biz.includes('esc-hkd-businesses'))
    throw new Error('Businesses admin list missing or not empty');
  const regs=await fetchAdmin('/wp-admin/admin.php?page=esc-hkd-registrations');
  if(!regs.includes('Đơn đăng ký hộ kinh doanh')||!regs.includes('Không có đơn.')||!regs.includes('Chờ duyệt'))
    throw new Error('Registrations admin list missing or not empty');

  // No fake registrations are inserted; verify exact API baseline remains unmodified.
  const api=await ctx.request.get(path('/wp-json/esc-hkd/v1/meta'),{timeout:45000});
  const data=await api.json();
  if(api.status()!==200||data.stats?.businesses!==0||data.provinces?.length!==34||data.industries?.length!==15)
    throw new Error('Public REST regression or production data changed');
  console.log('HKD Step5 PASS: admin-only menus; businesses/registrations empty; public REST unchanged; no data inserted');
}finally{
  await browser.close();
}
