import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';

const version=(await readFile('qa-m77-source/next-version.txt','utf8')).trim();
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1540,height:990},deviceScaleFactor:1});
  const source=await page.request.get('https://admin.esc.vn/wp-json/esc-cv/v1/templates/M77/builder?qa='+Date.now(),
    {timeout:35000,headers:{'Cache-Control':'no-cache'}});
  assert(source.ok(),'Live M77 Builder REST unavailable');
  const data=await source.json();
  assert.equal(data.id,'M77');
  assert.equal(data.version,version,'WordPress M77 active version did not update');
  assert(data.css.includes('width:100%;min-width:800px;min-height:1130px'));
  assert(data.css.includes('.cv.top{border:0;min-height:1125px}'));
  await page.goto('https://esc.vn/tao-cv-truc-tuyen/builder/',{waitUntil:'domcontentloaded',timeout:60000});
  await page.evaluate(v=>{
    sessionStorage.setItem('esc-cvstudio:demo:selection',JSON.stringify({
      id:'M77',version:v,source:'registry',at:Date.now()
    }));
  },version);
  await page.reload({waitUntil:'domcontentloaded',timeout:60000});
  const frame=page.frameLocator('[data-cv-live-frame]');
  const cv=frame.locator('.cv.top');
  await cv.waitFor({state:'visible',timeout:30000});
  await page.waitForTimeout(1200);
  const measured=await cv.evaluate(el=>{
    const cvRect=el.getBoundingClientRect();
    const body=el.ownerDocument.body.getBoundingClientRect();
    const style=getComputedStyle(el);
    return {width:cvRect.width,height:cvRect.height,bodyWidth:body.width,
       leftGap:cvRect.left-body.left,rightGap:body.right-cvRect.right,
       borderLeft:style.borderLeftWidth,borderRight:style.borderRightWidth};
  });
  console.log('LIVE M77 PREVIEW',JSON.stringify({...measured,version}));
  assert(measured.width>=960,'M77 still showing the old 800px width');
  assert(Math.abs(measured.leftGap)<2&&Math.abs(measured.rightGap)<2,
    'M77 is not using full Builder width');
  assert.equal(measured.borderLeft,'0px');
  assert.equal(measured.borderRight,'0px');
  await cv.screenshot({path:'qa-m77-source/M77-live-verified.png',timeout:30000});
  console.log('SUCCESS ESC.VN M77 CV v'+version+': zero outer border, full Builder width, screenshot saved');
}finally{await browser.close();}
