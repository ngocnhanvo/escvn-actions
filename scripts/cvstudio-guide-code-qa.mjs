import { chromium } from 'playwright';
const origin='https://esc.vn';
const slug='huong-dan-chuan-hoa-mau-cv';
const url=origin+'/'+slug+'/';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1380,height:950}});
const assert=(v,m)=>{if(!v)throw Error(m);};
try {
 const wp=await page.request.get('https://admin.esc.vn/wp-json/wp/v2/posts?slug='+slug);
 assert(wp.ok(),'WordPress guide REST unavailable: '+wp.status());
 const posts=await wp.json();
 assert(posts.length===1,'Expected exactly one guide article');
 const content=posts[0].content?.rendered||'';
 const position=content.indexOf('profile.avatarUrl');
 console.log('WP_GUIDE',JSON.stringify({
   id:posts[0].id,slug:posts[0].slug,
   sourceExcerpt:content.slice(Math.max(0,position-75),position+120),
   escapedImage:content.includes('&lt;img'),
   rawImage:/<img\\s+src=.*profile\\.avatarUrl/.test(content)
 }));
 const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
 assert(response?.status()===200,'Website page status '+response?.status());
 const state=await page.evaluate(()=>{
   const section=document.getElementById('article-content')||document.querySelector('article')||document.body;
   const blocks=[...section.querySelectorAll('pre code')].map(el=>({
     text:el.textContent?.slice(0,600),html:el.innerHTML.slice(0,600),
     images:el.querySelectorAll('img').length
   }));
   const images=[...section.querySelectorAll('img')].filter(el=>
     (el.outerHTML+el.getAttribute('src')).includes('profile.avatarUrl')).map(el=>el.outerHTML);
   return {blocks,images};
 });
 console.log('SITE_CODE',JSON.stringify(state).slice(0,7000));
 if(process.env.QA_STRICT==='1'){
   assert(state.blocks.some(b=>b.text?.includes('<img src=')&&b.text.includes('{{profile.avatarUrl}}')),
     'The guide must display a literal <img> tag and ESC binding as code');
   assert(state.blocks.every(b=>b.images===0),
     'HTML code block contains a real image DOM node');
   assert(state.images.length===0,
     'ESC example became a real image element');
   console.log('CV GUIDE CODE RENDER PASS');
   const main=page.locator('#article-content');
   const bodyText=await main.innerText();
   for(const text of ['Tải mẫu ZIP chính thức','File index.html','sample-data.json','Prompt giao việc','Lỗi thường gặp']){
     assert(bodyText.includes(text),'New article section not available on esc.vn: '+text);
   }
   const headings=await main.locator('h2').count();
   assert(headings>=12,'Missing guide headings on live site: '+headings);
   const download=main.locator('a').filter({hasText:'Tải mẫu ZIP ESC CV v1 chính thức'}).first();
   assert(await download.count()===1,'Official sample download missing from site article');
   const href=new URL(await download.getAttribute('href'),url);
   assert(href.hostname==='admin.esc.vn' && href.pathname.endsWith('.zip'),
     'ZIP link must resolve to WordPress uploads, not esc.vn: '+href.href);
   const zipResponse=await page.request.get(href.href,{timeout:35000});
   assert(zipResponse.ok(),'Official sample ZIP download HTTP '+zipResponse.status());
   const zip=await zipResponse.body();
   assert(zip.length>100 && zip.length<5*1024*1024 && zip.subarray(0,2).toString()==='PK',
     'Downloaded sample has invalid ZIP signature/size');
   console.log('ESC CV GUIDE V2 ARTICLE + ZIP LINK PASS',JSON.stringify({headings,bytes:zip.length,href:href.href}));
   await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
   const uploader=page.locator('[data-cv-user-upload-input]');
   await uploader.waitFor({state:'attached',timeout:30000});
   await uploader.setInputFiles({name:'ESC-CV-v1-mau-chinh-thuc.zip',mimeType:'application/zip',buffer:zip});
   await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
   await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:25000});
   assert(await page.locator('[data-cv-upload-readonly]').isHidden(),'Official ESC ZIP must be editable, not readonly');
   const name=page.frameLocator('[data-cv-live-frame]').locator('[data-cv-inline="profile.fullName"]').first();
   await name.waitFor({state:'visible',timeout:18000});
   assert((await name.textContent())?.includes('Nguyễn Minh Anh'),'Official ZIP Builder sample missing fullName');
   const image=page.frameLocator('[data-cv-live-frame]').locator('img.avatar').first();
   assert(await image.evaluate(el=>el instanceof HTMLImageElement&&el.complete&&el.naturalWidth>0),
     'Official reference sample avatar missing or broken');
   console.log('ESC CV OFFICIAL ZIP BUILDER EDITABLE + AVATAR PASS');
 }
}catch(error){
 await page.screenshot({path:'cvstudio-guide-code-qa-error.png',fullPage:true}).catch(()=>{});
 throw error;
}finally{await browser.close();}
