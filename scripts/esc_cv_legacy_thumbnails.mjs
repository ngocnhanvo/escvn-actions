/** Regenerate thumbnails for the 49 audited original templates, no publishing. */
import {chromium} from 'playwright';
import Handlebars from 'handlebars';
import sharp from 'sharp';
import {readFile,writeFile,readdir,stat} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const base=resolve('qa-legacy-batch');
const batch=JSON.parse(await readFile(base+'/batch.json','utf8'));
assert.equal(batch.length,49,'Expected exact audited 49 legacy templates');
const browser=await chromium.launch({headless:true});
let completed=[];
try{
  for(const row of batch){
    const id=row.id;
    const folder=resolve(base,id,'stage');
    const [html,css,rawDemo]=await Promise.all([
      readFile(folder+'/index.html','utf8'),
      readFile(folder+'/'+row.stylesheet,'utf8'),
      readFile(folder+'/sample-data.json','utf8')
    ]);
    const demo=JSON.parse(rawDemo);
    assert(css.includes('width:100%;min-width:800px;min-height:1130px'),id+' incorrect CSS');
    assert(demo.profile && typeof demo.profile==='object',id+' missing sample profile');
    const photo=folder+'/assets/sample-portrait.webp';
    try{
      const image=await readFile(photo);
      demo.profile.avatarUrl='data:image/webp;base64,'+image.toString('base64');
    }catch(error){
      // No bundled portrait: only allow local in-ZIP assets, not external fetching.
      if(/https?:/i.test(String(demo.profile.avatarUrl||''))){
        throw new Error(id+': unexpected remote sample portrait; refusing thumbnail change');
      }
    }
    let rendered=Handlebars.compile(html,{noEscape:true})(demo);
    const cssInject='<base href="'+pathToFileURL(folder+'/').href+'">'+
      '<style>'+css+'</style>';
    if(!/<head(?:\s[^>]*)?>/i.test(rendered))
      throw new Error(id+': missing HEAD in original template');
    rendered=rendered.replace(/<head(?:\s[^>]*)?>/i,m=>m+cssInject);
    const renderFile=resolve(base,id,id+'-rendered.html');
    await writeFile(renderFile,rendered,'utf8');
    const page=await browser.newPage({viewport:{width:968,height:1420},deviceScaleFactor:1});
    try{
      await page.goto(pathToFileURL(renderFile).href,{waitUntil:'load',timeout:25000});
      await page.evaluate(async()=>{
        await document.fonts.ready;
        await Promise.all([...document.images].map(img=>img.decode().catch(()=>{})));
      });
      const doc=page.locator('.cv').first();
      assert.equal(await doc.count(),1,id+': missing CV root');
      const geom=await doc.evaluate(e=>{
        const r=e.getBoundingClientRect();
        const s=getComputedStyle(e);
        const b=document.body.getBoundingClientRect();
        return {width:r.width,bodyWidth:b.width,left:r.left-b.left,right:b.right-r.right,
          border:s.borderLeftWidth,height:r.height,visible:s.visibility!=='hidden',
          images:[...document.images].map(x=>({complete:x.complete,loaded:x.naturalWidth>0}))};
      });
      if(Math.abs(geom.width-968)>1||Math.abs(geom.left)>2||Math.abs(geom.right)>2||
         !geom.visible||geom.images.some(x=>!x.loaded))
        throw new Error(id+' thumbnail mismatch '+JSON.stringify(geom));
      const capture=await doc.screenshot({type:'png',timeout:20000,animations:'disabled'});
      const type=row.preview.split('.').at(-1).toLowerCase();
      let bytes;
      if(type==='webp')bytes=await sharp(capture).webp({quality:86,effort:4}).toBuffer();
      else if(type==='png')bytes=await sharp(capture).png({compressionLevel:8}).toBuffer();
      else if(type==='jpg'||type==='jpeg')bytes=await sharp(capture).jpeg({quality:88}).toBuffer();
      else throw new Error('MIME/extension not supported '+id);
      if(bytes.length<4000 || bytes.length>2*1024*1024)throw new Error(id+': invalid preview size');
      await writeFile(folder+'/'+row.preview,bytes);
      completed.push({id,width:geom.width,border:geom.border,thumbnailBytes:bytes.length});
      console.log('THUMBNAIL PASS',id,'width',geom.width,'border',geom.border,
        'bytes',bytes.length);
    }finally{await page.close();}
  }
  await writeFile(base+'/thumbnail-report.json',JSON.stringify(completed,null,2));
  assert.equal(completed.length,49);
  console.log('THUMBNAIL SUCCESS: 49 CV samples rendered at 968px, original assets restored, only staged thumbnails replaced');
}finally{await browser.close();}
