import {chromium} from 'playwright';
import {PNG} from 'pngjs';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const base=process.env.ESC_QA_BASE||'http://127.0.0.1:4321';
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1540,height:990},deviceScaleFactor:1,acceptDownloads:true});
  page.on('console',message=>{
    if(message.text().includes('ESC_M80_EXPORT_GEOMETRY'))console.log(message.text());
  });
  const dataUrl='https://admin.esc.vn/wp-json/esc-cv/v1/templates/M80/builder';
  const response=await page.request.get(dataUrl,{timeout:25000});
  assert(response.ok(),'M80 source registry unavailable (HTTP '+response.status()+')');
  const template=await response.json();
  assert.equal(template.id,'M80','Unexpected template ID');
  assert(/^\d+\.\d+\.\d+$/.test(template.version),'M80 version invalid');
  await page.route(dataUrl,route=>route.fulfill({
    status:200,headers:{'Content-Type':'application/json',
      'Access-Control-Allow-Origin':new URL(base).origin},body:JSON.stringify(template)
  }));
  const start=await page.goto(base+'/tao-cv-truc-tuyen/builder/',{waitUntil:'domcontentloaded',timeout:60000});
  assert(start?.ok(),'CV Builder failed on development SSR');
  await page.evaluate(version=>sessionStorage.setItem('esc-cvstudio:demo:selection',
    JSON.stringify({id:'M80',version,source:'registry',at:Date.now()})),template.version);
  await page.reload({waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  const frame=page.locator('[data-cv-live-frame]');
  await frame.waitFor({state:'visible'});
  const frameDoc=page.frameLocator('[data-cv-live-frame]');
  await frameDoc.locator('body').waitFor({state:'visible',timeout:20000});
  await page.waitForTimeout(1700);
  await frameDoc.locator('html').evaluate(el=>{el.dataset.cvExportDiagnostics='1'});
  await frameDoc.locator('body').screenshot({path:'m80-preview.png'});
  const preview=PNG.sync.read(await readFile('m80-preview.png'));
  const width=await frame.evaluate(el=>el.contentWindow?.innerWidth||el.clientWidth);
  await page.locator('[data-cv-export-summary]').click();
  const exporting=page.waitForEvent('download',{timeout:45000});
  await page.locator('[data-cv-export-format="png"]').click();
  const file=await exporting;
  const blob=await readFile(await file.path());
  const raster=PNG.sync.read(blob);
  await writeFile('m80-export.png',blob);
  const scale=raster.width/width;
  assert(scale>=0.95&&scale<=2.05,'Unexpected raster scale '+scale);
  // The Builder body has its default 8px horizontal and 16px vertical
  // margin inside the iframe. The screenshot is BODY-only while the export
  // raster covers the entire frame. Align their content origins before
  // measuring; also exclude the fixed site header covering the top on scroll.
  const logicalWidth=Math.min(preview.width,raster.width/scale);
  const logicalHeight=Math.min(preview.height,raster.height/scale);
  const xOffset=Math.round((raster.width/scale-preview.width)/2);
  const yOffset=Math.round((raster.height/scale-preview.height)/2);
  let count=0,sum=0,sumSolid=0,flatCount=0;
  for(let y=120;y<logicalHeight-16;y+=5){
    for(let x=16;x<logicalWidth-16;x+=5){
      const ax=x,ay=y;
      const bx=Math.min(raster.width-1,Math.floor((x+xOffset)*scale));
      const by=Math.min(raster.height-1,Math.floor((y+yOffset)*scale));
      const a=(ay*preview.width+ax)*4,b=(by*raster.width+bx)*4;
      const delta=(Math.abs(preview.data[a]-raster.data[b])+
        Math.abs(preview.data[a+1]-raster.data[b+1])+
        Math.abs(preview.data[a+2]-raster.data[b+2]))/3;
      count++;sum+=delta;
      if(Math.max(preview.data[a],preview.data[a+1],preview.data[a+2])-
         Math.min(preview.data[a],preview.data[a+1],preview.data[a+2])<15){
        flatCount++;sumSolid+=delta;
      }
    }
  }
  assert(count>10000,'Too few compared pixels');
  const mean=sum/count,solidMean=sumSolid/Math.max(1,flatCount);
  console.log('M80 live Builder vs PNG',JSON.stringify({
    logicalWidth:width,previewWidth:preview.width,previewHeight:preview.height,
    exportedWidth:raster.width,exportedHeight:raster.height,scale,
    meanRGBDifference:+mean.toFixed(2),flatRGBDifference:+solidMean.toFixed(2),
    xOffset,yOffset,
    comparisonPoints:count
  }));
  // Layout mismatch must not quietly pass just because a PNG was generated.
  assert(mean<7,'M80 PNG differs from Builder (mean RGB '+mean.toFixed(2)+')');
  // Explicit regression for the user's screenshot: border immediately below
  // the two-line "Hoàng Tú Quỳnh" heading must not paint through the letters.
  const border=await frameDoc.locator('.cv-summary').evaluate(el=>{
    const body=el.ownerDocument.body.getBoundingClientRect();
    const intro=el.parentElement.getBoundingClientRect();
    const rect=el.getBoundingClientRect();
    return {y:rect.top-body.top,x:intro.left-body.left,width:intro.width};
  });
  let titleBandSum=0,titleBandPixels=0;
  const bandStart=Math.max(0,Math.floor(border.y-78));
  const bandEnd=Math.min(logicalHeight-1,Math.ceil(border.y+33));
  for(let y=bandStart;y<=bandEnd;y+=2){
    for(let x=Math.max(0,Math.floor(border.x+14));x<Math.min(logicalWidth-1,Math.floor(border.x+border.width-12));x+=2){
      const ai=(y*preview.width+x)*4;
      const bx=Math.min(raster.width-1,Math.floor((x+xOffset)*scale));
      const by=Math.min(raster.height-1,Math.floor((y+yOffset)*scale));
      const bi=(by*raster.width+bx)*4;
      titleBandSum+=(Math.abs(preview.data[ai]-raster.data[bi])+
        Math.abs(preview.data[ai+1]-raster.data[bi+1])+
        Math.abs(preview.data[ai+2]-raster.data[bi+2]))/3;
      titleBandPixels++;
    }
  }
  const titleBandMean=titleBandSum/Math.max(1,titleBandPixels);
  console.log('M80 heading and underline parity',JSON.stringify({titleBandMean:+titleBandMean.toFixed(2),border,comparedPixels:titleBandPixels}));
  assert(titleBandPixels>1000&&titleBandMean<9,
    'M80 PNG draws a title/summary border differently from the Builder');
  await page.locator('[data-cv-export-summary]').click();
  const downloading=page.waitForEvent('download',{timeout:45000});
  await page.locator('[data-cv-export-format="pdf"]').click();
  const pdfDownload=await downloading;
  const pdf=await readFile(await pdfDownload.path());
  assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
  const source=pdf.toString('latin1');
  const pdfPage=source.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/);
  assert(pdfPage,'PDF page bounds missing');
  const countMatch=source.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/);
  assert.equal(+countMatch?.[1],1,'M80 must have exactly one PDF page');
  const physicalRatio=Number(pdfPage[2])/Number(pdfPage[1]);
  const canvasRatio=raster.height/raster.width;
  assert(Math.abs(physicalRatio-canvasRatio)<0.008,
    'PDF aspect '+physicalRatio+' differs from PNG '+canvasRatio);
  console.log('PASS M80: Builder/PNG layout and original-ratio PDF from same canvas');
}finally{await browser.close();}
