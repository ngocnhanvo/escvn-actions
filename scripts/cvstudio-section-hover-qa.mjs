import {chromium} from 'playwright';
const assert=(value,message)=>{if(!value)throw Error(message);};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8////fwYGBgYmBigAAD34BADaOyqcAAAAAElFTkSuQmCC','base64');
function crc32(data){let crc=0xffffffff;for(const b of data){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function makeZip(files){
  const body=[],central=[];let offset=0;
  for(const [name,raw] of Object.entries(files)){
    const filename=Buffer.from(name),data=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
    const crc=crc32(data),header=Buffer.alloc(30),entry=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);
    header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);
    entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);
    entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);
    entry.writeUInt32LE(offset,42);body.push(header,filename,data);
    central.push(entry,filename);offset+=header.length+filename.length+data.length;
  }
  const centralBytes=Buffer.concat(central),footer=Buffer.alloc(22),count=Object.keys(files).length;
  footer.writeUInt32LE(0x06054b50);footer.writeUInt16LE(count,8);footer.writeUInt16LE(count,10);
  footer.writeUInt32LE(centralBytes.length,12);footer.writeUInt32LE(offset,16);
  return Buffer.concat([...body,centralBytes,footer]);
}
const manifest={id:'QA01',version:'1.0.0',name:'Hover Section QA',engine:'esc-cv-v1',
  schema:'esc-cv-v1',entry:'index.html',stylesheet:'style.css',preview:'preview.png',sample:'sample.json'};
const zip=makeZip({
  'template.json':JSON.stringify(manifest),
  'index.html':[
    '<main class="cv">',
    '<h1>{{profile.fullName}}</h1>',
    '<section class="skills"><h2>SKILLS</h2>',
    '{{#each skills}}<div class="skill"><p>{{name}}</p></div>{{/each}}</section>',
    '<div class="experience"><h2>EXPERIENCE</h2>',
    '{{#each experiences}}<article><p>{{position}}</p></article>{{/each}}</div>',
    '</main>'
  ].join('\n'),
  'style.css':'body{margin:0;background:#fff;padding:22px;font-family:Arial,sans-serif}.cv{padding:24px}section,.experience{padding:20px;margin:24px 0;border:1px solid #acc6e3;min-height:130px}.skill,article{width:240px;max-width:80%;padding:8px;background:#f2f7fc}h2{margin:0 0 16px}',
  'sample.json':JSON.stringify({profile:{fullName:'QA CV'},skills:[{name:'TypeScript'}],
    experiences:[{position:'Frontend developer'}]}),
  'preview.png':png
});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  const upload=page.locator('[data-cv-user-upload-input]');
  await upload.waitFor({state:'attached',timeout:30000});
  await upload.setInputFiles({name:'qa-section-hover.zip',mimeType:'application/zip',buffer:zip});
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  const cv=page.frameLocator('[data-cv-live-frame]');
  const toolbar=cv.locator('[data-cv-repeat-toolbar]');
  const trigger=cv.locator('.esc-cv-repeat-trigger');
  const menu=cv.locator('[data-cv-repeat-menu]');
  const outline=cv.locator('.esc-cv-repeat-outline');
  const sectionHeading=cv.locator('section.skills h2');
  await sectionHeading.waitFor({state:'visible',timeout:20000});
  await sectionHeading.hover();
  await trigger.waitFor({state:'visible',timeout:10000});
  assert(await outline.getAttribute('data-cv-selected-path')==='skills',
    'Section heading hover must select skills GROUP, not a field or wrong row');
  await trigger.click();
  assert(await menu.isVisible(),'Section toolbar menu should open by clicking ellipsis');
  assert((await menu.innerText()).includes('Thêm'),'Section ellipsis must offer Add section/item');
  assert(!(await menu.innerText()).includes('Xóa'),'Section menu must not act on a row');
  // Hover a bound row and physically move toward the ellipsis to reproduce
  // the original disappearing-button bug (the toolbar sits outside the field).
  await cv.locator('[data-cv-inline="skills.0.name"]').hover();
  await trigger.waitFor({state:'visible'});
  assert(await outline.getAttribute('data-cv-selected-path')==='skills.0',
    'Row hover must select its own item');
  await trigger.click();
  assert((await menu.innerText()).includes('Xóa'),'Row ellipsis must provide Delete');
  const field=cv.locator('[data-cv-inline="skills.0.name"]');
  await field.hover();
  const triggerBox=await trigger.boundingBox(),fieldBox=await field.boundingBox();
  assert(triggerBox&&fieldBox,'No physical clickable toolbar/field rect');
  await page.mouse.move(fieldBox.x+fieldBox.width/2,fieldBox.y+fieldBox.height/2);
  await page.mouse.move(triggerBox.x+triggerBox.width/2,triggerBox.y+triggerBox.height/2,{steps:14});
  assert(await trigger.isVisible(),'Ellipsis disappeared while pointer moved from row to toolbar');
  assert(await outline.getAttribute('data-cv-selected-path')==='skills.0',
    'Row selection unexpectedly changed to section while approaching toolbar');
  await trigger.click();
  assert(await menu.isVisible()&&(await menu.innerText()).includes('Xóa'),
    'Ellipsis should remain clickable after moving through whitespace');
  const divHeading=cv.locator('.experience h2');
  await divHeading.hover();
  await trigger.waitFor({state:'visible'});
  assert(await outline.getAttribute('data-cv-selected-path')==='experiences',
    'An AI-generated headed DIV section should also show its group actions');
  // Outside clicks must still hide the blue selection/ellipsis.
  await cv.locator('body').evaluate(el=>{
    el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:2,clientY:2,pointerType:'mouse'}));
  });
  assert(await toolbar.isHidden()&&await outline.isHidden(),
    'Clicking empty paper must dismiss selected row/section controls');
  assert(errors.length===0,'Browser errors: '+errors.join('; '));
  console.log('ESC CV SECTION HOVER + ELLIPSIS GAP + BLANK DISMISS QA PASS');
}catch(error){
  console.error(error);
  await page.screenshot({path:'cvstudio-section-hover-error.png',fullPage:true}).catch(()=>{});
  throw error;
}finally{await browser.close();}
