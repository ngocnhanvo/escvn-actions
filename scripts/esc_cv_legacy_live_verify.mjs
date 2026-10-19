/** Verify all 49 published originals in live ESC CV Builder (not just REST). */
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';

const rows=JSON.parse(await readFile('qa-legacy-batch/batch.json','utf8'));
assert.equal(rows.length,49);
const browser=await chromium.launch({headless:true});
const successes=[];
try{
  const page=await browser.newPage({viewport:{width:1540,height:990},deviceScaleFactor:1});
  const home='https://esc.vn/tao-cv-truc-tuyen/builder/';
  await page.goto(home,{waitUntil:'domcontentloaded',timeout:60000});
  for(const row of rows){
    const id=row.id;
    const check=await page.request.get('https://admin.esc.vn/wp-json/esc-cv/v1/templates/'+id+'/builder?qa='+Date.now(),
      {timeout:30000,headers:{'Cache-Control':'no-cache'}});
    assert(check.ok(),id+' WordPress Builder REST not working');
    const data=await check.json();
    assert.equal(data.id,id);
    assert.equal(data.version,'1.0.1',id+' must publish the newly normalized version');
    assert(data.css.includes('width:100%;min-width:800px;min-height:1130px'),
      id+' still has fixed 800px CSS');
    await page.evaluate(id=>sessionStorage.setItem('esc-cvstudio:demo:selection',JSON.stringify({
      id,version:'1.0.1',source:'registry',at:Date.now()
    })),id);
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});
    const frame=page.frameLocator('[data-cv-live-frame]');
    const cv=frame.locator('.cv').first();
    await cv.waitFor({state:'visible',timeout:30000});
    await page.waitForTimeout(200);
    const metrics=await cv.evaluate(el=>{
      const rect=el.getBoundingClientRect();
      const b=el.ownerDocument.body.getBoundingClientRect();
      const cs=getComputedStyle(el);
      return {width:rect.width,bodyWidth:b.width,left:rect.left-b.left,
        right:b.right-rect.right,border:cs.borderLeftWidth};
    });
    assert(metrics.width>=960&&Math.abs(metrics.left)<3&&Math.abs(metrics.right)<3,
      id+' still has outside blank bands in Builder: '+JSON.stringify(metrics));
    if([27,37,47,57,67,76].includes(Number(id.slice(1)))){
      await cv.screenshot({path:'qa-legacy-batch/'+id+'-live.png',
        timeout:30000,animations:'disabled'});
    }
    successes.push({id,width:metrics.width,left:metrics.left,right:metrics.right});
    console.log('LIVE BUILDER PASS',id,'v1.0.1 width='+metrics.width,
      'leftGap='+metrics.left,'rightGap='+metrics.right,successes.length+'/49');
  }
  await writeFile('qa-legacy-batch/live-report.json',JSON.stringify(successes,null,2));
  console.log('SUCCESS: all 49 corrected original CV templates render full-width inside live ESC Builder');
}finally{await browser.close();}
