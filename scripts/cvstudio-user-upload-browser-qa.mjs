import {chromium} from 'playwright';
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGP8////fwYGBgYmBigAAD34BADaOyqcAAAAAElFTkSuQmCC','base64');
function crc32(data){
  let crc=0xffffffff;
  for(const byte of data){
    crc^=byte;
    for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function zipArchive(files){
  const body=[],central=[];let offset=0;
  for(const [name,raw] of Object.entries(files)){
    const filename=Buffer.from(name),data=Buffer.isBuffer(raw)?raw:Buffer.from(raw);
    const crc=crc32(data);
    const header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);
    header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26);
    body.push(header,filename,data);
    const item=Buffer.alloc(46);
    item.writeUInt32LE(0x02014b50);item.writeUInt16LE(20,4);
    item.writeUInt16LE(20,6);item.writeUInt32LE(crc,16);
    item.writeUInt32LE(data.length,20);item.writeUInt32LE(data.length,24);
    item.writeUInt16LE(filename.length,28);item.writeUInt32LE(offset,42);
    central.push(item,filename);offset+=header.length+filename.length+data.length;
  }
  const size=central.reduce((total,item)=>total+item.length,0);
  const end=Buffer.alloc(22),count=Object.keys(files).length;
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(count,8);end.writeUInt16LE(count,10);
  end.writeUInt32LE(size,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...body,...central,end]);
}
const manifest={
  id:'M99',version:'1.0.0',name:'CV Người dùng thử nghiệm',
  engine:'esc-cv-v1',schema:'esc-cv-v1',
  entry:'index.html',stylesheet:'style.css',preview:'preview.png',sample:'sample.json'
};
const template=zipArchive({
  'template.json':JSON.stringify(manifest),
  'index.html':'<h1>{{profile.fullName}}</h1><p>{{profile.jobTitle}}</p>{{#each skills}}<p>{{name}}</p>{{/each}}',
  'style.css':'body{font-family:sans-serif;padding:40px}',
  'preview.png':png,
  'sample.json':JSON.stringify({profile:{fullName:'Người dùng mẫu ESC',jobTitle:'Nhân viên'},skills:[{name:'Kỹ năng'}]})
});
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:900}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  const uploader=page.locator('[data-cv-user-upload-input]');
  await uploader.waitFor({state:'attached',timeout:30000});
  await uploader.setInputFiles({name:'resume.pdf',mimeType:'application/pdf',
    buffer:Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n')});
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-upload-readonly]').waitFor({state:'visible',timeout:20000});
  assert(await page.locator('[data-cv-builder-workspace]').isHidden(),'Readonly CV unexpectedly editable');
  assert(await page.locator('[data-cv-upload-pdf]').isVisible(),'PDF readonly preview missing');
  assert(await page.locator('[data-cv-publish]').isEnabled(),'Readonly CV cannot initiate demo publishing');
  await page.locator('[data-cv-publish]').click();
  assert(await page.locator('[data-cv-publish-step="login"]').isVisible(),'Demo publish gate missing');
  await page.locator('[data-cv-publish-close]').click();
  console.log('PASS non-ESC PDF read-only preview with deferred demo publishing');
  await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  await uploader.setInputFiles({name:'user-template.zip',mimeType:'application/zip',buffer:template});
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:25000});
  assert(await page.locator('[data-cv-upload-readonly]').isHidden(),'Valid ESC ZIP not editable');
  const name=page.frameLocator('[data-cv-live-frame]').locator('[data-cv-inline="profile.fullName"]').first();
  await name.waitFor({state:'visible',timeout:16000});
  assert((await name.textContent())?.includes('Người dùng mẫu ESC'),'Sample data missing');
  await name.fill('ĐÃ SỬA CV TẢI LÊN');
  await page.waitForFunction(()=>document.querySelector('[data-cv-autosave]')?.textContent?.includes('Đã tự động lưu'),null,{timeout:8000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:25000});
  assert((await page.frameLocator('[data-cv-live-frame]').locator('[data-cv-inline="profile.fullName"]').first().textContent())==='ĐÃ SỬA CV TẢI LÊN','Uploaded ESC draft not autosaved');
  console.log('PASS ESC ZIP schema detection, inline edit and automatic draft restore');
  const unsafe=zipArchive({
    ...Object.fromEntries(Object.entries({
      'template.json':JSON.stringify(manifest),
      'index.html':'<h1>{{profile.fullName}}</h1><script>window.top.__ESC_BAD=true</script>',
      'style.css':'body{font-family:sans-serif}',
      'preview.png':png
    }))
  });
  await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  await uploader.setInputFiles({name:'unsafe.zip',mimeType:'application/zip',buffer:unsafe});
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-upload-readonly]').waitFor({state:'visible',timeout:25000});
  assert(await page.locator('[data-cv-builder-workspace]').isHidden(),'Executable HTML got editable privilege');
  console.log('PASS unsafe template rejected as editable and isolated to readonly');
  assert(errors.length===0,'Unexpected JS errors: '+errors.join(' | '));
}finally{await browser.close();}
