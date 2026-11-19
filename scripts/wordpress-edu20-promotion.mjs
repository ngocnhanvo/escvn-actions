import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const origin='https://admin.esc.vn';
const title='TRI ÂN NGÀY NHÀ GIÁO VIỆT NAM 20/11';
const image='/wp-content/uploads/2026/11/khuyen-mai-ngay-nha-giao-viet-nam.jpg';
const wp=process.env.WP_ADMIN_URL;
assert.ok(wp && process.env.WP_ADMIN_USERNAME && process.env.WP_ADMIN_PASSWORD,'Missing WordPress credentials');
assert.equal(new URL(wp.startsWith('http')?wp:'https://'+wp).origin,origin);
const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
const page=await context.newPage();
const visible=async l=>l.first().isVisible().catch(()=>false);
async function login(){
 await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
 if(await visible(page.locator('#user_login'))){
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  const text=await page.locator('body').innerText();
  const m=text.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
  if(m){
   const a=+m[1],b=+m[3],value=m[2]==='+'?a+b:m[2]==='-'?a-b:a*b;
   const input=page.locator('#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[name*="math" i],#loginform input[type="number"]').first();
   assert.ok(await input.count(),'Unsupported CAPTCHA');
   await input.fill(String(value));
  }
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),page.locator('#wp-submit').click()]);
 }
 assert.ok(page.url().includes('/wp-admin/'),'WordPress login failed');
}

