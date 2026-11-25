import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const origin='https://admin.esc.vn';
const title='BLACK FRIDAY – SĂN DEAL VÀNG GIÁ KỊCH SÀN';
const detailTitle='BLACK FRIDAY - SĂN DEAL VÀNG GIÁ KỊCH SÀN';
const image='/wp-content/uploads/2026/11/ESC_BlackFriday_Web_1350x400.webp';
const previousTitle='TRI ÂN NGÀY NHÀ GIÁO VIỆT NAM 20/11';
const wp=process.env.WP_ADMIN_URL;
assert.ok(wp && process.env.WP_ADMIN_USERNAME && process.env.WP_ADMIN_PASSWORD,'Missing WordPress credentials');
assert.equal(new URL(wp.startsWith('http')?wp:'https://'+wp).origin,origin);

const browser=await chromium.launch({headless:true});
const context=await browser.newContext();
const page=await context.newPage();
const visible=async loc=>loc.first().isVisible().catch(()=>false);
async function login(){
 await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
 if(await visible(page.locator('#user_login'))){
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  const body=await page.locator('body').innerText();
  const m=body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/i);
  if(m){
   const a=Number(m[1]),b=Number(m[3]),v=m[2]==='+'?a+b:m[2]==='-'?a-b:a*b;
   const input=page.locator('#loginform input[name*="captcha" i], #loginform input[id*="captcha" i], #loginform input[name*="math" i], #loginform input[type="number"]').first();
   assert.ok(await visible(input),'Login CAPTCHA control unavailable');
   await input.fill(String(v));
  }
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),page.locator('#wp-submit').click()]);
 }
 assert.ok(page.url().includes('/wp-admin/')&&!page.url().includes('wp-login'),'WordPress login failed');
}

