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
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let published=null,issued=0;
await page.route('https://admin.esc.vn/wp-json/esc-cv/v1/publish/**',async route=>{
  const req=route.request();
  const headers={
    'Access-Control-Allow-Origin':'https://esc.vn',
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type, Accept',
    'Content-Type':'application/json'
  };
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
  if(req.url().includes('/publish/session')){
    issued++;
    return route.fulfill({status:200,headers,body:JSON.stringify({
      token:'1700000000.'+'a'.repeat(64),expires_in:600,protocol:'FTPS'
    })});
  }
  if(req.url().includes('/publish/ftps')){
    published=req.postDataJSON();
    return route.fulfill({status:200,headers,body:JSON.stringify({
      ok:true,url:'https://example.com/cv-demo/',note:'Mock FTPS upload: no network access'
    })});
  }
  return route.abort();
});
try{
  await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  const uploader=page.locator('[data-cv-user-upload-input]');
  await uploader.waitFor({state:'attached',timeout:30000});
  await uploader.setInputFiles({name:'cv-publish-ui-qa.zip',mimeType:'application/zip',buffer:zip});
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  await page.locator('[data-cv-publish]').click();
  const dialog=page.locator('[data-cv-publish-dialog]');
  await dialog.waitFor({state:'visible'});
  assert(await dialog.locator('[data-cv-publish-ftps-form]').isVisible(),
    'FTPS form must replace old demo Member login.');
  assert(await dialog.locator('[data-cv-publish-login]').count()===0,
    'Old hard-coded demo credentials must never be used.');
  await dialog.locator('[data-cv-publish-choice="member"]').click();
  assert(await dialog.locator('[data-cv-publish-member]').isVisible(),
    'Missing truthful Member integration status.');
  assert((await dialog.locator('[data-cv-publish-member]').textContent()).includes('Chưa kết nối'),
    'Must not pretend that Member authentication is active.');
  await dialog.locator('[data-cv-publish-choice="ftps"]').click();
  const form=dialog.locator('[data-cv-publish-ftps-form]');
  assert(await form.isVisible(),'Switching back to FTPS must restore form');
  await form.locator('input[name=host]').fill('ftp.example.com');
  await form.locator('input[name=username]').fill('qa-user');
  await form.locator('input[name=password]').fill('dummy-qa-secret-not-real');
  await form.locator('input[name=root]').fill('public_html');
  await form.locator('input[name=domain]').fill('example.com');
  await form.locator('input[name=slug]').fill('cv-demo');
  await form.locator('input[name=ownership]').check();
  await form.locator('[data-cv-publish-ftps-submit]').click();
  await dialog.locator('[data-cv-publish-finish]').waitFor({state:'visible',timeout:20000});
  assert(issued===1,'Secure session must be fetched exactly once');
  assert(published?.host==='ftp.example.com','Correct FTP host missing from payload');
  assert(published?.username==='qa-user' && published?.password==='dummy-qa-secret-not-real',
    'Credentials must only go through the explicitly mocked publisher endpoint');
  assert(published?.root==='public_html'&&published?.slug==='cv-demo',
    'Deploy destination was not preserved');
  assert(published?.html?.includes('Demo User'),'CV was not rendered with live draft data');
  assert(!published.html.includes('{{profile.fullName}}')&&!published.html.includes('<script'),
    'Unrendered template or executable code must never be published');
  assert(await form.locator('input[name=password]').inputValue()==='',
    'FTP password must be cleared after use');
  assert((await dialog.locator('[data-cv-publish-url]').getAttribute('href'))==='https://example.com/cv-demo/',
    'User must see the published CV link returned by backend');
  await dialog.locator('[data-cv-publish-done]').click();
  assert(await dialog.isHidden(),'Publish dialog must close while Builder draft remains');
  assert(errors.length===0,'Unexpected browser exceptions: '+errors.join(' | '));
  console.log('ESC CV FTPS PUBLISH UI WITH SAFE MOCKED API + MEMBER STATUS: PASS');
}catch(e){
  console.error(e);
  await page.screenshot({path:'cvstudio-publish-ui-failure.png',fullPage:true}).catch(()=>{});
  throw e;
}finally{await browser.close();}
