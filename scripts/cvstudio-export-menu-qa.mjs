import { chromium } from 'playwright';

const assert=(ok,message)=>{if(!ok)throw Error(message)};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8////fwYGBgYmBigAAD34BADaOyqcAAAAAElFTkSuQmCC','base64');
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zipArchive(files){
  const body=[],central=[];let offset=0;
  for(const [name,raw] of Object.entries(files)){
    const filename=Buffer.from(name),data=Buffer.isBuffer(raw)?raw:Buffer.from(raw),crc=crc32(data);
    const head=Buffer.alloc(30),entry=Buffer.alloc(46);
    head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt32LE(crc,14);
    head.writeUInt32LE(data.length,18);head.writeUInt32LE(data.length,22);
    head.writeUInt16LE(filename.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);
    entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);
    entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);
    entry.writeUInt32LE(offset,42);
    body.push(head,filename,data);central.push(entry,filename);
    offset+=head.length+filename.length+data.length;
  }
  const cd=Buffer.concat(central),end=Buffer.alloc(22);
  const n=Object.keys(files).length;
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(n,8);end.writeUInt16LE(n,10);
  end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...body,cd,end]);
}
const manifest={id:'QA02',version:'1.0.0',name:'ESC Text Selection QA',
  engine:'esc-cv-v1',schema:'esc-cv-v1',entry:'index.html',stylesheet:'style.css',
  sample:'sample.json',preview:'preview.png'};
const zip=zipArchive({
  'template.json':JSON.stringify(manifest),
  'index.html':'<main><h1>{{profile.fullName}}</h1>{{#each experiences}}<section><h2>{{position}}</h2><p>{{description}}</p></section>{{/each}}</main>',
  'style.css':'body{padding:30px;font:18px Arial,sans-serif}h1{font-size:32px}',
  'sample.json':JSON.stringify({profile:{fullName:'Demo User'},experiences:[{position:'Frontend Developer',description:'Build web products'}]}),
  'preview.png':png
});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  const uploader=page.locator('[data-cv-user-upload-input]');
  await uploader.waitFor({state:'attached',timeout:30000});
  await uploader.setInputFiles({name:'cv-export-menu-qa.zip',mimeType:'application/zip',buffer:zip});
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  const menu=page.locator('[data-cv-export-menu]');
  const summary=page.locator('[data-cv-export-summary]');
  await summary.click();
  assert(await menu.evaluate(el=>el.open),'Clicking Tải CV must expand export menu');

  // A pointerdown within the export options should not dismiss the menu.
  await menu.locator('[data-cv-export-format="source"]').dispatchEvent('pointerdown',{
    bubbles:true,pointerType:'mouse'
  });
  assert(await menu.evaluate(el=>el.open),'Interaction inside export dropdown must keep it open');

  // Click elsewhere in the Builder.
  await page.locator('[data-cv-autosave]').click();
  assert(!(await menu.evaluate(el=>el.open)),'Outside click on the Builder must close export menu');

  await summary.click();
  assert(await menu.evaluate(el=>el.open),'Export menu must reopen on click');
  await page.frameLocator('[data-cv-live-frame]').locator('body').click({position:{x:5,y:5}});
  assert(!(await menu.evaluate(el=>el.open)),'Clicking inside the nested CV preview must close export menu');

  await summary.click();
  assert(await menu.evaluate(el=>el.open),'Export menu must reopen after iframe click');
  await page.keyboard.press('Escape');
  assert(!(await menu.evaluate(el=>el.open)),'Escape must close export menu');

  assert(errors.length===0,'Browser JavaScript errors: '+errors.join('; '));
  console.log('CV EXPORT MENU OUTSIDE CLICK + IFRAME CLICK + ESCAPE QA PASS');
}catch(error){
  console.error(error);
  await page.screenshot({path:'cvstudio-export-menu-error.png',fullPage:true}).catch(()=>{});
  throw error;
}finally{await browser.close();}
