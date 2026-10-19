import { chromium } from 'playwright';
import Handlebars from 'handlebars';
import sharp from 'sharp';
import { readFile,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const folder=resolve('qa-m77-source/package-work');
const html=await readFile(folder+'/index.html','utf8');
const css=await readFile(folder+'/style.css','utf8');
const demo=JSON.parse(await readFile(folder+'/sample-data.json','utf8'));
// The sample JSON may reference a legacy preview URL. Use the ZIP's bundled
// original portrait only for thumbnail rendering; the public CV data is intact.
const portrait=await readFile(folder+'/assets/sample-portrait.webp');
if(!demo.profile||typeof demo.profile!=='object')throw Error('M77 sample profile missing');
demo.profile.avatarUrl='data:image/webp;base64,'+portrait.toString('base64');
assert(css.includes('width:100%;min-width:800px;min-height:1130px'));
assert(css.includes('.cv.top{border:0;min-height:1125px}'));
let compiled=Handlebars.compile(html,{noEscape:true})(demo);
const base=pathToFileURL(folder+'/').href;
compiled=compiled.replace(/<head>/i,'<head><base href="'+base+'"><style>'+css+'</style>');
const rendered=resolve('qa-m77-source/M77-cv-sample-render.html');
await writeFile(rendered,compiled,'utf8');
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:968,height:1420},deviceScaleFactor:1});
  page.on('pageerror',err=>console.log('Browser warning:',err.message.slice(0,130)));
  const response=await page.goto(pathToFileURL(rendered).href,{waitUntil:'load',timeout:30000});
  assert(response?.ok(),'M77 locally rendered preview did not load');
  await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(Array.from(document.images).map(x=>x.decode().catch(()=>{})))});
  const bounds=await page.locator('.cv').evaluate(el=>{
    const b=el.getBoundingClientRect();
    const css=getComputedStyle(el);
    return {width:b.width,height:b.height,border:css.borderLeftWidth,bodyWidth:document.body.clientWidth,avatarLoaded:[...document.images].every(x=>x.complete&&x.naturalWidth>0)};
  });
  console.log('M77 corrected preview metrics',JSON.stringify(bounds));
  assert(Math.abs(bounds.width-968)<=1,'M77 must fill 968px preview');
  assert(bounds.border==='0px','M77 must have zero outer border');
  assert(bounds.avatarLoaded,'M77 original demo assets did not load');
  const shot=await page.locator('.cv').screenshot({type:'png',animations:'disabled',timeout:30000});
  await writeFile('qa-m77-source/M77-preview-after.png',shot);
  const preview=await sharp(shot).webp({quality:86,effort:5}).toBuffer();
  await writeFile(folder+'/preview.webp',preview);
  console.log('SUCCESS M77 thumbnail regenerated from original source+data',preview.length,'bytes');
}finally{await browser.close();}