// Only modify the existing EDU20 card in the real WordPress /khuyen-mai page.
// Do not add a grid item, modify an unrelated card, or create a test Page.
function replaceCampaign({original,title,detailTitle,image,previousTitle}){
 const root=document.createElement('div');root.innerHTML=original;
 const norm=s=>String(s||'').replace(/\s+/g,' ').trim().toLocaleLowerCase('vi');
 const headings=[...root.querySelectorAll('h2')];
 const findHeading=text=>headings.filter(el=>norm(el.textContent)===norm(text));
 const previous=findHeading(previousTitle);
 const blackFriday=findHeading(title);
 if(blackFriday.length===1 && previous.length===0){
  const existing=blackFriday[0].parentElement?.parentElement?.parentElement;
  const modal=existing?.querySelector('.esc-modal-content');
  const items=[...existing?.querySelectorAll('li.mceEditable')||[]].map(el=>norm(el.textContent));
  if(!modal?.textContent.includes('eCloud1'))throw Error('Black Friday popup structure differs');
  const list=[...existing.querySelectorAll('ul')].filter(ul=>!modal.contains(ul)).find(ul=>[...ul.children].some(li=>norm(li.textContent).includes('mã km: bf2026')||norm(li.textContent).includes('bfh2026')));
  if(!list||list.children.length!==6)throw Error('Expected exactly six Black Friday summary lines');
  if(norm(list.textContent).includes('bfh2026')&&norm(list.textContent).includes('bfv2026')
     &&norm(modal.textContent).includes('bfh2026')&&norm(modal.textContent).includes('bfv2026')
     &&!norm(list.textContent).includes('mã km: bf2026')&&!norm(modal.textContent).includes('mã km: bf2026')){
    const rows=[...list.children].map(x=>norm(x.textContent));
    if(rows[4].startsWith('email:')&&rows[5].startsWith('liên hệ: 1900 2069')&&!rows[5].includes(';')){
      return {changed:false,html:original};
    }
  }

  const bullet=[...list.children].find(el=>el.classList.contains('mceEditable')&&el.querySelector('span')&&el.style.fontSize);
  if(!bullet)throw Error('Cannot inherit existing promotion card typography');
  const desired=[
    'Giảm giá&nbsp;<strong>70%</strong>&nbsp;cho&nbsp;<strong>Hosting và Email</strong> – mã&nbsp;<strong>BFH2026</strong>',
    'Giảm giá&nbsp;<strong>30%</strong>&nbsp;cho&nbsp;<strong>VPS</strong> – mã&nbsp;<strong>BFV2026</strong>',
    'Áp dụng: từ ngày 25-29/11/2026',
    'Hỗ trợ 24/7',
    'Email: <a href="mailto:cskh@esc.vn" style="color:inherit;text-decoration:underline">cskh@esc.vn</a>',
    'Liên hệ: 1900 2069'
  ];
  const bullets=document.createDocumentFragment();
  for(const html of desired){
   const li=bullet.cloneNode(true);
   const tick=li.querySelector('span');
   if(!tick)throw Error('Missing Black Friday checkmark icon');
   const content=document.createElement('span');content.innerHTML=html;
   li.replaceChildren(tick,...content.childNodes);
   bullets.appendChild(li);
  }
  const firstModalList=[...modal.querySelectorAll('ul')].find(ul=>[...ul.children].some(li=>norm(li.textContent).includes('giảm')&&norm(li.textContent).includes('hosting')));
  if(!firstModalList||firstModalList.children.length!==3||!norm(firstModalList.textContent).includes('bf2026')&&!norm(firstModalList.textContent).includes('bfh2026'))throw Error('Expected original Black Friday popup offer list');
  const createModalLi=html=>{const li=document.createElement('li');li.innerHTML=html;return li};
  const modalItems=[
   createModalLi('Giảm giá&nbsp;<strong>70%</strong>&nbsp;cho&nbsp;<strong>Hosting và Email</strong> – mã&nbsp;<strong>BFH2026</strong>'),
   createModalLi('Giảm giá&nbsp;<strong>30%</strong>&nbsp;cho&nbsp;<strong>VPS (*)</strong> – mã&nbsp;<strong>BFV2026</strong>')
  ];
  const unchangedSummary=list.textContent;
  const unchangedModal=firstModalList.textContent;
  list.replaceChildren(bullets);
  firstModalList.replaceChildren(...modalItems);
  if(norm(existing.textContent).includes('mã km: bf2026'))throw Error('Single-code Black Friday promotion was not removed');
  if(!existing.textContent.includes('BFH2026')||!existing.textContent.includes('BFV2026'))throw Error('Black Friday separate coupon codes missing');
  if(list.children.length!==6||list.children[4].textContent.indexOf('Email:')<0||list.children[5].textContent.indexOf('Liên hệ:')<0)throw Error('Email/contact ordering incorrect');
  const html=root.innerHTML;
  return {changed:html!==original,html};
 }
 if(previous.length!==1||blackFriday.length!==0)throw Error('Expected exactly one EDU20 card to replace; refusing to change unrelated promotions');
 const heading=previous[0],header=heading.parentElement,inside=header?.parentElement,card=inside?.parentElement;
 const wrapper=card?.parentElement,grid=wrapper?.parentElement;
 if(!card||!wrapper||!grid||grid.children.length!==7||card!==wrapper.firstElementChild||wrapper.children.length!==1)throw Error('Unexpected 7-card promotion grid');
 if(!/flex-wrap:\s*wrap/i.test(grid.getAttribute('style')||'')||!/max-width:\s*330px/i.test(wrapper.getAttribute('style')||''))throw Error('Promotion grid structure has changed');
 const beforeHeaders=[...grid.children].map(w=>w.querySelector('h2')?.textContent.trim());
 if(beforeHeaders.filter(x=>x===previousTitle).length!==1)throw Error('EDU20 promotion is not unique within grid');
 const cta=[...card.querySelectorAll('a')].find(a=>norm(a.textContent)==='đăng ký ngay');
 if(!cta)throw Error('Registration CTA missing on original card');
 const target=new URL(cta.getAttribute('href'),origin).pathname;
 if(target!=='/dang-ky-ten-mien')throw Error('Original registration URL differs; refusing to change CTA');
 const modal=card.querySelector('.esc-modal-content');
 const overlay=card.querySelector('.esc-modal-overlay');
 const close=modal?.querySelector('label.esc-modal-close');
 const modalTitle=modal?.querySelector('h2');
 if(!modal||!overlay||!close||!modalTitle||!card.querySelector('input[type="checkbox"]'))throw Error('Original promotion modal controls missing');
 // Reuse the existing modal header/close/toggle; do not change their IDs or CSS behavior.
 heading.textContent=title;
 const modalTitleClone=modalTitle.cloneNode(true);
 modalTitleClone.textContent=detailTitle;
 const closeClone=close.cloneNode(true);
 const body=document.createElement('div');
 body.className='bf2026-promotion-description';
 body.style.cssText='line-height:1.75;text-align:left';
 body.innerHTML=[
  '<img src="'+image+'" alt="ESC Black Friday 2026 – Săn deal vàng giá kịch sàn" loading="lazy" style="display:block;width:100%;height:auto;border-radius:10px;margin:16px 0 20px">',
  '<p style="margin:0 0 14px">Kính gửi Quý khách hàng,</p>',
  '<p style="margin:0 0 14px">ESC trân trọng thông báo về chương trình khuyến mại dành cho tất các các khách hàng:</p>',
  '<p style="font-weight:700;margin:14px 0">BLACK FRIDAY - SĂN DEAL VÀNG GIÁ KỊCH SÀN</p>',
  '<ul style="list-style:disc;padding-left:24px;margin:10px 0 18px">',
  '<li>Giảm <strong>70%</strong> cho <strong>Hosting và Email</strong></li>',
  '<li>Giảm <strong>30%</strong> cho <strong>VPS (*)</strong></li>',
  '<li>Mã KM: <strong>BF2026</strong></li>',
  '</ul>',
  '<h3 style="font-weight:700;margin:18px 0 10px">Cách thức tham gia:</h3>',
  '<ul style="list-style:disc;padding-left:24px;margin:0 0 18px">',
  '<li>Truy cập website <a href="https://esc.vn" style="color:#00377a;text-decoration:underline">https://esc.vn</a></li>',
  '<li>Lựa chọn dịch vụ mình cần đăng ký</li>',
  '<li>Tiến hành đặt hàng và thanh toán</li>',
  '<li>ESC tiến hành cấp phát sau khi nhận được đơn hàng</li>',
  '</ul>',
  '<h3 style="font-weight:700;margin:18px 0 10px">Thời gian áp dụng:</h3>',
  '<ul style="list-style:disc;padding-left:24px;margin:0 0 18px"><li>Từ ngày 25-29/11/2026</li></ul>',
  '<h3 style="font-weight:700;margin:18px 0 10px">Thông tin liên hệ:</h3>',
  '<ul style="list-style:disc;padding-left:24px;margin:0 0 18px">',
  '<li>Hotline: <a href="tel:19002069" style="color:#00377a;text-decoration:underline">1900 2069</a></li>',
  '<li>Email: <a href="mailto:cskh@esc.vn" style="color:#00377a;text-decoration:underline">cskh@esc.vn</a></li>',
  '</ul>',
  '<p style="font-style:italic;margin:10px 0 18px">Lưu ý: (*): gói VPS áp dụng giảm 30% cho gói eCloud1 trở lên</p>',
  '<p style="margin:0 0 15px">Chúng tôi rất mong nhận được sự ủng hộ và tham gia của Quý khách hàng.</p>',
  '<p style="margin:0">Phòng Kinh doanh</p>',
  '<p style="font-weight:700;margin:0 0 10px">Công ty TNHH Giải Pháp Trực Tuyến</p>',
 ].join('');
 modal.replaceChildren(closeClone,modalTitleClone,body);
 const lists=[...inside.querySelectorAll('ul')].filter(ul=>!modal.contains(ul));
 const offer=lists.find(ul=>[...ul.children].some(li=>norm(li.textContent).includes('mã km: edu20')));
 if(!offer||offer.children.length!==4)throw Error('Expected original EDU20 summary list with four items');
 const template=[...offer.querySelectorAll('li.mceEditable')].find(li=>li.querySelector('span')&&li.style.fontSize&&li.style.color);
 if(!template)throw Error('Cannot inherit matching promotion typography');
 const bullets=[
  'Giảm <strong>70%</strong> cho <strong>Hosting và Email</strong>',
  'Giảm <strong>30%</strong> cho <strong>VPS</strong>',
  'Mã KM: <strong>BF2026</strong>',
  'Áp dụng: từ ngày 25-29/11/2026',
  'Hỗ trợ 24/7',
  'Liên hệ: 1900 2069; email: <a href="mailto:cskh@esc.vn" style="color:inherit;text-decoration:underline">cskh@esc.vn</a>'
 ];
 const summary=document.createDocumentFragment();
 for(const html of bullets){
  const li=template.cloneNode(true);
  const tick=li.querySelector('span');
  if(!tick)throw Error('Offer tick missing');
  const tmp=document.createElement('span');tmp.innerHTML=html;
  li.replaceChildren(tick,...[...tmp.childNodes]);
  summary.appendChild(li);
 }
 offer.replaceChildren(summary);
 if(!norm(card.textContent).includes(norm(title))||!norm(card.textContent).includes('bf2026')||norm(card.textContent).includes('edu20'))throw Error('Black Friday card replacement did not complete');
 if(grid.children.length!==7 || [...grid.children].filter(w=>w.querySelector('h2')?.textContent.trim()===title).length!==1)throw Error('Unexpected card count after update');
 const afterHeaders=[...grid.children].map(w=>w.querySelector('h2')?.textContent.trim());
 if(beforeHeaders.some((h,i)=>i!==beforeHeaders.indexOf(previousTitle)&&h!==afterHeaders[i]))throw Error('Another promotion card heading was changed');
 const html=root.innerHTML;
 if(!html.includes(image)||!html.includes('BF2026')||!html.includes('25-29/11/2026'))throw Error('Black Friday HTML incomplete');
 return {changed:html!==original,html};
}

