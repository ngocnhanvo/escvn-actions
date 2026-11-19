import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});
try {
  await page.goto('https://esc.vn/khuyen-mai',{waitUntil:'domcontentloaded',timeout:60000});
  const info=await page.evaluate(()=>{
    const norm=s=>String(s||'').replace(/\\s+/g,' ').trim();
    const tags=[...document.querySelectorAll('h2,h3,h4,h5')].filter(e=>/TRI ÂN NGÀY|Tên Miền Việt Nam|Tặng Tên Miền \\.IO|DEAL HOT|Tên Miền Quốc Tế/i.test(e.textContent||''));
    return tags.map((el,i)=>{
      const chain=[];let e=el;
      for(let j=0;j<7&&e;j++,e=e.parentElement){
        const r=e.getBoundingClientRect(),s=getComputedStyle(e);
        chain.push({depth:j,tag:e.tagName,class:e.className,id:e.id,children:e.children.length,headings:e.querySelectorAll('h2,h3,h4,h5').length,ctaCount:e.querySelectorAll('a').length,details:(e.textContent||'').includes('Xem chi tiết'),textLen:(e.textContent||'').length,rect:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)],display:s.display,position:s.position,grid:s.gridTemplateColumns,font:s.fontFamily,size:s.fontSize,overflow:s.overflow});
      }
      return {i,title:norm(el.textContent),style:{font:getComputedStyle(el).fontFamily,fontSize:getComputedStyle(el).fontSize},chain,outer:el.parentElement?.outerHTML.slice(0,2500)};
    });
  });
  console.log('PROMO_INSPECT',JSON.stringify(info));
}finally{await browser.close();}
