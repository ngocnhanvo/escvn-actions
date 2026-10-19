import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
await mkdir('qa-m77',{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1540,height:990},deviceScaleFactor:1});
  const endpoint='https://admin.esc.vn/wp-json/esc-cv/v1/templates/M77/builder';
  const response=await page.request.get(endpoint,{timeout:35000});
  assert(response.ok(),'M77 unavailable: '+response.status());
  const tmpl=await response.json();
  assert.equal(tmpl.id,'M77');
  console.log('M77 public metadata',JSON.stringify({id:tmpl.id,version:tmpl.version,
    name:tmpl.name,cssBytes:tmpl.css?.length,htmlBytes:tmpl.html?.length}));
  await writeFile('qa-m77/template-css.txt',tmpl.css||'');
  await writeFile('qa-m77/template-html.txt',tmpl.html||'');
  const base='https://esc.vn/tao-cv-truc-tuyen/builder/';
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
  await page.evaluate(version=>sessionStorage.setItem('esc-cvstudio:demo:selection',
    JSON.stringify({id:'M77',version,source:'registry',at:Date.now()})),tmpl.version);
  await page.reload({waitUntil:'domcontentloaded',timeout:60000});
  const frame=page.frameLocator('[data-cv-live-frame]');
  await frame.locator('body').waitFor({state:'visible',timeout:25000});
  await page.waitForTimeout(1300);
  const read=async()=>frame.locator('body').evaluate(body=>{
    const doc=body.ownerDocument;
    const win=doc.defaultView;
    const rect=(e)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};
    const arr=[...body.querySelectorAll('*')].map(el=>{
      const r=el.getBoundingClientRect();
      const css=win.getComputedStyle(el);
      return {element:el,area:r.width*r.height,tag:el.tagName,className:String(el.className).slice(0,110),
        rect:rect(el),width:css.width,maxWidth:css.maxWidth,minWidth:css.minWidth,
        margin:css.margin,padding:css.padding,background:css.backgroundColor,
        border:css.border,boxSizing:css.boxSizing,display:css.display};
    }).filter(x=>x.area>10000).sort((a,b)=>b.area-a.area);
    return {viewport:{width:win.innerWidth,height:win.innerHeight},
      body:rect(body),html:rect(doc.documentElement),
      stylesheet:[...doc.styleSheets].map(x=>({href:x.href,type:x.type})),
      outer:arr.slice(0,22).map(({element,...rest})=>rest)};
  });
  const metrics=await read();
  console.log('M77 layout metrics',JSON.stringify(metrics,null,2));
  await writeFile('qa-m77/metrics-before.json',JSON.stringify(metrics,null,2));
  await frame.locator('body').screenshot({path:'qa-m77/before.png'});
  const css=tmpl.css||'';
  for(const line of css.split('\n')){
    if(/(?:body|\.page|\.paper|\.resume|\.cv-|max-width|width:|margin:|padding:)/i.test(line))
      console.log('M77_CSS_RULE:',line.slice(0,300));
  }
}finally{await browser.close();}