try{
 await login();
 const asset=await context.request.get(origin+image,{timeout:45000});
 assert.equal(asset.status(),200,'Black Friday banner not found in WordPress uploads');
 assert.ok((asset.headers()['content-type']||'').startsWith('image/'),'Banner is not an image');
 console.log('BF2026_BANNER_FOUND',asset.status(),asset.headers()['content-type']);
 const response=await context.request.get(origin+'/wp-json/wp/v2/pages?slug=khuyen-mai&per_page=20',{timeout:45000});
 assert.equal(response.status(),200,'WordPress Pages REST unavailable');
 const matches=(await response.json()).filter(x=>x.slug==='khuyen-mai'&&x.status==='publish');
 assert.equal(matches.length,1,'Expected one published /khuyen-mai page');
 const id=matches[0].id;
 await page.goto(origin+'/wp-admin/post.php?post='+id+'&action=edit',{waitUntil:'domcontentloaded',timeout:60000});
 const slug=await page.evaluate(()=>document.querySelector('#post_name')?.value||document.querySelector('#editable-post-name-full')?.textContent?.trim()||'');
 const permalink=await page.locator('#sample-permalink').innerText().catch(()=>'');
 assert.ok(slug==='khuyen-mai'||permalink.includes('khuyen-mai'),'Wrong WordPress Page');
 const editor=page.locator('textarea#content');
 assert.equal(await editor.count(),1,'WordPress classic content editor missing');
 const before=await editor.inputValue();
 assert.ok(before.includes(previousTitle)||before.includes(title),'Promotion to replace not found in Page content');
 const out=await page.evaluate(replaceCampaign,{original:before,title,detailTitle,image,previousTitle});
 console.log('BF2026_PRECHECK',JSON.stringify({page_id:id,changed:out.changed,original_length:before.length,updated_length:out.html.length}));
 if(out.changed){
  if(await visible(page.locator('#content-html')))await page.locator('#content-html').click();
  await editor.evaluate((el,html)=>{el.value=html;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));},out.html);
  assert.equal(await editor.inputValue(),out.html,'WordPress editor did not receive content');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),page.locator('#publish').click()]);
  await page.goto(origin+'/wp-admin/post.php?post='+id+'&action=edit',{waitUntil:'domcontentloaded',timeout:60000});
 }
 const saved=await page.locator('textarea#content').inputValue();
 for(const fragment of [title,detailTitle,image,'BFH2026','BFV2026','70%','30%','25-29/11/2026','eCloud1','cskh@esc.vn','DEAL HOT KHÔNG THỂ BỎ LỠ'])assert.ok(saved.includes(fragment),'Post-save fragment missing: '+fragment);
 assert.ok(!saved.includes(previousTitle),'Former EDU20 card title remains');
 assert.ok(!saved.includes('>BF2026<'),'Obsolete BF2026 coupon remains');
 const pageData=(await (await context.request.get(origin+'/wp-json/wp/v2/pages/'+id,{timeout:45000})).json());
 assert.equal(pageData.status,'publish','Promotion Page unexpectedly unpublished');
 assert.ok(pageData.content.rendered.includes('BFH2026')&&pageData.content.rendered.includes('BFV2026'),'WordPress REST readback missing split Black Friday coupons');
 console.log('BF2026_CMS_PASS',JSON.stringify({page_id:id,changed:Number(out.changed),skipped_unchanged:Number(!out.changed),temporary_created:0,cleanup_remaining:0}));
}finally{await context.close();await browser.close();}
