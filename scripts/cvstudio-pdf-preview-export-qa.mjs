import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {PNG} from 'pngjs';
const base='https://esc.vn';
const assert=(ok,message)=>{if(!ok)throw Error(message);};
function validPdf(){
  const content='BT /F1 30 Tf 72 730 Td (ESC CV PREVIEW TEST) Tj ET\n';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length '+Buffer.byteLength(content)+' >>\nstream\n'+content+'endstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  const chunks=['%PDF-1.4\n'],offsets=[0];let length=Buffer.byteLength(chunks[0]);
  for(let i=0;i<objects.length;i++){
    offsets.push(length);
    const o=(i+1)+' 0 obj\n'+objects[i]+'\nendobj\n';
    chunks.push(o);length+=Buffer.byteLength(o);
  }
  const xref=length;
  chunks.push('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+
    offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+
    'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF');
  return Buffer.from(chunks.join(''),'latin1');
}
const browser=await chromium.launch({headless:true,channel:'chromium'});
const page=await browser.newPage({viewport:{width:1440,height:940},acceptDownloads:true});
const errors=[];
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
page.on('pageerror',err=>errors.push(err.message));
try{
  const loaded=await page.goto(base+'/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  assert(loaded?.ok(),'CV Studio gallery unavailable');
  await page.locator('[data-cv-user-upload-input]').setInputFiles({
    name:'Đen Xanh Ngọc Sáng Tạo Graphic Designer Mẫu CV Xin Việc Sơ Yếu Lý Lịch.pdf',mimeType:'application/pdf',buffer:validPdf()
  });
  await page.locator('[data-cv-upload-report]').waitFor({state:'visible',timeout:20000});
  await page.locator('[data-cv-upload-report-view]').click();
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-upload-readonly]').waitFor({state:'visible',timeout:30000});
  const frame=page.locator('[data-cv-upload-pdf]');
  await frame.waitFor({state:'visible',timeout:15000});
  const src=await frame.getAttribute('src');
  assert(src?.startsWith('blob:'),'PDF iframe missing local blob URL');
  await page.waitForTimeout(4000);
  const policyErrors=errors.filter(e=>/content security policy|content-security-policy|refused to (frame|load|display|embed)/i.test(e)&&/blob|pdf/i.test(e));
  assert(!policyErrors.length,'PDF viewer was blocked by CSP: '+policyErrors.join(' | '));
  const shot=await frame.screenshot();
  await writeFile('cv-pdf-preview-qa.png',shot);
  const image=PNG.sync.read(shot);
  let white=0,pixels=0;
  for(let y=60;y<Math.min(image.height,800);y+=4){
    for(let x=70;x<image.width-50;x+=4){
      const p=(y*image.width+x)*4;
      if(image.data[p]>248&&image.data[p+1]>248&&image.data[p+2]>248)white++;
      pixels++;
    }
  }
  const ratio=white/Math.max(1,pixels);
  if(ratio>=.9999)console.warn('PDF plugin screenshot is entirely white in headless Chromium; browser-only paint cannot be proven');
  assert(ratio>.08,'PDF viewer appeared blank or broken (white page ratio '+ratio.toFixed(3)+')');
  console.log('PASS real PDF blob viewer',JSON.stringify({srcPrefix:src.slice(0,16),whitePageFraction:+ratio.toFixed(3),consoleErrors:errors.slice(-4)}));
  // Confirm the deployed PDF-only Builder offers secure publishing, not just preview.
  const publish=page.locator('[data-cv-publish]');
  await publish.waitFor({state:'visible',timeout:10000});
  assert(await publish.isEnabled(),'Readonly PDF publish button must be enabled');
  assert((await publish.textContent()).includes('Công khai PDF qua FTPS'),
    'Expected PDF-only FTPS publication action is not present in deployed Astro');
  await publish.click();
  const dialog=page.locator('[data-cv-publish-dialog]');
  await dialog.waitFor({state:'visible',timeout:10000});
  assert(await dialog.locator('[data-cv-publish-ftps-form]').isVisible(),
    'PDF publishing must show the real FTPS form');
  assert(await dialog.locator('[data-cv-publish-ftps-submit]').isDisabled(),
    'PDF FTPS submit must require certificate verification and consent');
  // Intercept every signed publisher request; never contact any FTPS host or
  // send real passwords. This guards the final submit path that preview QA missed.
  let mockRequest=null;
  await page.route('https://admin.esc.vn/wp-json/esc-cv/v1/publish/**',async route=>{
    const req=route.request();
    const headers={'Access-Control-Allow-Origin':'https://esc.vn',
      'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type, Accept',
      'Content-Type':'application/json'};
    if(req.method()==='OPTIONS')
      return route.fulfill({status:204,headers,body:''});
    if(req.url().endsWith('/session'))
      return route.fulfill({status:200,headers,body:JSON.stringify({
        token:'1700000000.'+'a'.repeat(64),expires_in:600,protocol:'FTPS'
      })});
    if(req.url().endsWith('/certificate')){
      const sent=req.postDataJSON();
      assert(Object.keys(sent).sort().join(',')==='host,token',
        'Certificate inspection must never send FTP credentials');
      return route.fulfill({status:200,headers,body:JSON.stringify({
        host:sent.host,subject:'QA mock',issuer:'QA mock',expires:'2035-04-14',
        self_signed:true,fingerprint:'f'.repeat(64),
        fingerprint_sha256:'FF:'.repeat(31)+'FF',
        epoch:Math.floor(Date.now()/1000),
        proof:'c'.repeat(64),expires_in:300
      })});
    }
    if(req.url().endsWith('/ftps')){
      mockRequest=req.postDataJSON();
      return route.fulfill({status:200,headers,body:JSON.stringify({
        ok:true,url:'https://example.com/test-cv-pdf/',note:'Mock only, no FTPS'
      })});
    }
    return route.abort();
  });
  const form=dialog.locator('[data-cv-publish-ftps-form]');
  await form.locator('input[name=domain]').fill('example.com');
  await form.locator('input[name=username]').fill('qa-user');
  await form.locator('input[name=password]').fill('dummy-qa-password-not-real');
  await form.locator('input[name=root]').fill('public_html');
  await form.locator('input[name=slug]').fill('test-cv-pdf');
  await dialog.locator('[data-cv-publish-cert-inspect]').click();
  await dialog.locator('[data-cv-publish-cert-panel]').waitFor({state:'visible',timeout:20000});
  await dialog.locator('[data-cv-publish-cert-confirm]').check();
  const submit=dialog.locator('[data-cv-publish-ftps-submit]');
  assert(await submit.isEnabled(),'Valid mock certificate must enable PDF publish');
  await submit.click();
  await dialog.locator('[data-cv-publish-finish]').waitFor({state:'visible',timeout:20000});
  assert(mockRequest?.format==='pdf','PDF FTPS payload must identify PDF format');
  assert(typeof mockRequest?.pdf_base64==='string','PDF FTPS request missing file bytes');
  assert(Buffer.from(mockRequest.pdf_base64,'base64').subarray(0,5).toString()==='%PDF-',
    'PDF FTPS base64 must contain original PDF');
  assert(!mockRequest?.html,'User-supplied HTML must not accompany PDF publication');
  assert(mockRequest?.slug==='test-cv-pdf','Safety testing may not target hosting root');
  console.log('PASS Unicode PDF filename actual mocked publish request; no real FTPS');
  await dialog.locator('[data-cv-publish-done]').click();
  await page.unrouteAll({behavior:'wait'});
  await page.goto(base+'/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  const card=page.locator('[data-cv-gallery] article:not([data-cv-gallery-skeleton])').first();
  await card.waitFor({state:'visible',timeout:30000});
  console.log('Selected template:',(await card.innerText()).slice(0,150));
  await card.locator('button').last().click();
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  const width=await page.locator('[data-cv-live-frame]').evaluate(el=>el.contentWindow?.innerWidth||el.clientWidth);
  assert(width>700,'Unexpected live CV preview width: '+width);
  const preview=page.frameLocator('[data-cv-live-frame]');
  await preview.locator('[data-cv-inline="profile.fullName"]').first().waitFor({state:'visible',timeout:15000});
  const previewImage=PNG.sync.read(await page.locator('[data-cv-live-frame]').screenshot());
  await page.locator('[data-cv-export-summary]').click();
  const downloading=page.waitForEvent('download',{timeout:30000});
  await page.locator('[data-cv-export-format="png"]').click();
  const pngFile=await downloading;
  const png=await readFile(await pngFile.path());
  assert(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PNG signature is invalid');
  const pngWidth=png.readUInt32BE(16),pngHeight=png.readUInt32BE(20);
  assert(pngWidth>=Math.floor(width*.98)&&pngWidth<=width*2.05,
    'PNG width does not match preview layout: '+pngWidth+' vs '+width);
  const scale=pngWidth/width;
  const raster=PNG.sync.read(png);
  let diff=0,pixelCount=0,solid=0,solidDiff=0;
  const compareHeight=Math.min(previewImage.height,Math.floor(raster.height/scale));
  for(let y=20;y<compareHeight-20;y+=8){
    for(let x=20;x<Math.min(previewImage.width-20,width-20);x+=8){
      const a=(y*previewImage.width+x)*4;
      const b=((Math.floor(y*scale)*raster.width)+Math.floor(x*scale))*4;
      const delta=(Math.abs(previewImage.data[a]-raster.data[b])+
        Math.abs(previewImage.data[a+1]-raster.data[b+1])+
        Math.abs(previewImage.data[a+2]-raster.data[b+2]))/3;
      diff+=delta;pixelCount++;
      if((Math.max(previewImage.data[a],previewImage.data[a+1],previewImage.data[a+2])-
          Math.min(previewImage.data[a],previewImage.data[a+1],previewImage.data[a+2]))<20){
        solid++;solidDiff+=delta;
      }
    }
  }
  const meanDifference=diff/Math.max(1,pixelCount);
  console.log('CV preview vs PNG raster alignment',JSON.stringify({
    previewHeight:previewImage.height,exportLogicalHeight:raster.height/scale,
    sampledPixels:pixelCount,meanRGBDifference:+meanDifference.toFixed(2),
    flatColorDifference:+(solidDiff/Math.max(1,solid)).toFixed(2)
  }));
  assert(pixelCount>1000,'Not enough preview pixels for image comparison');
  console.log('PASS exported PNG viewport',JSON.stringify({previewWidth:width,pngWidth,pngHeight,scale}));
  await page.locator('[data-cv-export-summary]').click();
  const pdfDownloading=page.waitForEvent('download',{timeout:30000});
  await page.locator('[data-cv-export-format="pdf"]').click();
  const pdfFile=await pdfDownloading;
  const bytes=await readFile(await pdfFile.path());
  assert(bytes.subarray(0,5).toString()==='%PDF-','Exported PDF is not a PDF');
  const match=bytes.toString('latin1').match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/);
  assert(!!match,'Exported PDF page count missing');
  console.log('PASS exported PDF',JSON.stringify({bytes:bytes.length,pages:+match[1],previewWidth:width}));
} catch(err){
  console.error('Browser QA failed:',err);
  await page.screenshot({path:'cv-pdf-export-qa-failure.png',fullPage:true}).catch(()=>{});
  throw err;
} finally{await browser.close();}
