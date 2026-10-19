import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1540,height:990},deviceScaleFactor:1});
 const response=await page.request.get('https://admin.esc.vn/wp-json/esc-cv/v1/templates/M80/builder',{timeout:25000});
 assert(response.ok(),'M80 unavailable');
 const model=await response.json();
 await page.goto('https://esc.vn/tao-cv-truc-tuyen/builder/',{waitUntil:'domcontentloaded',timeout:60000});
 await page.evaluate(v=>sessionStorage.setItem('esc-cvstudio:demo:selection',JSON.stringify({id:'M80',version:v,source:'registry',at:Date.now()})),model.version);
 await page.reload({waitUntil:'domcontentloaded'});
 const frame=page.frameLocator('[data-cv-live-frame]');
 await frame.locator('.cv-name').waitFor({state:'visible',timeout:30000});
 await page.waitForTimeout(1100);
 const screenshot=PNG.sync.read(await frame.locator('body').screenshot());
 const result=await frame.locator('body').evaluate(async body=>{
   const doc=body.ownerDocument;
   await doc.fonts.ready;
   const width=doc.defaultView.innerWidth,height=Math.max(body.scrollHeight,doc.documentElement.scrollHeight);
   const headStyle=Array.from(doc.head.querySelectorAll('style')).map(s=>s.outerHTML).join('');
   const html=body.cloneNode(true);
   html.querySelectorAll('script,.esc-cv-text-toolbar,.esc-cv-text-quick,.esc-cv-repeat-toolbar,.esc-cv-repeat-menu,.esc-cv-avatar-action').forEach(el=>el.remove());
   const content=new XMLSerializer().serializeToString(html);
   const source='<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="'+height+
      '"><foreignObject x="0" y="0" width="100%" height="100%">'+
      '<div xmlns="http://www.w3.org/1999/xhtml">'+headStyle+content+'</div></foreignObject></svg>';
   const img=new Image();
   img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(source);
   try{await img.decode();}catch(e){return {error:'Decode failed: '+e.message,size:source.length}};
   const canvas=doc.createElement('canvas');
   canvas.width=width;canvas.height=height;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,height);
   try{ctx.drawImage(img,0,0);return {data:canvas.toDataURL('image/png'),width,height,size:source.length}}catch(e){return {error:'Canvas failed: '+e.message,size:source.length}};
 });
 console.log('Native SVG foreignObject result',JSON.stringify({width:result.width,height:result.height,bytes:result.size,error:result.error||null}));
 assert(!result.error,result.error);
 const rendered=PNG.sync.read(Buffer.from(result.data.split(',')[1],'base64'));
 let count=0,total=0,nonwhite=0;
 const maxW=Math.min(screenshot.width,rendered.width),maxH=Math.min(screenshot.height,rendered.height);
 for(let y=100;y<maxH-10;y+=3){
   for(let x=30;x<maxW-20;x+=3){
     let a=(y*screenshot.width+x)*4,b=(y*rendered.width+x)*4;
     const d=(Math.abs(screenshot.data[a]-rendered.data[b])+Math.abs(screenshot.data[a+1]-rendered.data[b+1])+Math.abs(screenshot.data[a+2]-rendered.data[b+2]))/3;
     total+=d;count++;
     if(rendered.data[b]<240||rendered.data[b+1]<240||rendered.data[b+2]<240)nonwhite++;
   }
 }
 console.log('Native raster comparison',JSON.stringify({width:rendered.width,height:rendered.height,meanRGB:total/count,nonwhitePixels:nonwhite,points:count,preview:[screenshot.width,screenshot.height]}));
 assert(nonwhite>3000,'ForeignObject raster unexpectedly blank');
 console.log('PASS native SVG foreignObject M80 raster is readable');
}finally{await browser.close();}
