import {chromium} from 'playwright';
const url='https://esc.vn/tao-cv-truc-tuyen/';
const api='https://admin.esc.vn/wp-json/esc-cv/v1/templates';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const errors=[],requests=[];
const assert=(v,m)=>{if(!v)throw Error(m);};
page.on('pageerror',e=>errors.push(e.message));
page.on('request',req=>{
  const u=new URL(req.url());
  if(u.pathname==='/wp-json/esc-cv/v1/templates')requests.push({page:u.searchParams.get('page'),size:u.searchParams.get('per_page')});
});
const grid=page.locator('[data-cv-gallery]'),nav=page.locator('[data-cv-pagination]');
const settled=async()=>{
  await page.waitForFunction(()=>{
    const el=document.querySelector('[data-cv-gallery]');
    return el?.getAttribute('aria-busy')==='false';
  },null,{timeout:30000});
};
try{
  const resp=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  assert(resp?.status()===200,'CV Studio page HTTP '+resp?.status());
  await settled();
  const apiResp=await page.request.get(api+'?page=1&per_page=12',{timeout:30000});
  assert(apiResp.ok(),'Paged WP registry HTTP '+apiResp.status());
  const meta=await apiResp.json();
  assert(meta.page===1&&meta.per_page===12&&meta.total_pages===Math.ceil(meta.total/12),
    'Invalid real server-side pagination metadata');
  assert(meta.total>12,'Need at least two pages to verify pagination');
  assert(await nav.isVisible(),'Numeric pagination not visible');
  assert(await grid.locator('article').count()===12,'First page must contain 12 cards');
  assert(await grid.locator('img[loading="lazy"]').count()===12,'Images must load lazily');
  const first=await grid.locator('article p').allTextContents();
  // Hold a real page-two request so we can inspect the intermediate UI.
  // Previously the gallery collapsed to three skeletons, exposing the footer
  // for a moment before a smooth scroll returned to the CV cards.
  let resumePageTwo=()=>{};
  const heldPageTwo=new Promise(resolve=>{resumePageTwo=resolve;});
  await page.route(u=>u.pathname.endsWith('/wp-json/esc-cv/v1/templates')&&
    u.searchParams.get('page')==='2',async route=>{
    await heldPageTwo;
    await route.continue();
  });
  await nav.locator('[data-cv-pagination-next]').scrollIntoViewIfNeeded();
  const oldPageHeight=await page.evaluate(()=>document.documentElement.scrollHeight);
  await nav.locator('[data-cv-pagination-next]').click();
  await page.waitForFunction(()=>document.querySelector('[data-cv-gallery]')?.getAttribute('aria-busy')==='true');
  const transitional=await page.evaluate(()=>{
    const gallery=document.querySelector('[data-cv-gallery]');
    const pager=document.querySelector('[data-cv-pagination]');
    const footer=document.querySelector('footer');
    return {count:gallery?.querySelectorAll('article').length,
      pagerVisible:!!pager&&getComputedStyle(pager).display!=='none',
      galleryTop:gallery?.getBoundingClientRect().top,
      footerTop:footer?.getBoundingClientRect().top,
      viewportHeight:window.innerHeight,
      pageHeight:document.documentElement.scrollHeight};
  });
  assert(transitional.count===12,
    'Changing page must retain existing 12 CV cards while loading: '+JSON.stringify(transitional));
  assert(transitional.pagerVisible,'Pagination must remain visible while the next page loads');
  assert(Math.abs(transitional.pageHeight-oldPageHeight)<200,
    'Gallery collapsed while fetching, causing footer jump: '+JSON.stringify(transitional));
  assert(transitional.galleryTop>=80&&transitional.galleryTop<350,
    'Paging must go directly to gallery below sticky header: '+JSON.stringify(transitional));
  assert(transitional.footerTop===undefined||transitional.footerTop>transitional.viewportHeight,
    'Footer entered viewport while paging: '+JSON.stringify(transitional));
  resumePageTwo();
  await page.waitForURL(/cv_page=2/,{timeout:20000});
  await settled();
  const second=await grid.locator('article p').allTextContents();
  assert(await grid.locator('article').count()===12,'Second page must contain 12 cards');
  assert(first[0]!==second[0],'Page two must have different CV templates');
  const last=meta.total_pages;
  const lastButton=nav.locator('[data-cv-pagination-numbers] button').filter({hasText:new RegExp('^'+last+'$')});
  await lastButton.click();
  await page.waitForURL(new RegExp('cv_page='+last+'(?:#|$)'),{timeout:20000});
  await settled();
  assert(await grid.locator('article').count()===meta.total-(last-1)*12,'Last page count mismatch');
  await page.reload({waitUntil:'domcontentloaded'});
  await settled();
  assert(await grid.locator('article').count()===meta.total-(last-1)*12,'Bookmark page did not restore');
  assert(requests.length>=4&&requests.every(x=>x.size==='12'),
    'Gallery must request per_page=12 (requests: '+JSON.stringify(requests)+')');
  assert(requests.some(x=>x.page==='1')&&requests.some(x=>x.page==='2')&&requests.some(x=>x.page===String(last)),
    'Missing real page requests: '+JSON.stringify(requests));
  assert(errors.length===0,'Browser errors: '+errors.join('; '));
  console.log('CV GALLERY PAGINATION PASS',JSON.stringify({total:meta.total,pages:last,firstPage:12,lastPage:meta.total-(last-1)*12,requests}));
}catch(error){
  await page.screenshot({path:'cv-gallery-pagination-error.png',fullPage:true}).catch(()=>{});
  throw error;
}finally{
  await browser.close();
}
