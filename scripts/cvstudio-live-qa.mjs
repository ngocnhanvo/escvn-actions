import { chromium } from 'playwright';
const url='https://esc.vn/tao-cv-truc-tuyen/';
const api='https://admin.esc.vn/wp-json/esc-cv/v1/templates';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1366,height:860}});
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
const seen=async(q)=>await page.locator(q).first().isVisible();
try {
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
  assert(response?.status()===200,'CV Studio returns HTTP '+response?.status());
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
  await gallery.locator('article').first().waitFor({state:'visible',timeout:30000});
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
  const demoUser=page.locator('[data-cv-dialog]');
  await page.locator('[data-cv-start]').first().click();
  await demoUser.waitFor({state:'visible'});
  const login=demoUser.locator('[data-cv-login-form]');
  await login.locator('input[name=email]').fill('demo@esc.vn');
  const password=login.locator('input[name=password]');
  const toggle=login.locator('[data-cv-password-toggle]');
  assert(await password.getAttribute('type')==='password','Password must initially be concealed');
  await toggle.click();
  assert(await password.getAttribute('type')==='text','Password eye must show plaintext');
  assert(await toggle.getAttribute('aria-pressed')==='true','Password toggle pressed state missing');
  await toggle.click();
  assert(await password.getAttribute('type')==='password','Password eye must conceal again');
  await password.fill('wrong-password');
  await login.locator('button[type=submit]').click();
  assert(await seen('[data-cv-login-error]'),'Invalid demo login must show an error');
  assert(!(await seen('[data-cv-step="domain"]')),'Invalid login bypassed the domain step gate');
  await login.locator('input[name=password]').fill('Demo@123');
  await login.locator('button[type=submit]').click();
  const domainStep=demoUser.locator('[data-cv-step="domain"]');
  await domainStep.waitFor({state:'visible',timeout:8000});
  assert(await domainStep.locator('h3').count()===0,'Domain step repeated title');
  assert(await domainStep.locator(':scope > svg').count()===1,'Domain step icon must remain visible');
  assert((await demoUser.locator('#cvstudio-dialog-title').textContent())?.trim()==='Chọn tên miền cho CV',
    'Domain title belongs to dialog header only');
  const radios=domainStep.locator('input[name=cv-domain]');
  assert(await radios.count()>=1,'Missing WordPress-configured demo domain');
  const selected=await radios.first().inputValue();
  await radios.first().check();
  await domainStep.locator('[data-cv-domain-next]').click();
  const templateStep=demoUser.locator('[data-cv-step="templates"]');
  await templateStep.waitFor({state:'visible',timeout:15000});
  assert(await templateStep.locator(':scope > h3').count()===0,'Template step repeated title');
  assert(await templateStep.locator(':scope > svg').count()===0,'Template step icon must be removed');
  await templateStep.locator('[data-cv-dialog-templates] article').first().waitFor({state:'visible',timeout:15000});
  // The old fixed 3-field CV form has been removed.
  assert(await page.locator('[data-cv-step="editor"]').count()===0,'Obsolete 3-field editor still exists');
  const chosenTemplate=data.templates.find(t=>t.id==='M26')||data.templates[0];
  const target=templateStep.locator('article').filter({hasText:chosenTemplate.id}).first();
  // Preview does not advance the wizard.
  await target.locator('button').first().click();
  await popup.waitFor({state:'visible',timeout:10000});
  await popup.locator('[data-cv-sample-close]').click();
  await target.locator('button').last().click();
  await page.waitForURL('**/tao-cv-truc-tuyen/builder/**',{timeout:30000});
  const workspace=page.locator('[data-cv-builder-workspace]');
  await workspace.waitFor({state:'visible',timeout:30000});
  assert((await page.locator('[data-cv-domain]').textContent())===selected,
    'Selected domain must be carried to the Builder');
  assert((await page.locator('[data-cv-template-name]').textContent())?.includes(chosenTemplate.id),
    'Builder must load the clicked active template');
  const frame=page.locator('[data-cv-live-frame]');
  await frame.waitFor({state:'visible'});
  const srcdoc=await frame.getAttribute('srcdoc');
  assert(srcdoc?.includes('Content-Security-Policy'),'Preview must be sandboxed');
  const advanced=page.locator('[data-cv-advanced]');
  assert(!(await advanced.getAttribute('open')),'Long editor form must initially be collapsed');
  const cvFrame=page.frameLocator('[data-cv-live-frame]');
  const nameTarget=cvFrame.locator('[data-cv-inline="profile.fullName"]').first();
  await nameTarget.waitFor({state:'visible',timeout:15000});
  // Edit at the caret inside the live template, not in a separate form.
  const originalSrcdoc=await frame.getAttribute('srcdoc');
  await page.evaluate(()=>{
    const f=document.querySelector('[data-cv-live-frame]');
    f.contentDocument.documentElement.setAttribute('data-qa-persistent-document','yes');
  });
  // Editing is active before the first click: a single pointer action must
  // place the native caret without an extra click or any iframe reload.
  assert(await nameTarget.getAttribute('contenteditable')==='plaintext-only',
    'CV text must be editable before clicking');
  await nameTarget.click();
  assert(await nameTarget.evaluate(node=>node.ownerDocument.activeElement===node),
    'First click must focus CV text and position its caret');
  assert(await nameTarget.getAttribute('contenteditable')==='plaintext-only',
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
  const other=cvFrame.locator('[data-cv-inline^="experiences."]').first();
  assert(await other.count()>0,'Experience entries must be addressable on the CV');
  await other.click();
  assert(await other.getAttribute('contenteditable')==='plaintext-only',
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
      if(/^esc-cv:row:start:experiences\\.\\d+$/.test(walker.currentNode.data))count++;
    }
    return count;
  });
  const beforeRows=await countRows();
  assert(beforeRows>0,'M01 experiences must have repeatable row markers');
  await experience.hover();
  const toolbar=repeatFrame.locator('[data-cv-repeat-toolbar]');
  await toolbar.locator('[data-cv-action="add"]').waitFor({state:'visible',timeout:10000});
  await toolbar.locator('[data-cv-action="add"]').click();
  assert(await countRows()===beforeRows+1,'Add must append one CV experience row');
  assert((await repeatIframe.getAttribute('srcdoc'))===originalRepeatDoc,
    'Adding a CV item must patch one region, not reload the iframe');
  await experience.hover();
  await toolbar.locator('[data-cv-action="duplicate"]').click();
  assert(await countRows()===beforeRows+2,'Duplicate must insert a copy of the item');
  await experience.hover();
  await toolbar.locator('[data-cv-action="down"]').click();
  assert(await countRows()===beforeRows+2,'Move must preserve row count');
  await experience.hover();
  await toolbar.locator('[data-cv-action="delete"]').click();
  assert(await countRows()===beforeRows+1,'Delete must remove only selected item');
  assert((await repeatIframe.getAttribute('srcdoc'))===originalRepeatDoc,
    'Repeatable editing must not flicker/reload the CV document');
  assert(errors.length===0,'Frontend JavaScript exception: '+errors.join(' | '));
  console.log('ESC CV Studio: one-click editing, repeatable add/duplicate/move/delete without iframe reload, photo and draft: PASS');

}catch(e){
  console.error('ESC CV Studio public-flow QA failed:',e?.stack||e, 'Browser errors:',errors);
  await page.screenshot({path:'cvstudio-public-qa-failure.png',fullPage:true}).catch(()=>{});
  throw e;
}finally{await browser.close();}
