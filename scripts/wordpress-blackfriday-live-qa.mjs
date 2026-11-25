import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true});
const title='BLACK FRIDAY – SĂN DEAL VÀNG GIÁ KỊCH SÀN';
const detailTitle='BLACK FRIDAY - SĂN DEAL VÀNG GIÁ KỊCH SÀN';
const previousTitle='TRI ÂN NGÀY NHÀ GIÁO VIỆT NAM 20/11';
try {
 for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
  const page=await browser.newPage({viewport});
  try{
   const response=await page.goto('https://esc.vn/khuyen-mai',{waitUntil:'domcontentloaded',timeout:60000});
   assert.equal(response?.status(),200,'Promotion page status');
   const heading=page.getByRole('heading',{name:title,exact:true});
   await heading.waitFor({state:'visible',timeout:20000});
   assert.equal(await heading.count(),1,'Black Friday card duplicated');
   assert.equal(await page.getByRole('heading',{name:previousTitle,exact:true}).count(),0,'EDU20 promotion was not replaced');
   const card=heading.locator('xpath=../../..'); // Exact offer card, not the whole promotion grid
   assert.ok(await card.count(),'Black Friday card wrapper missing');
   const cta=card.getByRole('link',{name:'Đăng ký ngay'}).first();
   assert.equal(new URL(await cta.getAttribute('href'),'https://esc.vn').pathname,'/dang-ky-ten-mien','Registration CTA changed');
   const summary=await card.innerText();
   for(const fragment of ['70%','Hosting và Email','30%','VPS','BF2026','25-29/11/2026','Hỗ trợ 24/7','1900 2069','cskh@esc.vn']){
    assert.ok(summary.includes(fragment),'Summary missing '+fragment);
   }
   const email=card.locator('li.mceEditable a[href="mailto:cskh@esc.vn"]');
   assert.equal(await email.count(),1,'Email must be a mailto link in the card');
   const layout=await page.evaluate(()=>{
    const heads=[...document.querySelectorAll('h2')];
    const black=heads.find(el=>el.textContent.trim()==='BLACK FRIDAY – SĂN DEAL VÀNG GIÁ KỊCH SÀN');
    const old=heads.find(el=>el.textContent.includes('DEAL HOT KHÔNG THỂ BỎ LỠ'));
    const toCard=el=>el?.parentElement?.parentElement?.parentElement;
    const card=toCard(black), other=toCard(old);
    const grid=card?.parentElement?.parentElement;
    const boxes=grid?[...grid.children].map(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};}):[];
    const overlap=[];
    boxes.forEach((a,i)=>boxes.forEach((b,j)=>{
     if(j<=i)return;
     if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>4 &&
        Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>4)overlap.push([i,j]);
    }));
    const promoLi=[...card?.querySelectorAll('li.mceEditable')||[]].find(el=>el.textContent.includes('BF2026'));
    const oldLi=[...other?.querySelectorAll('li.mceEditable')||[]].find(el=>el.style.fontSize&&el.querySelector('span'));
    const style=el=>el?{font:getComputedStyle(el).fontFamily,size:getComputedStyle(el).fontSize,color:getComputedStyle(el).color,line:getComputedStyle(el).lineHeight}:null;
    const foot=document.querySelector('footer');
    return {
     gridChildren:grid?.children.length,
     gridDisplay:grid&&getComputedStyle(grid).display,
     newWrapperChildren:card?.parentElement?.children.length,
     oldWrapperChildren:other?.parentElement?.children.length,
     cardParentsSeparate:card?.parentElement!==other?.parentElement,
     overlap,
     gridBottom:grid?.getBoundingClientRect().bottom,
     footerTop:foot?.getBoundingClientRect().top,
     fontBlack:style(promoLi),fontOther:style(oldLi),
     width:window.innerWidth,scrollWidth:document.documentElement.scrollWidth,
     headingSize:black&&getComputedStyle(black).fontSize,
     otherHeadingSize:old&&getComputedStyle(old).fontSize,
    };
   });
   assert.equal(layout.gridChildren,7,'Promotion list must still have seven cards');
   assert.equal(layout.gridDisplay,'flex','Promotion flex grid changed');
   assert.equal(layout.newWrapperChildren,1,'Black Friday shares grid cell with another card');
   assert.equal(layout.oldWrapperChildren,1,'Deal Hot card wrapper changed');
   assert.ok(layout.cardParentsSeparate,'Black Friday and Deal Hot must be separate cards');
   assert.deepEqual(layout.overlap,[],'Promotions overlap');
   assert.ok(layout.scrollWidth<=layout.width+2,'Page has horizontal overflow');
   if(layout.footerTop!==undefined)assert.ok(layout.footerTop+1>=layout.gridBottom,'Promotions overlap footer');
   assert.deepEqual(layout.fontBlack,layout.fontOther,'Summary font style differs from original promotions');
   assert.equal(layout.headingSize,layout.otherHeadingSize,'Promotion heading font differs from original');
   console.log('BF2026_LAYOUT_PASS',JSON.stringify({viewport,...layout}));
   await page.screenshot({path:'bf2026-layout-'+viewport.width+'.png',fullPage:true});
   const detailsButton=card.getByText('Xem chi tiết',{exact:true}).first();
   assert.ok(await detailsButton.isVisible(),'Missing Xem chi tiết');
   await detailsButton.click();
   const headingDetail=card.getByRole('heading',{name:detailTitle,exact:true}).first();
   await headingDetail.waitFor({state:'visible',timeout:6000});
   const details=await card.innerText();
   for(const fragment of [
    'Kính gửi Quý khách hàng','BLACK FRIDAY - SĂN DEAL VÀNG GIÁ KỊCH SÀN','70%',
    'Hosting và Email','30%','VPS (*)','BF2026','Cách thức tham gia',
    'Truy cập website','Lựa chọn dịch vụ mình cần đăng ký','Tiến hành đặt hàng và thanh toán',
    'ESC tiến hành cấp phát sau khi nhận được đơn hàng','Thời gian áp dụng',
    '25-29/11/2026','Thông tin liên hệ','1900 2069','cskh@esc.vn',
    'eCloud1 trở lên','Phòng Kinh doanh','Công ty TNHH Giải Pháp Trực Tuyến',
   ])assert.ok(details.includes(fragment),'Modal detail missing: '+fragment);
   const modal=card.locator('.esc-modal-content');
   assert.ok(await modal.isVisible(),'Black Friday modal did not open');
   const banner=modal.locator('img[alt="ESC Black Friday 2026 – Săn deal vàng giá kịch sàn"]');
   assert.equal(await banner.count(),1,'Black Friday banner absent from popup');
   await banner.scrollIntoViewIfNeeded();
   const img=await banner.evaluate(el=>({loaded:el.complete&&el.naturalWidth>0,width:el.naturalWidth,src:el.getAttribute('src'),srcset:el.getAttribute('srcset')}));
   assert.ok(img.loaded&&img.width>0,'Black Friday popup banner not loaded');
   const modalEmail=modal.locator('a[href="mailto:cskh@esc.vn"]');
   assert.equal(await modalEmail.count(),1,'Modal email link missing');
   await page.screenshot({path:'bf2026-popup-'+viewport.width+'.png',fullPage:false});
   console.log('BF2026_POPUP_PASS',JSON.stringify({viewport,cta:await cta.getAttribute('href'),image:img}));
  }catch(err){
   console.error('BF2026_QA_FAIL',JSON.stringify({viewport,error:String(err)}));
   await page.screenshot({path:'bf2026-error-'+viewport.width+'.png',fullPage:true}).catch(()=>{});
   throw err;
  }finally{await page.close();}
 }
}finally{await browser.close();}
