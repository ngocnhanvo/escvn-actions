import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true});
const title='TRI ÂN NGÀY NHÀ GIÁO VIỆT NAM 20/11';
const detailTitle='Tri ân Ngày Nhà giáo Việt Nam 20/11 – ESC tặng 20 tên miền .EDU.VN';
try {
  for (const size of [{width:1440,height:900},{width:390,height:844}]) {
    const page=await browser.newPage({viewport:size});
    try {
      const response=await page.goto('https://esc.vn/khuyen-mai',{waitUntil:'domcontentloaded',timeout:60000});
      assert.equal(response?.status(),200,'Promotion page HTTP');
      const heading=page.getByRole('heading',{name:title,exact:true});
      await heading.waitFor({state:'visible',timeout:20000});
      assert.equal(await heading.count(),1,'Exactly one EDU20 promotion card is expected');
      const card=heading.locator('xpath=ancestor::*[.//a[contains(normalize-space(.), "Đăng ký ngay")]]').first();
      assert.ok(await card.count(),'EDU20 card not found');
      const cta=card.getByRole('link',{name:'Đăng ký ngay'}).first();
      assert.equal(new URL(await cta.getAttribute('href'),'https://esc.vn').pathname,'/dang-ky-ten-mien','CTA target mismatch');
      for (const text of ['Tặng 20 tên miền .EDU.VN','Mã KM: EDU20','Liên hệ: 1900 2069','Free Support 24/24']) {
        assert.ok((await card.innerText()).includes(text),'Card missing: '+text);
      }

      const layout=await page.evaluate(()=>{
        const titles=[...document.querySelectorAll('h2')];
        const newHeading=titles.find(x=>x.textContent.trim()==='TRI ÂN NGÀY NHÀ GIÁO VIỆT NAM 20/11');
        const oldHeading=titles.find(x=>x.textContent.includes('DEAL HOT KHÔNG THỂ BỎ LỠ'));
        const shell=h=>h?.parentElement?.parentElement?.parentElement;
        const newCard=shell(newHeading),oldCard=shell(oldHeading);
        const grid=newCard?.parentElement?.parentElement;
        const items=grid?[...grid.children]:[];
        const rects=items.map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};});
        const list=[...newCard.querySelectorAll('ul')].find(ul=>[...ul.children].some(li=>li.textContent.includes('Mã KM: EDU20')));
        const eduLi=[...(list?.children||[])].find(x=>x.textContent.includes('Mã KM: EDU20'));
        const oldLi=[...oldCard.querySelectorAll('li.mceEditable')].find(x=>x.querySelector('span')&&x.style.fontSize&&x.style.color);
        const getStyle=el=>el?{font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,color:getComputedStyle(el).color,line:getComputedStyle(el).lineHeight}:null;
        const footer=document.querySelector('footer');
        const footerRect=footer?.getBoundingClientRect();
        const overlapping=[];
        rects.forEach((a,i)=>rects.forEach((b,j)=>{
          if(j<=i)return;
          const width=Math.min(a.right,b.right)-Math.max(a.left,b.left);
          const height=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);
          if(width>4&&height>4)overlapping.push([i,j,Math.round(width),Math.round(height)]);
        }));
        return {
          gridChildren:items.length,
          cardParentsSeparate:newCard?.parentElement!==oldCard?.parentElement,
          newWrapperChildren:newCard?.parentElement?.children.length,
          oldWrapperChildren:oldCard?.parentElement?.children.length,
          gridDisplay:grid&&getComputedStyle(grid).display,
          rects,overlapping,
          eduStyle:getStyle(eduLi),oldStyle:getStyle(oldLi),
          gridBottom:grid?.getBoundingClientRect().bottom,
          footerTop:footerRect?.top,
          viewportWidth:window.innerWidth,
          scrollWidth:document.documentElement.scrollWidth,
        };
      });
      console.log('EDU20_LAYOUT',JSON.stringify({viewport:size,...layout}));
      assert.equal(layout.gridChildren,7,'Expected seven separate promotion cards');
      assert.equal(layout.newWrapperChildren,1,'EDU20 must not share wrapper with Deal Hot');
      assert.equal(layout.oldWrapperChildren,1,'Original Deal Hot must remain a separate card');
      assert.ok(layout.cardParentsSeparate,'EDU20 and original share parent wrapper');
      assert.equal(layout.gridDisplay,'flex','Promotion grid display changed');
      assert.deepEqual(layout.overlapping,[],'Promotion cards overlap');
      for(const key of ['font','size','color','line']){
        assert.ok(layout.eduStyle&&layout.oldStyle,'Offer item typography unavailable');
        assert.equal(layout.eduStyle[key],layout.oldStyle[key],'EDU20 offer '+key+' differs from other cards');
      }
      assert.ok(layout.scrollWidth<=layout.viewportWidth+2,'Horizontal page overflow');
      if(layout.footerTop!==undefined)assert.ok(layout.footerTop+1>=layout.gridBottom,'Promotions overlap footer');

      const view=card.getByText('Xem chi tiết',{exact:true}).first();
      assert.ok(await view.isVisible(),'Xem chi tiết missing');
      await view.click();
      const detail=card.getByRole('heading',{name:detailTitle,exact:true}).first();
      await detail.waitFor({state:'visible',timeout:5000});
      const detailText=await card.innerText();
      for(const text of ['Nhân Ngày Nhà giáo Việt Nam','Thông tin chương trình','Các tổ chức hoạt động trong lĩnh vực giáo dục','20/11/2026','EDU20'])assert.ok(detailText.includes(text),'Details missing: '+text);
      const banner=card.locator('img[alt*="Tri ân Ngày Nhà giáo Việt Nam"]').first();
      assert.ok(await banner.count(),'Campaign banner missing');
      await banner.scrollIntoViewIfNeeded();
      await banner.evaluate(img=>new Promise((resolve,reject)=>{
        if(img.complete)return img.naturalWidth>0?resolve():reject(Error('Banner has no pixels'));
        img.addEventListener('load',()=>resolve(),{once:true});
        img.addEventListener('error',()=>reject(Error('Banner could not load')),{once:true});
      }));
      console.log('EDU20_LIVE_QA_PASS',JSON.stringify({viewport:size,cta:await cta.getAttribute('href'),banner:await banner.getAttribute('src')}));
    } catch(error) {
      console.error('EDU20_QA_FAIL',JSON.stringify({viewport:size,reason:String(error),titleCount:await page.getByRole('heading',{name:title,exact:true}).count(),pageText:(await page.locator('body').innerText().catch(()=>'' )).slice(0,1100)}));
      await page.screenshot({path:'edu20-failure-'+size.width+'.png',fullPage:true}).catch(()=>{});
      throw error;
    } finally {await page.close();}
  }
} finally {await browser.close();}