function build({original,title,image}){
 const root=document.createElement('div');root.innerHTML=original;
 const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLocaleLowerCase('vi');
 if(norm(root.textContent).includes(norm(title)))return {changed:false,html:original};
 const heading=[...root.querySelectorAll('h2,h3,h4')].find(el=>norm(el.textContent).includes('deal hot không thể bỏ lỡ'));
 if(!heading)throw Error('Reference promotion heading not found');
 let card=null;
 for(let el=heading.parentElement;el&&el!==root;el=el.parentElement){
  const t=norm(el.textContent);
  if(t.includes('xem chi tiết')&&t.includes('đăng ký ngay')&&el.querySelectorAll('h2,h3,h4').length<=5&&t.length<4000){card=el;break;}
 }
 if(!card)throw Error('Reference card structure not safely identified');
 const copy=card.cloneNode(true);
 const cardTitle=[...copy.querySelectorAll('h2,h3,h4')].find(el=>norm(el.textContent).includes('deal hot không thể bỏ lỡ'));
 if(!cardTitle)throw Error('Reference title missing');
 cardTitle.textContent=title;
 const ids=new Map();
 for(const el of copy.querySelectorAll('[id]')){if(el.id){const next=el.id+'-edu20';ids.set(el.id,next);el.id=next;}}
 for(const el of copy.querySelectorAll('*')){
  for(const attr of ['for','aria-controls','aria-labelledby','href','name','onclick']){
   if(!el.hasAttribute(attr))continue;
   let val=el.getAttribute(attr);
   for(const [old,next] of ids){
    if(attr==='href'&&val==='#'+old)val='#'+next;
    else if(['for','aria-controls','aria-labelledby','name'].includes(attr)&&val===old)val=next;
    else if(attr==='onclick'&&val.includes(old))val=val.split(old).join(next);
   }
   el.setAttribute(attr,val);
  }
 }
 const modalHeading=[...copy.querySelectorAll('h2,h3,h4')].find(el=>norm(el.textContent).includes('thông báo chương trình khuyến mại'));
 if(!modalHeading)throw Error('Modal title missing');
 let modal=null;
 for(let el=modalHeading.parentElement;el&&el!==copy;el=el.parentElement){
  const t=norm(el.textContent);
  if(t.includes('kính gửi')&&t.includes('chương trình')&&!t.includes('hỗ trợ 24/7')&&!el.querySelector('input[type="checkbox"]')){modal=el;break;}
 }
 if(!modal)throw Error('Modal wrapper not safely identified');
 const close=[...modal.querySelectorAll('label,button,a')].find(el=>norm(el.textContent)==='×'||norm(el.getAttribute('aria-label')).includes('đóng'));
 if(!close)throw Error('Modal close control missing');
 const head=modalHeading.cloneNode(true);
 head.textContent='Tri ân Ngày Nhà giáo Việt Nam 20/11 – ESC tặng 20 tên miền .EDU.VN';
 modal.innerHTML=close.outerHTML+head.outerHTML+
  '<div class="edu20-promotion-description" style="line-height:1.75;text-align:left">'+
  '<img src="'+image+'" alt="Tri ân Ngày Nhà giáo Việt Nam 20/11 – ESC tặng 20 tên miền .EDU.VN" style="display:block;width:100%;height:auto;border-radius:12px;margin:16px 0 20px" loading="lazy">'+
  '<p style="margin:0 0 14px">Nhân Ngày Nhà giáo Việt Nam, ESC gửi lời tri ân đến quý thầy cô và những người đang công tác trong lĩnh vực giáo dục. Dịp này, ESC dành tặng 20 tên miền .EDU.VN để các tổ chức giáo dục có thêm lựa chọn khi xây dựng website giới thiệu đơn vị, đăng thông báo tuyển sinh hoặc chia sẻ thông tin với phụ huynh và học viên.</p>'+
  '<h3 style="font-weight:700;margin:18px 0 10px">Thông tin chương trình</h3>'+
  '<ul style="list-style:disc;padding-left:24px;margin:0 0 18px"><li><strong>Quà tặng</strong> – 20 tên miền .EDU.VN.</li><li><strong>Đối tượng</strong> – Các tổ chức hoạt động trong lĩnh vực giáo dục.</li><li><strong>Thời gian</strong> – Áp dụng duy nhất ngày 20/11/2026.</li></ul>'+
  '<p>Quý khách vui lòng nhập mã <strong>EDU20</strong> để đăng ký tại <a href="https://esc.vn/">https://esc.vn/</a> hoặc liên hệ <a href="tel:19002069">1900 2069</a> trong ngày 20/11 để được ESC tư vấn và hướng dẫn đăng ký nhận ưu đãi.</p></div>';
 const list=[...copy.querySelectorAll('ul')].filter(el=>!modal.contains(el)).find(el=>norm(el.textContent).includes('hỗ trợ 24/7')&&norm(el.textContent).includes('hotline'));
 if(!list)throw Error('Card bullet list not safely identified');
 const liClass=list.querySelector('li')?.getAttribute('class')||'';
 list.innerHTML=['Tặng 20 tên miền .EDU.VN','Mã KM: EDU20','Liên hệ: 1900 2069','Free Support 24/24'].map(s=>'<li'+(liClass?' class="'+liClass+'"':'')+'>✓ '+s+'</li>').join('');
 const cta=[...copy.querySelectorAll('a')].find(el=>norm(el.textContent)==='đăng ký ngay');
 const details=[...copy.querySelectorAll('label,button,a')].find(el=>norm(el.textContent)==='xem chi tiết');
 if(!cta||!details)throw Error('Original card controls not found');
 cta.setAttribute('href','/dang-ky-ten-mien');
 card.parentElement.insertBefore(copy,card);
 const html=root.innerHTML;
 if(!html.includes(image)||!html.includes('20/11/2026')||!html.includes('/dang-ky-ten-mien')||!norm(root.textContent).includes('deal hot không thể bỏ lỡ'))throw Error('Generated HTML incomplete');
 if(root.textContent.split(title).length!==2)throw Error('Duplicate title');
 return {changed:true,html};
}
try{
 await login();
 const asset=await context.request.get(origin+image,{timeout:45000});
 assert.equal(asset.status(),200,'Banner image not found in WordPress media');
 assert.ok((asset.headers()['content-type']||'').startsWith('image/'),'Banner response is not an image');
 const res=await context.request.get(origin+'/wp-json/wp/v2/pages?slug=khuyen-mai&per_page=20',{timeout:45000});
 assert.equal(res.status(),200,'WordPress Pages REST unavailable');
 const matches=(await res.json()).filter(x=>x.slug==='khuyen-mai'&&x.status==='publish');
 assert.equal(matches.length,1,'Expected exactly one published /khuyen-mai page');
 const id=matches[0].id;
 await page.goto(origin+'/wp-admin/post.php?post='+id+'&action=edit',{waitUntil:'domcontentloaded',timeout:60000});
 const slug=await page.evaluate(()=>document.querySelector('#post_name')?.value||document.querySelector('#editable-post-name-full')?.textContent?.trim()||'');
 const permalink=await page.locator('#sample-permalink').innerText().catch(()=>'');
 assert.ok(slug==='khuyen-mai'||permalink.includes('khuyen-mai'),'Wrong WordPress Page');
 const editor=page.locator('textarea#content');
 assert.equal(await editor.count(),1,'Classic WordPress content editor missing');
 const before=await editor.inputValue();
 assert.ok(before.includes('DEAL HOT')&&before.includes('Xem chi tiết')&&before.includes('Đăng ký ngay'),'Existing card markup not present in Editor');
 const out=await page.evaluate(build,{original:before,title,image});
 console.log('EDU20_PRECHECK',JSON.stringify({page_id:id,changed:out.changed,original_length:before.length,next_length:out.html.length}));
 if(out.changed){
  assert.ok(out.html.length>before.length,'Card insertion failed');
  if(await visible(page.locator('#content-html')))await page.locator('#content-html').click();
  await page.evaluate(()=>{if(typeof window.switchEditors?.go==='function')window.switchEditors.go('content','html');});
  await editor.evaluate((el,html)=>{el.value=html;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},out.html);
  assert.equal(await editor.inputValue(),out.html,'WordPress editor rejected HTML');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),page.locator('#publish').click()]);
  await page.goto(origin+'/wp-admin/post.php?post='+id+'&action=edit',{waitUntil:'domcontentloaded',timeout:60000});
  const saved=await page.locator('textarea#content').inputValue();
  for(const fragment of [title,image,'EDU20','20/11/2026','DEAL HOT','Tặng Tên Miền .IO.VN'])assert.ok(saved.includes(fragment),'Post-save content missing: '+fragment);
 }
 console.log('EDU20_CMS_PASS',JSON.stringify({page_id:id,changed:Number(out.changed),skipped_unchanged:Number(!out.changed),temporary_created:0,cleanup_remaining:0}));
}finally{await context.close();await browser.close();}
