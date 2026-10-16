import { chromium } from 'playwright';
const url='https://esc.vn/tao-cv-truc-tuyen/';
const api='https://admin.esc.vn/wp-json/esc-cv/v1/templates';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:860}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
// Gate the template registry until the initial HTML skeleton has been
// asserted, regardless of runner/network speed. page.request is separate.
let releaseTemplateFetch=()=>{};
const templateFetchGate=new Promise(resolve=>{releaseTemplateFetch=resolve;});
await page.route('**/wp-json/esc-cv/v1/templates',async route=>{
  await templateFetchGate;
  await route.continue();
});
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const seen=async(q)=>await page.locator(q).first().isVisible();
try {
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  assert(response?.status()===200,'CV Studio returns HTTP '+response?.status());
  // Skeleton lives in initial HTML even before the JS bundle has executed.
  assert(await page.locator('[data-cv-gallery-skeleton]').count()===2,
    'CV template grid should reserve two shimmer cards while the registry loads');
  assert((await page.locator('[data-cv-gallery]').getAttribute('aria-busy'))==='true',
    'CV gallery should announce that templates are loading');
  releaseTemplateFetch();
  await page.locator('#main-header').waitFor({state:'visible',timeout:15000});
  await page.locator('[data-tablepress-preview="cvstudio_00"] h1').waitFor({state:'visible',timeout:15000});
  for(const id of ['cvstudio_00','cvstudio_01','cvstudio_02'])
    assert(await page.locator('[data-tablepress-preview="'+id+'"]').count()>=1,'Section missing: '+id);
  const gallery=page.locator('[data-cv-gallery]');
  await gallery.waitFor({state:'attached'});
  const apiRes=await page.request.get(api,{timeout:30000});
  assert(apiRes.ok(),'CV Manager public REST returned '+apiRes.status());
  const data=await apiRes.json();
  assert(Array.isArray(data.templates),'CV Manager REST payload shape invalid');
  console.log('Active CV templates:',data.templates.map(t=>t.id+'@'+t.version).join(', ') || '(none)');
  if(!data.templates.length)throw Error('No active templates in ESC CV Manager; activate at least one before end-to-end QA');
  await gallery.locator('article:not([data-cv-gallery-skeleton])').first().waitFor({state:'visible',timeout:30000});
  assert(await gallery.locator('[data-cv-gallery-skeleton]').count()===0,
    'Loading placeholders must disappear after the AJAX result is rendered');
  assert((await gallery.getAttribute('aria-busy'))==='false',
    'CV gallery must leave loading state once AJAX finishes');
  assert(await gallery.locator('.cv-gallery-image-shimmer').count()>0,
    'CV preview cards need a dedicated image-load shimmer');
  // The browser gallery, not only the privileged runner's server-side REST,
  // must be capable of accessing the cross-origin API and loading imagery.
  const first=gallery.locator('article').first();
  assert((await first.locator('img').getAttribute('src'))?.startsWith('https://admin.esc.vn/'),'Gallery image is not the public WordPress image');
  // Full-template preview works without starting the wizard.
  await first.locator('button').first().click();
  const popup=page.locator('[data-cv-sample-preview]');
  await popup.waitFor({state:'visible',timeout:10000});
  await popup.locator('[data-cv-sample-image]').waitFor({state:'visible'});
  assert((await popup.locator('img').getAttribute('src'))?.startsWith('https://admin.esc.vn/'),
    'Template preview must use public WordPress image');
  await popup.locator('[data-cv-sample-close]').click();
  assert(!(await popup.isVisible()),'Template preview modal did not close');
  // Anonymous visitors select a template, edit and download without login.
  await page.locator('[data-cv-start]').first().click();
  assert(await page.locator('[data-cv-dialog]').count()===0,
    'Landing must not ask visitors to sign in before editing');
  const chosenTemplate=data.templates.find(t=>t.id==='M26')||data.templates[0];
  const target=gallery.locator('article').filter({hasText:chosenTemplate.id}).first();
  await target.locator('button').first().click();
  await popup.waitFor({state:'visible',timeout:10000});
  await popup.locator('[data-cv-sample-close]').click();
  await target.locator('button').last().click();
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  const workspace=page.locator('[data-cv-builder-workspace]');
  await workspace.waitFor({state:'visible',timeout:30000});
  assert((await page.locator('[data-cv-domain]').textContent())?.includes('Chưa công khai'),
    'CV must remain private until the Publish CV action');
  assert((await page.locator('[data-cv-template-name]').textContent())?.includes(chosenTemplate.id),
    'Builder must load the clicked template anonymously');
  assert(await page.locator('[data-cv-publish]').isEnabled(),
    'Publish action must become available after the CV loads');
  assert(await page.locator('[data-cv-publish-dialog]').isHidden(),
    'Login must not appear automatically in the CV Builder');
  const frame=page.locator('[data-cv-live-frame]');
  await frame.waitFor({state:'visible'});
  const srcdoc=await frame.getAttribute('srcdoc');
  assert(srcdoc?.includes('Content-Security-Policy'),'Preview must be sandboxed');
  const advanced=page.locator('[data-cv-advanced]');
  assert(!(await advanced.getAttribute('open')),'Long editor form must initially be collapsed');
  // The preview must expand to the real CV height and leave vertical scroll
  // to the parent page; check this both before and after structural edits.
  const assertNaturalHeight=async(stage)=>{
    await page.waitForFunction(()=>{
      const frame=document.querySelector('[data-cv-live-frame]');
      const doc=frame?.contentDocument;
      return frame&&doc?.body&&
        frame.getAttribute('scrolling')==='no'&&
        getComputedStyle(doc.documentElement).overflow==='hidden'&&
        frame.clientHeight+4>=doc.body.scrollHeight;
    },null,{timeout:15000});
    const sizes=await page.evaluate(()=>{
      const frame=document.querySelector('[data-cv-live-frame]');
      const doc=frame.contentDocument;
      return {frame:frame.clientHeight,body:doc.body.scrollHeight,
        html:doc.documentElement.scrollHeight,
        overflow:getComputedStyle(doc.documentElement).overflow};
    });
    // html.scrollHeight can include the template's own body margins even
    // when no internal scrollbar exists, e.g. min-height:100vh layouts.
    assert(sizes.overflow==='hidden'&&sizes.frame+4>=sizes.body,
      stage+': CV content exceeds its iframe height '+JSON.stringify(sizes));
  };
  const cvFrame=page.frameLocator('[data-cv-live-frame]');
  const nameTarget=cvFrame.locator('[data-cv-inline="profile.fullName"]').first();
  await nameTarget.waitFor({state:'visible',timeout:15000});
  await assertNaturalHeight('Initial CV '+chosenTemplate.id);
  const sectionTitle=cvFrame.locator('[data-cv-section-title-editable]').first();
  await sectionTitle.waitFor({state:'visible',timeout:15000});
  const sectionTitleId=await sectionTitle.getAttribute('data-cv-section-title-editable');
  const beforeTitleEdit=await frame.getAttribute('srcdoc');
  await sectionTitle.fill('KINH NGHIỆM NỔI BẬT QA');
  assert((await sectionTitle.textContent())==='KINH NGHIỆM NỔI BẬT QA',
    'User must edit static English/Vietnamese headings directly in CV');
  assert((await frame.getAttribute('srcdoc'))===beforeTitleEdit,
    'Editing CV section heading must not reload the iframe');
  // Edit at the caret inside the live template, not in a separate form.
  const originalSrcdoc=await frame.getAttribute('srcdoc');
  await page.evaluate(()=>{
    const f=document.querySelector('[data-cv-live-frame]');
    f.contentDocument.documentElement.setAttribute('data-qa-persistent-document','yes');
  });
  // Editing is active before the first click: a single pointer action must
  // place the native caret without an extra click or any iframe reload.
  assert(await nameTarget.getAttribute('contenteditable')==='true',
    'CV text must be editable before clicking');
  await nameTarget.click();
  assert(await nameTarget.evaluate(node=>node.ownerDocument.activeElement===node),
    'First click must focus CV text and position its caret');
  assert(await nameTarget.getAttribute('contenteditable')==='true',
    'Click CV text should keep direct plaintext editing enabled');
  assert(await page.locator('[data-cv-focused] input').count()===0,
    'Text editing must not require a contextual input');
  await nameTarget.fill('');
  await nameTarget.pressSequentially('NGUYỄN VĂN QA',{delay:12});
  assert((await nameTarget.textContent())?.trim()==='NGUYỄN VĂN QA','Text did not update at the caret');
  assert((await frame.getAttribute('srcdoc'))===originalSrcdoc,
    'Typing must not replace iframe.srcdoc or cause visible flicker');
  assert(await page.evaluate(()=>document.querySelector('[data-cv-live-frame]')?.contentDocument
    ?.documentElement.getAttribute('data-qa-persistent-document'))==='yes',
    'Typing replaced the CV document, resetting scroll and focus');
  // Basic markup injection remains text; never executable HTML.
  await nameTarget.fill('<b>QA</b>');
  assert((await nameTarget.textContent())?.trim()==='<b>QA</b>',
    'Pasted-looking markup should remain plain text');
  assert(await cvFrame.locator('b').filter({hasText:'QA'}).count()===0,
    'User input created an HTML element');
  await nameTarget.fill('NGUYỄN VĂN QA');
  assert(await page.locator('[data-cv-builder-fields] details').count()>0,
    'Template-defined array fields must be editable');
  await cvFrame.locator('[data-cv-inline="profile.avatarUrl"]').first().click();
  assert((await page.locator('[data-cv-focused] label').textContent())?.includes('Ảnh chân dung'),
    'Click portrait must open its contextual file picker');
  assert(await page.locator('[data-cv-focused] input[type=file]').count()===1,
    'Portrait field must accept an image upload');
  // An overlay on the actual portrait must open a native chooser directly;
  // selecting a picture updates the iframe DOM without resetting the draft.
  const portrait=cvFrame.locator('img[data-cv-inline="profile.avatarUrl"]').first();
  const avatarButton=cvFrame.locator('[data-cv-avatar-action]');
  await portrait.hover();
  await avatarButton.waitFor({state:'visible',timeout:10000});
  assert((await avatarButton.textContent())?.includes('Đổi ảnh'),
    'Hover on a CV portrait must show an in-preview Change photo button');
  const pickerEvent=page.waitForEvent('filechooser',{timeout:10000});
  await avatarButton.click();
  const nativeChooser=await pickerEvent;
  await nativeChooser.setFiles({
    name:'portrait.png',mimeType:'image/png',
    buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/tH0AAAAASUVORK5CYII=','base64')
  });
  await page.waitForFunction(()=>{
    const f=document.querySelector('[data-cv-live-frame]');
    return f?.contentDocument?.querySelector('img[data-cv-inline="profile.avatarUrl"]')
      ?.getAttribute('src')?.startsWith('data:image/png;base64,');
  },null,{timeout:10000});
  assert((await frame.getAttribute('srcdoc'))===originalSrcdoc,
    'Direct avatar replacement must not reload CV iframe');
  // Simulate a realistic >230KB PNG, using native browser canvas pixels,
  // then exercise the same avatar input change path as the file chooser.
  const bigAvatarBytes=await page.evaluate(async()=>{
    const frame=document.querySelector('[data-cv-live-frame]');
    const doc=frame.contentDocument;
    const input=doc.querySelector('input[type=file][accept*="image/jpeg"]');
    if(!input)throw Error('Direct avatar file input missing');
    const canvas=document.createElement('canvas');
    canvas.width=780;canvas.height=780;
    const ctx=canvas.getContext('2d');
    const img=ctx.createImageData(canvas.width,canvas.height);
    let seed=12345;
    for(let i=0;i<img.data.length;i+=4){
      seed=(Math.imul(seed,1664525)+1013904223)>>>0;
      img.data[i]=seed&255;
      img.data[i+1]=(seed>>>8)&255;
      img.data[i+2]=(seed>>>16)&255;
      img.data[i+3]=255;
    }
    ctx.putImageData(img,0,0);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob||blob.size<=230000)throw Error('Test image was not larger than the upload budget');
    const file=new File([blob],'large-avatar.png',{type:'image/png'});
    const transfer=new DataTransfer();transfer.items.add(file);
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return blob.size;
  });
  assert(bigAvatarBytes>230000,'Large avatar fixture must exercise image compression');
  await page.waitForFunction(()=>{
    const text=document.querySelector('[data-cv-avatar-toast-text]')?.textContent||'';
    return text.includes('tự tối ưu');
  },null,{timeout:30000});
  const optimized=await portrait.getAttribute('src');
  assert(/^data:image\/(webp|jpeg);base64,/.test(optimized||''),
    'Large avatar should be optimized into a JPEG or WebP data URL');
  assert((await frame.getAttribute('srcdoc'))===originalSrcdoc,
    'Auto-compressing a large avatar must not reload the CV iframe');
  // Unsupported types must give an immediately visible, explicit error.
  await page.evaluate(()=>{
    const doc=document.querySelector('[data-cv-live-frame]').contentDocument;
    const input=doc.querySelector('input[type=file][accept*="image/jpeg"]');
    const transfer=new DataTransfer();
    transfer.items.add(new File(['invalid'],'photo.heic',{type:'image/heic'}));
    input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await page.locator('[data-cv-avatar-toast]').waitFor({state:'visible',timeout:10000});
  assert((await page.locator('[data-cv-avatar-toast-text]').textContent())?.includes('HEIC'),
    'Unsupported avatar format must show a visible HEIC error');
  assert((await frame.getAttribute('srcdoc'))===originalSrcdoc,
    'Rejected avatar upload must not reload CV preview');
  const other=cvFrame.locator('[data-cv-inline^="experiences."]').first();
  assert(await other.count()>0,'Experience entries must be addressable on the CV');
  await other.click();
  assert(await other.getAttribute('contenteditable')==='true',
    'Click experience must edit the corresponding template field in place');
  await other.fill('KINH NGHIỆM QA');
  assert((await other.textContent())?.trim()==='KINH NGHIỆM QA',
    'Experience field failed to update in the CV');
  assert((await frame.getAttribute('srcdoc'))===originalSrcdoc,
    'Editing nested experience must not reload the iframe');
  await advanced.locator('summary').first().click();
  assert(await advanced.getAttribute('open')!==null,'Adding and removing groups must remain available');
  await page.locator('[data-cv-draft-save]').click();
  assert((await page.locator('[data-cv-status]').textContent())?.includes('trình duyệt'),
    'Save must clearly state browser-local draft status');
  await page.reload({waitUntil:'domcontentloaded',timeout:60000});
  await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
  const restored=page.frameLocator('[data-cv-live-frame]').locator('[data-cv-inline="profile.fullName"]').first();
  await restored.waitFor({state:'visible',timeout:15000});
  assert((await restored.textContent())?.trim()==='NGUYỄN VĂN QA',
    'Inline text draft should survive a reload in the same test browser');
  const restoredTitle=page.frameLocator('[data-cv-live-frame]')
    .locator('[data-cv-section-title-editable="'+sectionTitleId+'"]');
  await restoredTitle.waitFor({state:'visible',timeout:15000});
  assert((await restoredTitle.textContent())==='KINH NGHIỆM NỔI BẬT QA',
    'Edited section heading must persist in the saved local CV draft');
  // M01 regression: the GitHub/other empty bound fields must be large enough
  // to hit, visibly labeled and editable with precisely one click.
  const m01=data.templates.find(t=>t.id==='M01');
  if(m01){
    await page.evaluate(selection=>{
      sessionStorage.setItem('esc-cvstudio:demo:selection',JSON.stringify({
        id:selection.id,version:selection.version,domain:selection.domain,at:Date.now()
      }));
    },{id:m01.id,version:m01.version,domain:selected});
    await page.goto('https://esc.vn/tao-cv-truc-tuyen/builder/',{waitUntil:'domcontentloaded',timeout:60000});
    await page.locator('[data-cv-builder-workspace]').waitFor({state:'visible',timeout:30000});
    const empty=page.frameLocator('[data-cv-live-frame]').locator('[data-cv-inline].cv-inline-target:empty').first();
    await empty.waitFor({state:'visible',timeout:15000});
    const metrics=await empty.evaluate(node=>({
      width:node.getBoundingClientRect().width,
      label:getComputedStyle(node,'::before').content,
      editable:node.getAttribute('contenteditable')
    }));
    assert(metrics.width>=100,'Empty CV field click target too narrow: '+metrics.width);
    assert(metrics.label.includes('Nhấp để sửa'),'Empty field should show an editable placeholder');
    assert(metrics.editable==='plaintext-only','Empty field must be editable before first click');
    const m01Srcdoc=await page.locator('[data-cv-live-frame]').getAttribute('srcdoc');
    const clickedEmpty=await empty.elementHandle();
    assert(clickedEmpty,'Empty CV binding handle unavailable');
    await empty.click();
    assert(await clickedEmpty.evaluate(node=>node.ownerDocument.activeElement===node),
      'Empty CV field first click must focus the typing caret');
    // The element stops matching :empty as soon as typing starts. Keep the
    // original DOM handle instead of re-querying a different empty field.
    await page.keyboard.type('Nội dung kiểm thử',{delay:12});
    assert((await clickedEmpty.evaluate(node=>node.textContent||'')).includes('Nội dung kiểm thử'),
      'Empty CV placeholder did not accept typing on first click');
    assert(await page.locator('[data-cv-live-frame]').getAttribute('srcdoc')===m01Srcdoc,
      'Editing an empty field reloaded CV iframe and caused flicker');
  }
  // Repeatable editor: operations are driven by #each markers (not custom
  // M01/M26 markup) and must keep the same iframe document and srcdoc.
  const repeatFrame=page.frameLocator('[data-cv-live-frame]');
  const repeatIframe=page.locator('[data-cv-live-frame]');
  const experience=repeatFrame.locator('[data-cv-inline^="experiences."]').first();
  await experience.waitFor({state:'visible',timeout:15000});
  const originalRepeatDoc=await repeatIframe.getAttribute('srcdoc');
  const countRows=async()=>page.evaluate(()=>{
    const doc=document.querySelector('[data-cv-live-frame]').contentDocument;
    const walker=doc.createTreeWalker(doc.body,NodeFilter.SHOW_COMMENT);
    let count=0;
    while(walker.nextNode()){
      if(/^esc-cv:row:start:experiences\.\d+$/.test(walker.currentNode.data))count++;
    }
    return count;
  });
  const beforeRows=await countRows();
  assert(beforeRows>0,'M01 experiences must have repeatable row markers');
  const toolbar=repeatFrame.locator('[data-cv-repeat-toolbar]');
  const trigger=toolbar.locator('.esc-cv-repeat-trigger');
  const menu=repeatFrame.locator('[data-cv-repeat-menu]');
  await experience.hover();
  await trigger.waitFor({state:'visible',timeout:10000});
  assert(await toolbar.locator('button').count()===1,
    'Hover must only reveal the compact ellipsis, not a full toolbar over CV text');
  assert(!(await menu.isVisible()),'Context menu must remain hidden until explicitly opened');
  // Editable text must keep the browser's native right-click menu.
  const keepsNativeContext=await experience.evaluate(node=>{
    const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:100});
    node.dispatchEvent(event);
    return !event.defaultPrevented;
  });
  assert(keepsNativeContext,'Right click on editable CV text must preserve copy/paste');
  const action=async(kind)=>{
    if(!(await menu.isVisible())){
      await experience.hover();
      await trigger.click();
    }
    const pin=await trigger.boundingBox();
    const popup=await menu.boundingBox();
    assert(pin&&popup,'CV contextual ellipsis or action menu is not measurable');
    // It must touch the trigger rather than opening beside the full CV row.
    const xNear=popup.x<=pin.x+pin.width+10&&popup.x+popup.width>=pin.x-10;
    const yNear=Math.abs(popup.y-(pin.y+pin.height))<=10||
      Math.abs((popup.y+popup.height)-pin.y)<=10;
    assert(xNear&&yNear,
      'CV contextual menu is too far from its ellipsis button: '+JSON.stringify({pin,popup}));
    await menu.locator('[data-cv-action="'+kind+'"]').first().click();
  };
  await action('add');
  assert(await countRows()===beforeRows+1,'Add must append one CV experience row');
  await assertNaturalHeight('After adding a CV experience');
  assert((await repeatIframe.getAttribute('srcdoc'))===originalRepeatDoc,
    'Adding a CV item must patch one region, not reload the iframe');
  await action('duplicate');
  assert(await countRows()===beforeRows+2,'Duplicate must insert a copy of the item');
  await action('down');
  assert(await countRows()===beforeRows+2,'Move must preserve row count');
  const movedOutline=repeatFrame.locator('.esc-cv-repeat-outline');
  assert(await movedOutline.isVisible(),'Moved CV item must remain outlined after Down');
  assert((await movedOutline.getAttribute('data-cv-selected-path'))==='experiences.1',
    'Selection must follow the moved experience to its new index');
  assert(await menu.isVisible(),
    'Context menu should remain available for another move without reselecting');
  await action('up');
  assert((await movedOutline.getAttribute('data-cv-selected-path'))==='experiences.0',
    'Up must keep the original moved experience outlined at its new position');
  assert(await movedOutline.isVisible() && await menu.isVisible(),
    'Selection outline and menu must survive consecutive moves');
  await action('delete');
  assert(await countRows()===beforeRows+1,'Delete must remove only selected item');
  await assertNaturalHeight('After deleting a CV experience');
  assert((await repeatIframe.getAttribute('srcdoc'))===originalRepeatDoc,
    'Repeatable editing must not flicker/reload the CV document');
  // Exercise actual binary downloads, not just button presence.
  const fs=await import('node:fs/promises');
  for(const [format,extension,signature] of [
    ['source','.zip',Buffer.from('504b0304','hex')],
    ['pdf','.pdf',Buffer.from('%PDF-')],
    ['png','.png',Buffer.from('89504e470d0a1a0a','hex')]
  ]){
    await page.locator('[data-cv-export-summary]').click();
    const downloadPromise=page.waitForEvent('download',{timeout:45000});
    await page.locator('[data-cv-export-format="'+format+'"]').click();
    const download=await downloadPromise;
    assert(download.suggestedFilename().endsWith(extension),
      'Incorrect CV '+format+' filename');
    const file=await fs.readFile(await download.path());
    assert(file.length>1200 && file.subarray(0,signature.length).equals(signature),
      'CV '+format+' was not a valid nonempty '+extension+' download');
    console.log('Anonymous CV '+format.toUpperCase()+' download: '+file.length+' bytes PASS');
  }
  // Publishing is the ONLY place where a login and domain selection appear.
  await page.locator('[data-cv-publish]').click();
  const publish=page.locator('[data-cv-publish-dialog]');
  await publish.waitFor({state:'visible'});
  const login=publish.locator('[data-cv-publish-login]');
  await login.locator('input[name=email]').fill('demo@esc.vn');
  await login.locator('input[name=password]').fill('wrong-password');
  await login.locator('button[type=submit]').click();
  assert(await publish.locator('[data-cv-publish-error]').isVisible(),
    'Bad demo credentials should not bypass Publish gate');
  await login.locator('input[name=password]').fill('Demo@123');
  await login.locator('button[type=submit]').click();
  await publish.locator('[data-cv-publish-step="domain"]').waitFor({state:'visible'});
  const choices=publish.locator('input[name=cv-publish-domain]');
  assert(await choices.count()>0,'Publish step must list WordPress-owned demo domains');
  await choices.first().check();
  await publish.locator('[data-cv-publish-finish]').click();
  await publish.locator('[data-cv-publish-step="finish"]').waitFor({state:'visible'});
  assert((await publish.locator('[data-cv-publish-step="finish"]').textContent())
    ?.includes('chưa được công khai'), 'Demo flow must not claim a live publication');
  await publish.locator('[data-cv-publish-done]').click();
  assert(await publish.isHidden(),'Demo publish dialog must close without losing Builder');
  assert(errors.length===0,'Frontend JavaScript exception: '+errors.join(' | '));
  console.log('ESC CV Studio: one-click editing, ellipsis/context actions add/duplicate/move/delete without iframe reload, photo and draft: PASS');

}catch(e){
  console.error('ESC CV Studio public-flow QA failed:',e?.stack||e, 'Browser errors:',errors);
  await page.screenshot({path:'cvstudio-public-qa-failure.png',fullPage:true}).catch(()=>{});
  throw e;
}finally{await browser.close();}
