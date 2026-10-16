import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';

const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:900},acceptDownloads:true});
const errors=[],consoleErrors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error'||message.type()==='warning')consoleErrors.push(message.text());});
const assert=(ok,message)=>{if(!ok)throw Error(message);};
try{
  const response=await page.goto('https://esc.vn/tao-cv-truc-tuyen/',{waitUntil:'domcontentloaded',timeout:60000});
  assert(response?.ok(),'CV gallery unavailable');
  const gallery=page.locator('[data-cv-gallery]');
  const card=gallery.locator('article:not([data-cv-gallery-skeleton])').first();
  await card.waitFor({state:'visible',timeout:35000});
  assert(await page.locator('[data-cv-dialog]').count()===0,
    'Anonymous template selection must not show a Member login gate');
  await card.locator('button').last().click();
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  assert(await page.locator('[data-cv-publish-dialog]').isHidden(),
    'Publish login dialog must stay hidden for anonymous editing');
  const cvFrame=page.frameLocator('[data-cv-live-frame]');
  const name=cvFrame.locator('[data-cv-inline="profile.fullName"]').first();
  await name.waitFor({state:'visible',timeout:15000});
  await name.fill('THỬ XUẤT CV ẨN DANH');
  const checks=[
    ['source','.zip',Buffer.from([0x50,0x4b,0x03,0x04])],
    ['png','.png',Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])],
    ['pdf','.pdf',Buffer.from('%PDF-')]
  ];
  for(const [format,ext,magic] of checks){
    await page.locator('[data-cv-export-summary]').click();
    const downloadPromise=page.waitForEvent('download',{timeout:15000});
    await page.locator('[data-cv-export-format="'+format+'"]').click();
    let file;
    try{file=await downloadPromise;}
    catch(error){
      console.error('FAILED FORMAT:',format);
      console.error('BUILDER STATUS:',await page.locator('[data-cv-status]').innerText());
      console.error('PAGE ERRORS:',errors);
      console.error('CONSOLE ERRORS:',consoleErrors.slice(-30));
      console.error('FRAME:',await page.locator('[data-cv-live-frame]').getAttribute('sandbox'));
      throw error;
    }
    assert(file.suggestedFilename().endsWith(ext),'Unexpected file type for '+format);
    const bytes=await readFile(await file.path());
    assert(bytes.length>1500,'Empty or incomplete '+format+' file');
    assert(bytes.subarray(0,magic.length).equals(magic),'Invalid '+format+' file signature');
    if(format==='source')assert(bytes.includes(Buffer.from('THỬ XUẤT CV ẨN DANH')),
      'ZIP did not contain the current in-browser CV edits');
    console.log('PASS anonymous '+format+' '+bytes.length+' bytes');
  }
  await page.locator('[data-cv-publish]').click();
  const dialog=page.locator('[data-cv-publish-dialog]');
  await dialog.waitFor({state:'visible'});
  assert(await dialog.locator('[data-cv-publish-step="login"]').isVisible(),
    'Publishing must begin with login, not domain/template choice');
  const form=dialog.locator('[data-cv-publish-login]');
  await form.locator('input[name=email]').fill('demo@esc.vn');
  await form.locator('input[name=password]').fill('Demo@123');
  await form.locator('button[type=submit]').click();
  await dialog.locator('[data-cv-publish-step="domain"]').waitFor({state:'visible',timeout:10000});
  assert(await dialog.locator('input[name=cv-publish-domain]').count()>=1,
    'No domain list after demo login');
  await dialog.locator('input[name=cv-publish-domain]').first().check();
  await dialog.locator('[data-cv-publish-finish]').click();
  await dialog.locator('[data-cv-publish-step="finish"]').waitFor({state:'visible'});
  assert((await dialog.locator('[data-cv-publish-step="finish"]').innerText()).includes('chưa được công khai'),
    'Demo publish step must not pretend to have published a live CV');
  await dialog.locator('[data-cv-publish-done]').click();
  assert(await dialog.isHidden(),'Publish dialog did not close');
  assert((await name.textContent())==='THỬ XUẤT CV ẨN DANH',
    'CV edits were lost across the login/domain demo flow');
  assert(errors.length===0,'Unhandled frontend JS exceptions: '+errors.join('|'));
  console.log('PASS CV anonymous download ZIP/PNG/PDF and deferred demo publication');
}catch(error){
  console.error('CV export browser QA failed:',error);
  await page.screenshot({path:'cv-export-qa-failure.png',fullPage:true}).catch(()=>{});
  throw error;
}finally{await browser.close();}
