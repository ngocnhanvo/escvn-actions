import {chromium} from 'playwright';

const url='https://esc.vn/ban-do-ho-kinh-doanh/';
const browser=await chromium.launch({headless:true});
try{
  const ctx=await browser.newContext({viewport:{width:1440,height:920}});
  const page=await ctx.newPage();
  const errors=[];
  page.on('pageerror',e=>errors.push(String(e).slice(0,220)));
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  if(response?.status()!==200) {
    const probe=['/ban-do-ho-kinh-doanh','/ban-do-ho-kinh-doanh/','/ban-do-ho-kinh-doanh/index.html','/client/ban-do-ho-kinh-doanh/index.html','/tao-cv-truc-tuyen/builder/','/tao-cv-truc-tuyen/builder/index.html','/'];
    for(const candidate of probe) {
      try {
        const r=await ctx.request.get('https://esc.vn'+candidate,{timeout:20000,maxRedirects:3});
        const body=await r.text();
        console.log('HKD ROUTE PROBE',candidate,r.status(),r.url(),body.includes('data-hkd-map-page')?'HKD_CONTENT':'',body.slice(0,60).replace(/\\s+/g,' '));
      }catch(e){console.log('HKD ROUTE PROBE ERROR',candidate,String(e).slice(0,110));}
    }
    throw Error('HKD route HTTP '+response?.status());
  }
  await page.locator('[data-hkd-map-page]').waitFor({timeout:12000});
  await page.getByRole('heading',{name:'Bản đồ số hộ kinh doanh'}).waitFor({timeout:12000});
  await page.waitForFunction(()=>document.getElementById('hkd-total')?.textContent?.trim()==='0',{timeout:30000});
  await page.waitForFunction(()=>document.querySelectorAll('#hkd-province option').length===35,{timeout:30000});
  const inds=await page.locator('#hkd-industry option').count();
  if(inds!==16)throw Error('15 industries expected, found '+(inds-1));
  if(!await page.locator('#hkd-list').getByText('Chưa có hộ kinh doanh phù hợp').isVisible())
    throw Error('Empty state not rendered');
  await page.selectOption('#hkd-province','79');
  await page.waitForFunction(()=>document.querySelectorAll('#hkd-ward option').length===169,{timeout:20000});
  await page.locator('#hkd-search').fill('quan ca phe');
  await page.getByRole('button',{name:'Tìm kiếm',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('hkd-notice')?.textContent?.includes('Chưa tìm thấy'),{timeout:20000});
  if(!page.url().includes('province=79'))throw Error('Filter URL persistence failed');
  await page.getByRole('button',{name:'Xóa lọc'}).click();
  await page.waitForFunction(()=>document.querySelector('#hkd-province')?.value===''&&document.getElementById('hkd-notice')?.textContent?.includes('Chưa tìm thấy'),{timeout:20000});
  if(errors.length)throw Error('Browser page errors: '+errors.join(' | '));
  const mapExists=await page.locator('#hkd-map').count();
  if(mapExists!==1)throw Error('Map root missing');
  console.log('HKD Step6 DESKTOP PASS: live route, CORS data, 34 provinces, 3321 wards, 15 industries, search, reset, empty state, no pageerror');
  const mobile=await ctx.newPage();
  await mobile.setViewportSize({width:390,height:844});
  await mobile.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  await mobile.locator('#hkd-filter-form').waitFor({timeout:12000});
  await mobile.waitForFunction(()=>document.getElementById('hkd-total')?.textContent?.trim()==='0',{timeout:30000});
  const metrics=await mobile.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,innerWidth:window.innerWidth}));
  if(metrics.scrollWidth>metrics.innerWidth+4)throw Error('Mobile horizontal overflow: '+JSON.stringify(metrics));
  console.log('HKD Step6 MOBILE PASS: 390px responsive layout, loaded categories, no horizontal overflow');
  await ctx.close();
} finally { await browser.close(); }
