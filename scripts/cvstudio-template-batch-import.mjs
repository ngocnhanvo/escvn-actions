import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Each row is drawn from the existing ESC gallery, not an invented design.
// [id, name, role, hue, accent, layout, contrast, avatar crop on 500x707 image]
const designs=[
[27,'Ryan Mitchell','B2B Sales Manager','#08345e','#1ba4c4','left','dark',[43,35,138,138]],
[28,'Lucas Bennett','Senior Product Designer','#e9e6dc','#918875','left','light',[43,42,120,140]],
[29,'Ethan Carter','Senior Software Engineer','#282828','#888888','left','dark',[49,37,108,111]],
[30,'Ethan Carter','Senior Software Engineer','#465d7d','#7593ae','left','dark',[52,26,103,108]],
[31,'Michael Reynolds','Senior Financial Analyst','#0b2c4c','#399aaa','left','dark',[51,29,86,86]],
[32,'Ryan Mitchell','B2B Sales Manager','#3a2720','#b98a6d','left','dark',[36,16,125,124]],
[33,'Jason Turner','HR Business Partner','#eaedf1','#68778e','top','light',[46,29,81,106]],
[34,'Michael Reynolds','Senior Financial Analyst','#f2ebe3','#b1a085','right','light',[338,25,122,154]],
[35,'Kevin Walker','Operations Manager','#f5f7f9','#a1cee5','top','light',[48,75,86,87]],
[36,'Lucas Bennett','Senior Product Designer','#302825','#9d6c51','split','dark',[337,34,111,130]],
[37,'Jonathan Hayes','Management Consultant','#e9edf5','#8194b3','top','light',[47,36,90,92]],
[38,'Jonathan Hayes','Management Consultant','#15233f','#e5a01e','left','dark',[35,27,76,80]],
[39,'Ryan Mitchell','B2B Sales Manager','#0c405b','#20a3ba','right','dark',[388,28,82,82]],
[40,'Christopher Reed','Compliance Manager','#183f33','#56c4a3','top','dark',[32,22,82,81]],
[41,'Kevin Walker','Operations Manager','#f2f1ff','#898bee','top','light',[397,26,75,82]],

[42,'Michael Reynolds','Senior Financial Analyst','#fff8fb','#d68a9f','top','light',[106,28,64,72]],
[43,'Ethan Carter','Senior Software Engineer','#ffffff','#ada364','plain','light',[0,0,120,120]],
[44,'Matthew Foster','Marketing Analyst','#ffffff','#35b9cb','plain','light',[0,0,120,120]],
[45,'Daniel Brooks','Business Analyst','#18263b','#b5d26e','left','dark',[14,27,73,78]],
[46,'Ryan Mitchell','B2B Sales Manager','#44306e','#9d81c9','top','dark',[18,24,72,77]],
[47,'Christopher Reed','Compliance Manager','#f4fffb','#4ad2ad','top','light',[406,28,68,74]],
[49,'Ethan Carter','Senior Software Engineer','#073f58','#39c5d6','right','dark',[391,27,73,75]],
[50,'Michael Reynolds','Senior Financial Analyst','#ecfcf7','#209c7f','top','light',[21,42,67,67]],
[51,'Daniel Brooks','Business Analyst','#283c98','#6a72da','left','dark',[17,31,72,72]],
[52,'Kevin Walker','Operations Manager','#80314d','#c87695','right','dark',[411,27,75,75]],
[53,'Ryan Mitchell','B2B Sales Manager','#faf3e6','#c4a965','left','light',[23,25,77,77]],
[54,'Lucas Bennett','Senior Product Designer','#ffffff','#39baca','plain','light',[0,0,120,120]],
[55,'Andrew Collins','Business Consultant','#ffffff','#a7c54c','plain','light',[0,0,120,120]],
[56,'Matthew Foster','Marketing Analyst','#412470','#a58bda','top','dark',[414,28,68,72]],
[57,'Michael Reynolds','Senior Financial Analyst','#f3fffc','#3ab89e','top','light',[24,31,71,74]],
[58,'Jonathan Hayes','Management Consultant','#172942','#d7a520','right','dark',[403,28,76,80]],
[59,'Ethan Carter','Senior Software Engineer','#ffffff','#139b93','plain','light',[0,0,120,120]],
[60,'Michael Reynolds','Senior Financial Analyst','#edfbf6','#39bd9e','top','light',[20,28,69,73]],
[61,'Daniel Brooks','Business Analyst','#353ea0','#7b7fe3','top','dark',[24,22,73,76]],
[62,'Kevin Walker','Operations Manager','#7c2d4b','#c57d95','right','dark',[416,26,70,72]],
[63,'Ryan Mitchell','B2B Sales Manager','#5c3d29','#bea16d','top','dark',[40,19,98,110]],
[64,'Lucas Bennett','Senior Product Designer','#f6fcfe','#3ac8f0','top','light',[17,18,68,70]],
[65,'Andrew Collins','Business Consultant','#202733','#accc59','right','dark',[397,30,82,92]],

[66,'Matthew Foster','Marketing Analyst','#ffffff','#9373b7','top','light',[20,23,70,73]],
[67,'Christopher Reed','Compliance Manager','#e9fcf5','#2fcca0','left','light',[32,27,68,78]],
[68,'Brandon Scott','Business Consultant','#0e2546','#cbaa4c','top','dark',[17,25,75,76]],
[69,'Thomas Parker','Business Analyst','#0e4560','#27bad4','top','dark',[19,26,72,79]],
[70,'Nathan Evans','Business Consultant','#174537','#3bbf95','top','dark',[405,24,72,78]],
[71,'Samuel Wright','Product Designer','#f5f3fe','#6b68ca','top','light',[21,29,75,81]],
[72,'Ethan Carter','Senior Software Engineer','#641c3c','#e06891','left','dark',[19,27,77,81]],
[73,'Michael Reynolds','Senior Financial Analyst','#ffffff','#bf9231','top','light',[389,28,81,91]],
[74,'Daniel Brooks','Business Analyst','#eefbff','#39bcd1','top','light',[18,28,73,73]],
[75,'Kevin Walker','Operations Manager','#fbfdf2','#c7d556','top','light',[23,28,71,79]],
[76,'Andrew Collins','Business Consultant','#42266c','#a486d4','top','dark',[19,26,73,78]],
[77,'Noah Adams','Business Consultant','#ffffff','#35b99f','top','light',[220,26,66,76]]
];
const origin=new URL(process.env.WP_ADMIN_URL||'https://admin.esc.vn').origin;
if(new URL(origin).hostname!=='admin.esc.vn')throw Error('Unsafe WP target');
const out=path.resolve('generated-cv');
await fs.mkdir(out,{recursive:true});
const escapeHtml=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const section=(title,content,cls='')=>'<section class="'+cls+'"><h2>'+title+'</h2>'+content+'</section>';
const each=(key,content)=>'{{#each '+key+'}}'+content+'{{/each}}';
const contact=section('CONTACT','<p>{{profile.location}}</p><p>{{profile.phone}}</p><p>{{profile.email}}</p><p>{{profile.website}}</p>','contact');
const edu=section('EDUCATION & CREDENTIALS',each('education','<div class="entry"><b>{{degree}}</b><p>{{institution}}</p><p>{{period}}</p></div>'),'education');
const skills=section('TECHNICAL SKILLS','<ul>'+each('skills','<li>{{name}}</li>')+'</ul>','skills');
const langs=section('LANGUAGES','<ul>'+each('languages','<li>{{name}}</li>')+'</ul>','languages');
const about=section('ABOUT ME','<p>{{profile.summary}}</p>','about');
const work=section('EXPERIENCE',each('employmentHistory','<div class="entry"><b>{{role}}</b><p>{{employer}} · {{period}}</p><p>{{summary}}</p></div>'),'work');
const impact=section('SELECTED IMPACT',each('achievements','<p>{{text}}</p>'),'impact');
const avatar='<img class="avatar" alt="CV portrait" src="{{profile.avatarUrl}}">';
const name='<h1>{{profile.fullName}}</h1><p class="role">{{profile.jobTitle}}</p>';
function html(n,layout){
 const side=contact+edu+skills+langs;
 if(layout==='split')return '<!doctype html><html><head></head><body><div class="cv v'+n+' split"><aside><div class="intro">'+name+about+'</div>'+side+'</aside><main>'+avatar+work+impact+'</main></div></body></html>';
 if(layout==='plain')return '<!doctype html><html><head></head><body><div class="cv v'+n+' plain"><header>'+name+'</header>'+about+'<div class="columns"><main>'+work+impact+'</main><aside>'+edu+skills+langs+contact+'</aside></div></div></body></html>';
 if(layout==='top')return '<!doctype html><html><head></head><body><div class="cv v'+n+' top"><header>'+avatar+'<div>'+name+'<p class="mini">{{profile.location}} · {{profile.email}}</p></div></header><div class="columns"><aside>'+about+edu+skills+langs+'</aside><main>'+work+impact+'</main></div></div></body></html>';
 return '<!doctype html><html><head></head><body><div class="cv v'+n+' '+layout+'"><aside><div class="photo">'+avatar+'</div>'+side+'</aside><main><header>'+name+'</header>'+about+work+impact+'</main></div></body></html>';
}
const commonCss=[
'*{box-sizing:border-box}html,body{margin:0;padding:0;background:white;color:#24313b;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.48}',
'.cv{display:grid;grid-template-columns:34% 66%;width:800px;min-height:1130px;margin:0 auto;background:white;--accent:#689aaf;--side:#16334a;--sideText:white}',
'.cv>aside{background:var(--side);color:var(--sideText);padding:36px 33px;min-height:1130px}.cv>main{padding:57px 45px 40px}',
'.cv.right{grid-template-columns:65% 35%}.right>aside{grid-column:2;grid-row:1}.right>main{grid-column:1;grid-row:1}',
'.photo{display:flex;justify-content:center;margin:0 0 42px}.avatar{width:132px;height:132px;display:block;border-radius:50%;object-fit:cover;object-position:center top;border:5px solid rgba(255,255,255,.7);background:#ccd3d9}',
'h1{font-size:27px;line-height:1.08;letter-spacing:.1px;text-transform:uppercase;margin:0 0 9px;font-weight:800}',
'.role{color:var(--accent);letter-spacing:1px;font-size:12px;font-weight:700;margin:0}',
'section{margin:0 0 43px;break-inside:avoid}section h2{font-size:12px;font-weight:800;letter-spacing:.45px;color:var(--accent);border-bottom:2px solid var(--accent);margin:0 0 12px;padding-bottom:7px}',
'aside section{margin-bottom:72px}aside section h2{color:var(--sideText);border-bottom-color:var(--sideText)}',
'section p{margin:0 0 7px;line-height:1.48}section ul{padding:0;list-style:none;margin:0}section li{line-height:1.6}',
'.entry{margin-bottom:20px;break-inside:avoid}.entry b{font-size:11px}.entry p{margin:3px 0}',
'main header{margin:0 0 50px;padding:0 0 26px;border-bottom:2px solid var(--accent)}',
'.cv.top{display:block}.top>header{display:flex;gap:28px;align-items:center;margin:0;padding:27px 46px;background:var(--side);color:var(--sideText)}',
'.top>header .avatar{width:105px;height:105px;flex:none}.top>header .mini{font-size:10px;opacity:.75}',
'.top .columns{display:grid;grid-template-columns:38% 62%}.top .columns>aside{color:#36414e;background:white;padding:30px 28px 10px 45px}.top .columns>main{padding:30px 43px 10px 22px}',
'.top .columns aside h2{color:var(--accent);border-bottom-color:var(--accent)}.top .columns aside section{margin-bottom:45px}',
'.cv.split{grid-template-columns:46% 54%}.split>aside{background:#faf7f0;color:#835d4b;padding:44px 40px}.split>main{background:#302825;color:#fff;padding:35px 36px}',
'.split .intro{background:#9d6c51;color:#fff;padding:24px;border-radius:16px;margin:0 -27px 45px -17px}.split .intro h2{color:#fff;border-color:#fff}',
'.split>main .avatar{margin:0 auto 52px}.split>main section h2{color:var(--accent)}',
'@media print{html,body{background:white}.cv{width:100%;min-height:0}section,.entry{break-inside:avoid}}'
].join('\n');
function css(d){
 const [n,, ,bg,accent,layout,contrast]=d;
 let c=commonCss+'\n.cv{--side:'+bg+';--accent:'+accent+';--sideText:'+(contrast==='dark'?'#fff':'#5b554d')+'}\n';
 if([27,31,38].includes(n))c+='.cv{grid-template-columns:37% 63%}.cv>main{padding-top:34px}.photo{margin-bottom:60px}\n';
 if(n===27)c+='.cv>main>header{background:#0a335d;margin:-34px -45px 40px;padding:52px 45px 34px;color:white}.cv>main>header h1{color:white}\n';
 if(n===28)c+='.cv{position:relative;grid-template-columns:36% 64%}.cv>aside{margin-top:310px;min-height:820px}.photo{position:absolute;left:58px;top:45px}.cv>main{padding-top:80px}\n';
 if(n===29)c+='.cv>aside{border-radius:19px;margin:0 18px;min-height:1130px}.cv aside section{background:#373737;border-radius:12px;padding:12px}\n';
 if(n===30)c+='.cv>aside{border-radius:20px;margin:68px 15px 16px;min-height:1030px}.photo{margin-top:-100px}.cv main section{background:#eef3f9;border-radius:20px;padding:18px;margin-bottom:27px}\n';
 if(n===31)c+='.cv main .work{min-height:360px}.cv>aside .avatar{width:120px;height:120px}\n';
 if(n===32)c+='.cv main header{background:#b78869;margin:-57px -45px 45px;padding:55px 30px 45px;color:white}.cv main header h1,.cv main header .role{color:white}\n';
 if(n===33)c+='.top>header{background:#f1f2f5}.top>header .avatar{border-radius:13px}.top .columns aside .about,.top .columns main .impact{background:#f4f5f6;border-radius:14px;padding:17px}\n';
 if(n===34)c+='.cv{position:relative}.cv>aside{border-radius:14px;margin:188px 14px 20px;min-height:870px}.photo{position:absolute;right:45px;top:28px}.cv>main{padding-top:85px}\n';
 if(n===35)c+='.top>header{background:white;border-top:4px solid #191919;margin:17px 38px 0;padding:20px 0 23px}.top .columns aside .about,.top .columns main .impact{background:#f3f6f8;border-radius:15px;padding:18px}\n';
 if(n===36)c+='.split>main .avatar{width:151px;height:151px}.split>main .work{margin-top:56px}.split>aside section{margin-bottom:52px}\n';
 if(n===37)c+='.top>header{background:white}.top>header .avatar{width:160px;height:160px;border:20px solid #8c9bb5}.top .columns{grid-template-columns:60% 40%}.top .columns>aside{grid-column:2;grid-row:1;padding:25px 34px 15px 12px}.top .columns>main{grid-column:1;grid-row:1;padding:25px 20px 15px 50px}.top .columns .skills{background:#354256;color:#fff;padding:20px;border-radius:16px}.top .columns .skills h2{color:white;border-color:white}\n';
 if(n===38)c+='.cv{grid-template-columns:29% 71%}.cv>aside{border-left:8px solid #e5a01e}.cv aside .avatar{width:112px;height:112px}\n';
 if(n===39)c+='.cv{grid-template-columns:69% 31%}.cv>main{padding-top:54px}.cv>aside{background:#0c405b}\n';
 if(n===40)c+='.top>header{background:#183f33;color:white}.top .columns{grid-template-columns:65% 35%}.top .columns>aside{grid-column:2;grid-row:1;padding-left:12px}.top .columns>main{grid-column:1;grid-row:1;padding-left:48px}.top .columns aside .about{display:none}.top .columns main:before{content:ABOUT ME;display:block;border-bottom:2px solid var(--accent);color:var(--accent);font-weight:800;padding-bottom:8px;margin-bottom:16px}\n';
 if(n===41)c+='.top>header{border-top:9px solid #8b8df6;background:#f2f1ff}.top .columns{grid-template-columns:50% 50%}.top .columns>aside{grid-column:2;grid-row:1}.top .columns>main{grid-column:1;grid-row:1;padding-left:48px}.top .columns aside .about{display:none}\n';
 if(layout==='plain')c+='.cv.plain{display:block;padding:45px 52px;min-height:1130px}.plain>header{border-bottom:2px solid var(--accent);padding-bottom:27px;margin-bottom:45px}.plain>header h1{font-size:29px}.plain>.about{margin-bottom:52px}.plain .columns{display:grid;grid-template-columns:61% 39%;gap:22px}.plain .columns>main,.plain .columns>aside{padding:0;background:white;min-height:0;color:#28313b}.plain .columns aside section{margin-bottom:40px}.plain .columns aside h2{border-bottom-color:var(--accent);color:var(--accent)}\n';
 if(n===42)c+='.top>header{background:#fff;color:#34313b;flex-direction:column;text-align:center;border-bottom:2px solid #d88aa1}.top>header .avatar{width:80px;height:80px}.top .columns{display:block}.top .columns>aside{display:grid;grid-template-columns:1fr 1fr;gap:16px}.top .columns>main{padding:25px 45px 0}.top .columns>aside .about{display:none}\n';
 if(n===43||n===44||n===55)c+='.plain .columns{grid-template-columns:65% 35%}.plain>header{margin-bottom:28px}.plain section h2{letter-spacing:2px}.plain>.about{margin-bottom:58px}\n';
 if(n===45)c+='.cv{grid-template-columns:28% 72%}.cv>aside{min-height:1128px}.cv>aside .avatar{width:95px;height:95px}.cv>main{padding-top:47px}.cv>main .about{background:#f8fcf2;padding:14px}\n';
 if(n===46)c+='.top>header{background:#44306e;color:#fff}.top .columns{grid-template-columns:38% 62%}.top .columns aside .about{background:#f6f1fc;padding:15px;border-radius:14px}\n';
 if(n===47)c+='.top>header{background:#fff;color:#163d41;border-left:10px solid #4ad2ad}.top>header .avatar{order:2}.top .columns .work{background:#f2fff9;padding:20px;border-radius:13px}\n';
 if(n===49)c+='.cv{grid-template-columns:72% 28%}.cv>aside{background:#0c4059;border-radius:14px;margin:0 8px 10px}.cv main section{margin-bottom:60px}.cv main .work{min-height:420px}\n';
 if(n===50)c+='.top>header{background:#fff;color:#173c37}.top .columns{display:block}.top .columns>aside{display:grid;grid-template-columns:1fr 1fr;gap:18px}.top .columns>main{padding:20px 45px}.top .columns aside .about{display:none}.cv:after{content:REFERENCES;display:block;background:#18543f;color:white;padding:25px 45px;margin-top:20px}\n';
 if(n===51)c+='.cv{grid-template-columns:17% 83%}.cv>aside{padding:20px 12px;background:#343a98}.cv>aside .avatar{width:84px;height:84px}.cv aside section{margin-bottom:36px}.cv>main{padding-top:38px}\n';
 if(n===52||n===62)c+='.cv{grid-template-columns:82% 18%}.cv>aside{padding:18px 13px}.cv>aside .avatar{width:89px;height:89px}.cv aside section{font-size:9px}.cv>main{padding-top:43px}\n';
 if(n===53)c+='.cv{grid-template-columns:31% 69%}.cv>aside{background:#faf3e6;color:#6f5b34}.cv>main{padding-top:35px}\n';
 if(n===54)c+='.plain .work .entry{border-left:3px solid #39baca;padding-left:20px;position:relative}.plain .work .entry:before{content:●;color:#39baca;position:absolute;left:-7px;top:0}.plain .columns{grid-template-columns:60% 40%}\n';
 if(n===56)c+='.top>header{background:#412470;color:#fff}.top .columns{grid-template-columns:63% 37%}.top .columns>aside{grid-column:2;grid-row:1}.top .columns>main{grid-column:1;grid-row:1}.top .columns aside .skills{background:#4b3175;color:#fff;padding:18px;border-radius:14px}.top .columns aside .skills h2{color:#fff}\n';
 if(n===57)c+='.top>header{background:#f5fffc;color:#183d36}.top .columns{grid-template-columns:65% 35%}.top .columns>aside{grid-column:2;grid-row:1}.top .columns>main{grid-column:1;grid-row:1}.top .columns aside .skills{background:#153b33;color:#fff;padding:15px;border-radius:12px}.top .columns aside .skills h2{color:white}\n';
 if(n===58)c+='.cv{grid-template-columns:70% 30%}.cv>aside{border-left:8px solid #d7a520}.cv>main{padding-top:46px}\n';
 if(n===59)c+='.plain .columns{grid-template-columns:50% 50%;gap:55px}.plain .columns main{border-right:12px solid #0d4650;padding-right:28px}.plain .work .entry{margin-bottom:36px}\n';
 if(n===60)c+='.top{border-left:12px solid #45c5a5}.top>header{background:#fff;color:#194035}.top .columns{display:block}.top .columns>main{padding:25px 45px}.top .columns>aside{display:grid;grid-template-columns:1fr 1fr;gap:20px}.top .columns aside .about{display:none}\n';
 if(n===61)c+='.top>header{background:#fff;color:#364397}.top>header .avatar{background:#353ea0;border:14px solid #353ea0}.top .columns{display:block}.top .columns>aside{display:grid;grid-template-columns:repeat(2,1fr);gap:18px}.top .columns>main{padding:24px 45px}\n';
 if(n===63)c+='.top>header{background:#fff;color:#4b2f1c}.top>header .avatar{width:147px;height:147px;border-radius:13px;border:12px solid #583921}.top .columns{grid-template-columns:65% 35%}.top .columns>aside{grid-column:2;grid-row:1}.top .columns>main{grid-column:1;grid-row:1}.top .columns aside .skills{background:#583921;color:#fff;padding:18px;border-radius:12px}\n';
 if(n===64)c+='.top>header{background:#fff;color:#115d72}.top .columns{grid-template-columns:65% 35%}.top .columns>aside{grid-column:2;grid-row:1}.top .columns>main{grid-column:1;grid-row:1}.top .columns .about{background:#3cc9ec;color:#fff;padding:17px;border-radius:12px}\n';
 if(n===65)c+='.cv{grid-template-columns:68% 32%}.cv>aside{margin-top:0;background:#202733}.cv>aside .avatar{width:129px;height:129px}\n';
 if(n===66)c+='.top>header{background:#fff;color:#54416e}.top .columns{grid-template-columns:63% 37%}.top .columns>aside{grid-column:2;grid-row:1}.top .columns>main{grid-column:1;grid-row:1}.top .columns .about{background:#faf5fe;padding:15px}\n';
 if(n===67)c+='.cv{grid-template-columns:26% 74%}.cv>aside{background:#effdfa;color:#286652;padding-top:35px}.cv aside section h2{color:#3ba98e;border-color:#3ba98e}.cv main section{margin-bottom:64px}\n';
 if(n===68)c+='.top>header{background:#0e2546;color:white}.top .columns{grid-template-columns:31% 69%}.top .columns aside{background:#fffaf0;padding-right:17px}.top .columns main{padding-left:26px}\n';
 if(n===69)c+='.top>header{background:#0e4560;color:white}.top>header:after{content:CV;position:absolute;right:0;top:116px;background:#27bad4;color:#fff;padding:10px 35px}.top .columns{grid-template-columns:34% 66%}.top .columns>main{padding:30px 34px}\n';
 if(n===70)c+='.top>header{background:#174537;color:white}.top>header .avatar{order:2}.top .columns{grid-template-columns:65% 35%}.top .columns aside{grid-column:2;grid-row:1}.top .columns main{grid-column:1;grid-row:1}.top .columns main .about{background:#effcf6;padding:14px}\n';
 if(n===71)c+='.top>header{background:#f5f3fe;color:#34398e;border-radius:13px;margin:18px}.top .columns{grid-template-columns:65% 35%}.top .columns aside{grid-column:2;grid-row:1}.top .columns main{grid-column:1;grid-row:1}.top .columns aside .skills{padding:18px;background:#383d9c;border-radius:12px;color:white}.top .columns aside .skills h2{color:#fff}\n';
 if(n===72)c+='.cv{grid-template-columns:27% 73%}.cv>aside{background:#641c3c}.cv aside .photo{background:#ee7196;margin:-36px -33px 55px;padding:22px}.cv>main{padding-top:45px}.cv main .about{padding:14px;background:#fff5f8}\n';
 if(n===73)c+='.top>header{background:#fff;color:#3c3322}.top>header .avatar{order:2;width:125px;height:125px}.top .columns{grid-template-columns:66% 34%}.top .columns aside{grid-column:2;grid-row:1}.top .columns main{grid-column:1;grid-row:1}.top .columns main .about{background:#fef8eb;padding:16px}\n';
 if(n===74)c+='.top>header{background:#fff;color:#245c69}.top .columns{grid-template-columns:65% 35%}.top .columns aside{grid-column:2;grid-row:1}.top .columns main{grid-column:1;grid-row:1}.top .columns main .about{background:#edfbff;padding:22px;border-radius:15px}\n';
 if(n===75)c+='.top>header{background:#fbfef2;color:#50601a}.top .columns{grid-template-columns:64% 36%}.top .columns aside{grid-column:2;grid-row:1}.top .columns main{grid-column:1;grid-row:1}.top .columns aside .skills{background:#1c2938;color:white;padding:17px;border-radius:10px}.top .columns aside .skills h2{color:#fff}\n';
 if(n===76)c+='.top>header{background:#42266c;color:white}.top .columns{grid-template-columns:65% 35%}.top .columns aside{grid-column:2;grid-row:1}.top .columns main{grid-column:1;grid-row:1}.top .columns main .about{background:#f8f4fd;padding:16px;border-radius:12px}\n';
 if(n===77)c+='.cv.top{border:2px solid #383f3d;min-height:1125px}.top>header{background:#fff;color:#18483d;flex-direction:column;text-align:center}.top .columns{grid-template-columns:67% 33%}.top .columns aside{grid-column:2;grid-row:1}.top .columns main{grid-column:1;grid-row:1}.top .columns main .about{border-top:2px solid #46c8b0}\n';
 return c;
}
function sample(d){
 const [n,name,role]=d;
 return {profile:{fullName:name,jobTitle:role,location:'New York, United States',phone:'+1 (415) 555-0182',email:name.toLowerCase().replace(' ','.')+'@example.com',website:'linkedin.com/in/'+name.toLowerCase().replace(' ','-'),summary:'Experienced '+role.toLowerCase()+' with a proven record of delivering measurable outcomes, building strong teams and improving services.'},
 employmentHistory:[{role,employer:'Northstar Group',period:'2021–Present',summary:'Led major projects, improved delivery and coordinated with cross-functional teams.'},{role:'Senior Specialist',employer:'Blue Ridge Partners',period:'2017–2021',summary:'Delivered reliable results and implemented practical process improvements.'},{role:'Associate',employer:'Capitol Growth Advisors',period:'2014–2017',summary:'Supported team operations, analytics and client services.'}],
 education:[{degree:'Bachelor of Business Administration',institution:'University of California',period:'2015'},{degree:'Professional Certificate',institution:'Professional Training Academy',period:'2021'}],
 skills:[{name:'Strategic planning'},{name:'Data analysis'},{name:'Team leadership'},{name:'Stakeholder management'},{name:'Communication'},{name:'Process improvement'}],
 languages:[{name:'English — Native'},{name:'Spanish — Professional'},{name:'French — Conversational'}],
 achievements:[{text:'Improved operational quality and delivery efficiency.'},{text:'Delivered successful cross-functional initiatives.'},{text:'Generated measurable process improvements.'}]};
}
function populated(source,doc){
 const inject=(text,context)=>{
   text=text.replace(/{{#each ([\w.]+)}}([\s\S]*?){{\/each}}/g,(_m,key,body)=>{
      const v=context[key];return Array.isArray(v)?v.map(item=>inject(body,{...context,...item})).join(''):'';
   });
   return text.replace(/{{([\w.]+)}}/g,(_m,key)=>escapeHtml(key.split('.').reduce((v,p)=>v?.[p],context)||''));
 };
 return inject(source,doc);
}
async function make(d,browser){
 const [n,name,role,bg,accent,layout,contrast,crop]=d, id='M'+n;
 const dir=path.join(out,id);await fs.mkdir(path.join(dir,'assets'),{recursive:true});
 const url='https://esc.vn/images/pages/style-'+n+'-768w.webp';
 const resp=await fetch(url,{signal:AbortSignal.timeout(30000)});
 if(!resp.ok)throw Error(id+' original image HTTP '+resp.status);
 const original=Buffer.from(await resp.arrayBuffer());
 const meta=await sharp(original).metadata();
 if(meta.width<450||meta.height<650)throw Error(id+' original image dimensions invalid');
 const [left,top,width,height]=crop;
 const portrait=await sharp(original).extract({left,top,width,height}).resize(180,180,{fit:'cover'}).webp({quality:72}).toBuffer();
 await fs.writeFile(path.join(dir,'assets/sample-portrait.webp'),portrait);
 const tpl=html(n,layout),styles=css(d),doc=sample(d);
 const manifest={id,version:'1.0.0',name:'CV #'+n+' — '+({left:'Two Column',right:'Reverse Column',top:'Editorial Header',split:'Split Contrast'}[layout]),
 description:'Mẫu '+n+' dựng lại bằng HTML/CSS từ esc.vn/mau-cv, hỗ trợ sửa nội dung, ảnh và danh sách.',engine:'esc-cv-v1',schema:'esc-cv-v1',
 entry:'index.html',stylesheet:'style.css',preview:'preview.webp',sample:'sample-data.json',
 bindings:{profile:'object',employmentHistory:'array',education:'array',skills:'array',languages:'array',achievements:'array'}};
 await Promise.all([fs.writeFile(path.join(dir,'index.html'),tpl),fs.writeFile(path.join(dir,'style.css'),styles),
 fs.writeFile(path.join(dir,'sample-data.json'),JSON.stringify(doc,null,2)),fs.writeFile(path.join(dir,'template.json'),JSON.stringify(manifest,null,2))]);
 const demo=populated(tpl,{...doc,profile:{...doc.profile,avatarUrl:'data:image/webp;base64,'+portrait.toString('base64')}});
 if(demo.includes('{{'))throw Error(id+' demo unresolved');
 const page=await browser.newPage({viewport:{width:800,height:1150}});
 try{
  await page.setContent(demo.replace('</head>','<style>'+styles+'</style></head>'));
  const snap=await page.locator('.cv').screenshot();
  await fs.writeFile(path.join(dir,'preview.webp'),await sharp(snap).webp({quality:76}).toBuffer());
 }finally{await page.close()}
 const zip=path.join(out,id+'-esc-cv-v1.zip');
 execFileSync('zip',['-q','-X','-r',zip,'template.json','index.html','style.css','sample-data.json','preview.webp','assets'],{cwd:dir});
 const size=(await fs.stat(zip)).size;
 if(size>5242880)throw Error(id+' archive too large');
 console.log('[ZIP PASS]',id,size,url);
 return {id,zip};
}
const browser=await chromium.launch({headless:true});
const admin=await browser.newPage({viewport:{width:1400,height:1000}});
async function login(){
 await admin.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
 if(await admin.locator('#user_login').count()){
  await admin.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await admin.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  const body=await admin.locator('body').innerText();
  const match=body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/);
  if(match){
   const a=Number(match[1]),b=Number(match[3]);
   const v=match[2]==='+'?a+b:match[2]==='-'?a-b:a*b;
   const field=admin.locator('#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[name*="math" i]').first();
   if(!await field.count())throw Error('CAPTCHA field missing');
   await field.fill(String(v));
  }
  await admin.locator('#wp-submit').click();
  await admin.waitForLoadState('domcontentloaded');
 }
 if(admin.url().includes('wp-login.php')||await admin.locator('#login_error').count())throw Error('WordPress authentication failed');
}
async function listIds(){
 const r=await admin.request.get(origin+'/wp-json/esc-cv/v1/templates',{timeout:30000});
 if(!r.ok())throw Error('Live registry unreadable HTTP '+r.status());
 return new Set((await r.json()).templates.map(v=>v.id));
}
async function ensureAbsentInAdmin(id){
 for(let num=1;num<=8;num++){
  await admin.goto(origin+'/wp-admin/admin.php?page=esc-cv-manager&esc_cv_page='+num,{waitUntil:'domcontentloaded'});
  const found=(await admin.locator('.esc-cv-card h3').allTextContents()).some(t=>t.startsWith(id+' —'));
  if(found)throw Error('ID '+id+' already exists, including archived; never overwrite');
  const summary=await admin.locator('.esc-cv-paging-summary').allTextContents();
  if(summary.length===0||summary.some(x=>/\/ \d+ template/.test(x)&&num>1))break;
 }
}
async function upload(item){
 await ensureAbsentInAdmin(item.id);
 await admin.goto(origin+'/wp-admin/admin.php?page=esc-cv-manager',{waitUntil:'domcontentloaded'});
 if(!await admin.locator('.esc-cv-upload input[name="esc_cv_zip"]').count())throw Error('ESC CV upload form missing');
 await admin.locator('.esc-cv-upload input[name="esc_cv_zip"]').setInputFiles(item.zip);
 await Promise.all([admin.waitForNavigation({waitUntil:'domcontentloaded',timeout:60000}),admin.locator('.esc-cv-upload [type=submit]').click()]);
 if(!admin.url().includes('esc_cv_notice=success'))throw Error(item.id+' WP upload refused '+admin.url());
 const ids=await listIds();
 if(!ids.has(item.id))throw Error(item.id+' not active after upload');
 const r=await admin.request.get(origin+'/wp-json/esc-cv/v1/templates/'+item.id+'/builder');
 if(!r.ok())throw Error(item.id+' Builder HTTP '+r.status());
 const data=await r.json();
 if(!data.html.includes('{{#each employmentHistory}}')||!data.assets['assets/sample-portrait.webp'])throw Error(item.id+' builder contract mismatch');
 console.log('[UPLOADED + VERIFIED]',item.id);
}
try{
 const packages=[];
 for(const d of designs.filter(d=>d[0]>=Number(process.env.CV_MIN||27)&&d[0]<=Number(process.env.CV_MAX||77)))packages.push(await make(d,browser));
 if(process.env.BUILD_ONLY==='1'){console.log('BUILD_ONLY completed, no WordPress changes');}
 else{
  for(const k of ['WP_ADMIN_USERNAME','WP_ADMIN_PASSWORD'])if(!process.env[k])throw Error('Missing '+k);
  await login();
  let ids=await listIds();
  for(const item of packages){if(ids.has(item.id)){console.log('[SKIP exists]',item.id);continue}await upload(item);ids=await listIds()}
  const missing=packages.filter(p=>!ids.has(p.id));
  if(missing.length)throw Error('Not all templates active: '+missing.map(x=>x.id));
 }
}catch(e){
 console.error(e.stack||String(e));
 await admin.screenshot({path:path.join(out,'upload-error.png'),fullPage:true}).catch(()=>{});
 throw e;
}finally{await browser.close()}
