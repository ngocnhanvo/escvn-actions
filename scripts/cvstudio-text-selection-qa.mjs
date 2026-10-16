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
const jsErrors=[];page.on('pageerror',e=>jsErrors.push(e.message));
try{
  await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  const uploader=page.locator('[data-cv-user-upload-input]');
  await uploader.waitFor({state:'attached',timeout:30000});
  await uploader.setInputFiles({name:'text-selection-qa.zip',mimeType:'application/zip',buffer:zip});
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  const frame=page.frameLocator('[data-cv-live-frame]');
  const field=frame.locator('[data-cv-inline="profile.fullName"]').first();
  await field.waitFor({state:'visible',timeout:20000});
  const quick=frame.locator('[data-cv-text-quick]');
  const bar=frame.locator('[data-cv-text-toolbar]');
  await field.click();
  await quick.waitFor({state:'visible'});
  assert(await bar.isHidden(),'Caret editing must not open formatting toolbar');
  await field.evaluate(node=>{
    const text=node.firstChild;
    if(!text||text.nodeType!==Node.TEXT_NODE)throw Error('Expected original text node');
    const range=node.ownerDocument.createRange();range.setStart(text,0);range.setEnd(text,4);
    const selection=node.ownerDocument.getSelection();
    selection.removeAllRanges();selection.addRange(range);
    node.ownerDocument.dispatchEvent(new Event('selectionchange'));
  });
  assert(await bar.isHidden(),'Highlight must NOT auto-open the full toolbar');
  assert(await quick.isVisible(),'Highlight must reveal pencil icon');
  assert(await field.evaluate(node=>node.ownerDocument.getSelection().toString())==='Demo',
    'Native highlight must still select Demo');
  await quick.click();
  assert(await bar.isVisible(),'Clicking pencil must open toolbar');
  assert(await field.evaluate(node=>node.ownerDocument.getSelection().toString())==='Demo',
    'Opening pencil must preserve highlighted characters');
  await bar.locator('input[type=color]').evaluate(node=>{
    node.value='#ff0000';node.dispatchEvent(new Event('change',{bubbles:true}));
  });
  const runs=await field.evaluate(node=>({
    text:node.textContent,
    html:node.innerHTML,
    selection:node.ownerDocument.getSelection()?.toString()
  }));
  assert(runs.text==='Demo User','Color formatting unexpectedly changed text: '+JSON.stringify(runs));
  assert(/color:\s*(?:rgb\(255,\s*0,\s*0\)|#ff0000)/i.test(runs.html),
    'Selected Demo must get red style, not entire field: '+JSON.stringify(runs));
  const colored=await field.evaluate(node=>{
    const parts=[...node.querySelectorAll('span')].filter(el=>getComputedStyle(el).color==='rgb(255, 0, 0)');
    return parts.map(el=>el.textContent);
  });
  assert(colored.some(s=>s==='Demo'),'Selected part was not formatted independently: '+JSON.stringify(colored));
  assert(!colored.some(s=>s==='Demo User'),'Whole field was formatted when only Demo was selected');
  // Selecting a different substring should again collapse to an icon.
  await field.evaluate(node=>{
    const walker=node.ownerDocument.createTreeWalker(node,NodeFilter.SHOW_TEXT);
    let cur,offset=0,start=null,end=null;
    while((cur=walker.nextNode())){
      const next=offset+cur.textContent.length;
      if(start===null&&5>=offset&&5<=next)start={node:cur,offset:5-offset};
      if(end===null&&9>=offset&&9<=next)end={node:cur,offset:9-offset};
      offset=next;
    }
    if(!start||!end)throw Error('Unable to select User');
    const range=node.ownerDocument.createRange();
    range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);
    const selection=node.ownerDocument.getSelection();
    selection.removeAllRanges();selection.addRange(range);
    node.ownerDocument.dispatchEvent(new Event('selectionchange'));
  });
  assert(await quick.isVisible()&&await bar.isHidden(),
    'New selection must return to icon-only controls');
  assert(jsErrors.length===0,'Browser errors '+jsErrors.join('; '));
  console.log('CV HIGHLIGHT PENCIL + PARTIAL FORMATTING CHROMIUM QA PASS');
}catch(e){
  console.error(e);
  await page.screenshot({path:'cvstudio-text-selection-error.png',fullPage:true}).catch(()=>{});
  throw e;
}finally{await browser.close();}
