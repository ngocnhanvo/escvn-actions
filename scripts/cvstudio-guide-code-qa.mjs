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
 }
}catch(error){
 await page.screenshot({path:'cvstudio-guide-code-qa-error.png',fullPage:true}).catch(()=>{});
 throw error;
}finally{await browser.close();}
