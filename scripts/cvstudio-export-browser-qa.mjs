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
  // M01 is a one-page CV; exporting it must never append a blank A4 page.
  const card=gallery.locator('article:not([data-cv-gallery-skeleton])').filter({hasText:'M01'}).first();
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
  assert(await page.locator('[data-cv-draft-save]').count()===0,'Manual Save Draft button must be removed');
  await page.waitForFunction(()=>document.querySelector('[data-cv-autosave]')?.textContent?.includes('Đã tự động lưu'),null,{timeout:8000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  assert((await page.frameLocator('[data-cv-live-frame]').locator('[data-cv-inline="profile.fullName"]').first().textContent())==='THỬ XUẤT CV ẨN DANH','Auto-saved text was lost on reload');

  // Blank CV paper must clear all editing affordances, including the
  // contextual row outline and the small text-formatting pencil.
  const canvasFrame=page.frameLocator('[data-cv-live-frame]');
  const selectedRow=canvasFrame.locator('[data-cv-inline^="skills.0."]').first();
  await selectedRow.waitFor({state:'visible',timeout:10000});
  await selectedRow.hover();
  const contextual=canvasFrame.locator('[data-cv-repeat-toolbar]');
  assert(await contextual.isVisible(),'Hovering a bound item should show contextual controls');
  const blankLocation=await canvasFrame.locator('body').evaluate(body=>{
    const doc=body.ownerDocument;
    const rect=body.getBoundingClientRect();
    const width=doc.documentElement.clientWidth;
    const height=Math.min(doc.documentElement.clientHeight,950);
    for(const y of [height-35,height-75,650,550,450,300]){
      for(const x of [width-25,width-75,Math.round(width*.8),Math.round(width*.32)]){
        if(x<10||y<10||y>height-5)continue;
        const node=doc.elementFromPoint(x,y);
        if(!node||node.closest('[data-cv-inline],[data-cv-section-title-editable],button,input,textarea,.esc-cv-repeat-outline,.esc-cv-repeat-toolbar,.esc-cv-repeat-menu,.esc-cv-text-toolbar,.esc-cv-text-quick,.esc-cv-avatar-action'))continue;
        return {x:x-rect.left,y:y-rect.top};
      }
    }
    return null;
  });
  assert(!!blankLocation,'No blank CV area available for dismissal test');
  await canvasFrame.locator('body').click({position:blankLocation,force:true});
  assert(await contextual.isHidden(),'Blank click did not dismiss the row ellipsis');
  assert(await canvasFrame.locator('.esc-cv-repeat-outline').isHidden(),
    'Blank click did not clear the blue selected-row border');
  assert(await canvasFrame.locator('[data-cv-text-quick]').isHidden(),
    'Blank click kept the floating text pencil visible');
  // The same item must become selectable again when explicitly hovered.
  await selectedRow.hover();
  assert(await contextual.isVisible(),'Item controls did not reappear on a deliberate hover');
  console.log('PASS CV blank-paper dismissal of all contextual item controls');
  // Clicking the outer Builder sidebar should also dismiss controls in
  // the isolated CV iframe (not only clicks within the paper itself).
  await selectedRow.hover();
  assert(await contextual.isVisible(),'Contextual controls did not reappear for outer-click test');
  await page.locator('[data-cv-template-name]').click();
  assert(await contextual.isHidden(),'Builder sidebar click did not dismiss CV item controls');
  assert(await canvasFrame.locator('[data-cv-text-quick]').isHidden(),
    'Builder sidebar click left floating CV format icon visible');
  console.log('PASS CV outside-iframe selection dismissal');


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
    if(format==='pdf'){
      const match=bytes.toString('latin1').match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/);
      assert(!!match,'Cannot read PDF page count');
      console.log('M01 PDF A4 PAGE COUNT:',match[1]);
      assert(Number(match[1])===1,'M01 PDF unexpectedly contains a blank second A4 page');
    }
    console.log('PASS anonymous '+format+' '+bytes.length+' bytes');
  }
  // Switching design is an anonymous, in-place operation and must preserve edits.
  await page.locator('[data-cv-switch-open]').click();
  const switchDialog=page.locator('[data-cv-switch-dialog]');
  await switchDialog.waitFor({state:'visible',timeout:10000});
  const nextDesign=switchDialog.locator('[data-cv-switch-item^="M26@"]').first();
  await nextDesign.waitFor({state:'visible',timeout:15000});
  await nextDesign.click();
  assert(await switchDialog.locator('[data-cv-switch-reuse]').isChecked(),'Reuse checkbox should default to checked');
  assert((await switchDialog.locator('[data-cv-switch-name]').textContent())?.length>0,
    'Switch preview failed to display template name');
  await switchDialog.locator('[data-cv-switch-confirm]').click();
  await switchDialog.waitFor({state:'hidden',timeout:20000});
  assert((await page.locator('[data-cv-template-name]').textContent())?.includes('M26'),
    'CV template did not switch to M26 in-place');
  await cvFrame.locator('[data-cv-inline="profile.fullName"]').first().waitFor({state:'visible'});
  assert((await cvFrame.locator('[data-cv-inline="profile.fullName"]').first().textContent())
    ==='THỬ XUẤT CV ẨN DANH','Switching CV templates lost the name user edited');
  assert((await page.locator('[data-cv-domain]').textContent())?.includes('Chưa công khai'),
    'Template switch unexpectedly triggered publication');
  await cvFrame.locator('[data-cv-inline="profile.fullName"]').first().fill('BẢN NHÁP RIÊNG M26');
  await page.waitForFunction(()=>document.querySelector('[data-cv-autosave]')?.textContent?.includes('Đã tự động lưu'),null,{timeout:8000});
  // Unchecked reuse should restore the original saved M01 draft without a popup.
  await page.evaluate(()=>{
    const button=document.querySelector('[data-cv-switch-open]');
    const dialog=document.querySelector('[data-cv-switch-dialog]');
    window.__cvDialogTrace=[];
    for(const type of ['pointerdown','mousedown','pointerup','mouseup','click']){
      button.addEventListener(type,()=>window.__cvDialogTrace.push('button '+type),true);
      document.addEventListener(type,event=>{
        const target=event.target;
        window.__cvDialogTrace.push('doc '+type+' '+(target?.tagName||'')+
          ' '+(target?.getAttribute?.('data-cv-switch-open')!==null?'on-switch':''));
      },true);
    }
    const show=dialog.showModal.bind(dialog);
    dialog.showModal=()=>{
      window.__cvDialogTrace.push('showModal invoked');
      return show();
    };
    const close=dialog.close.bind(dialog);
    dialog.close=()=>{
      window.__cvDialogTrace.push('close invoked');
      return close();
    };
    const observer=new MutationObserver(()=>window.__cvDialogTrace.push('open='+dialog.open));
    observer.observe(dialog,{attributes:true,attributeFilter:['open']});
    dialog.addEventListener('close',()=>window.__cvDialogTrace.push('native close'));
  });
  console.log('Before reopen:',await page.locator('[data-cv-switch-open]').evaluate(el=>({
    disabled:el.disabled,outer:el.outerHTML.slice(0,220),rect:el.getBoundingClientRect().toJSON(),active:document.activeElement?.tagName
  })));
  await page.locator('[data-cv-switch-open]').click();
  console.log('After reopen:',await switchDialog.evaluate(el=>({
    open:el.open,hidden:el.hidden,display:getComputedStyle(el).display
  })), 'status:',await page.locator('[data-cv-status]').textContent(),
  'console:',consoleErrors.slice(-10),'exceptions:',errors.slice(-10),
  'trace:',await page.evaluate(()=>window.__cvDialogTrace),
  'active:',await page.evaluate(()=>document.activeElement?.outerHTML?.slice(0,280)));
  await switchDialog.waitFor({state:'visible',timeout:7000});
  await switchDialog.locator('[data-cv-switch-item^="M01@"]').first().click();
  await switchDialog.locator('[data-cv-switch-reuse]').uncheck();
  await switchDialog.locator('[data-cv-switch-confirm]').click();
  await switchDialog.waitFor({state:'hidden',timeout:20000});
  assert((await page.locator('[data-cv-template-name]').textContent())?.includes('M01'),
    'CV did not switch back to the original template');
  assert((await cvFrame.locator('[data-cv-inline="profile.fullName"]').first().textContent())
    ==='THỬ XUẤT CV ẨN DANH','Switching back lost the edited CV data');
  await page.locator('[data-cv-switch-open]').click();
  await switchDialog.waitFor({state:'visible'});
  await switchDialog.locator('[data-cv-switch-item^="M26@"]').first().click();
  await switchDialog.locator('[data-cv-switch-reuse]').uncheck();
  await switchDialog.locator('[data-cv-switch-confirm]').click();
  await switchDialog.waitFor({state:'hidden',timeout:20000});
  assert((await page.locator('[data-cv-template-name]').textContent())?.includes('M26'),
    'Switching without reuse should load the separate M26 draft');
  assert((await cvFrame.locator('[data-cv-inline="profile.fullName"]').first().textContent())
    ==='BẢN NHÁP RIÊNG M26','Unchecked reuse should restore M26 independent autosaved draft');
  await page.locator('[data-cv-switch-open]').click();
  await switchDialog.waitFor({state:'visible'});
  await switchDialog.locator('[data-cv-switch-item^="M01@"]').first().click();
  await switchDialog.locator('[data-cv-switch-reuse]').uncheck();
  await switchDialog.locator('[data-cv-switch-confirm]').click();
  await switchDialog.waitFor({state:'hidden',timeout:20000});
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  assert((await page.frameLocator('[data-cv-live-frame]').locator(
    '[data-cv-inline="profile.fullName"]').first().textContent())==='THỬ XUẤT CV ẨN DANH',
    'Browser reload after switching CV templates lost the edited data');
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
