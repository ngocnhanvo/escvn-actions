/**
 * ESC CV v1 public specification revision, strictly scoped to the existing
 * WordPress post 55473 on admin.esc.vn. Also attaches a verified sample ZIP.
 * Idempotent; never creates a second post, changes TablePress, or edits Astro.
 */
import {chromium} from 'playwright';
import {writeFile,readFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';

const required=['WP_ADMIN_URL','WP_ADMIN_USERNAME','WP_ADMIN_PASSWORD'];
for(const key of required)if(!process.env[key])throw Error('Missing '+key);
const origin=new URL(process.env.WP_ADMIN_URL).origin;
if(new URL(origin).hostname!=='admin.esc.vn')throw Error('Wrong WordPress target');
const slug='huong-dan-chuan-hoa-mau-cv',postId=55473;
const title='Hướng dẫn chuẩn hóa mẫu CV chuẩn ESC CV v1 để chỉnh sửa trực tuyến';
const filename='ESC-CV-v1-mau-chinh-thuc.zip';
const encode=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pre=(value,lang='')=>'<pre class="wp-block-code"><code>'+encode(value)+'</code></pre>';
const section=(heading,body)=>'<h2>'+heading+'</h2>'+body;
const para=s=>'<p>'+s+'</p>';

const manifest={
  id:'ESCV1',version:'1.0.0',name:'ESC CV v1 - Hai cột công nghệ',
  engine:'esc-cv-v1',schema:'esc-cv-v1',
  entry:'index.html',stylesheet:'style.css',
  preview:'preview.png',sample:'sample-data.json'
};
const sample={
  profile:{
    fullName:'Nguyễn Minh Anh',
    jobTitle:'Frontend Developer',
    email:'minhanh@example.com',
    phone:'0900 123 456',
    location:'TP. Hồ Chí Minh',
    summary:'Lập trình viên web có kinh nghiệm xây dựng giao diện dễ dùng, chú trọng hiệu năng và khả năng truy cập.',
    avatarUrl:''
  },
  skills:[{name:'TypeScript · JavaScript'},{name:'React · Astro'},{name:'HTML · CSS'}],
  experiences:[
    {position:'Frontend Developer',company:'Công ty Công nghệ Mẫu',period:'2023 – nay',
      description:'Phát triển giao diện sản phẩm, tối ưu trải nghiệm và phối hợp thiết kế hệ thống.'},
    {position:'Web Developer',company:'Studio Mẫu',period:'2021 – 2023',
      description:'Xây dựng website responsive và cải thiện tốc độ tải trang.'}
  ],
  education:[{school:'Đại học Công nghệ',degree:'Kỹ sư Công nghệ thông tin'}]
};
const htmlFile=[
  '<div class="cv">',
  '  <aside class="sidebar">',
  '    <img class="avatar" src="{{profile.avatarUrl}}" alt="Ảnh đại diện">',
  '    <h2>Liên hệ</h2>',
  '    <p>{{profile.email}}</p>',
  '    <p>{{profile.phone}}</p>',
  '    <p>{{profile.location}}</p>',
  '    <h2>Kỹ năng</h2>',
  '    {{#each skills}}',
  '      <p class="skill">{{name}}</p>',
  '    {{/each}}',
  '  </aside>',
  '  <main class="detail">',
  '    <h1>{{profile.fullName}}</h1>',
  '    <p class="role">{{profile.jobTitle}}</p>',
  '    <h2>Giới thiệu</h2>',
  '    <p>{{profile.summary}}</p>',
  '    <h2>Kinh nghiệm làm việc</h2>',
  '    {{#each experiences}}',
  '      <section class="item">',
  '        <h3>{{position}}</h3>',
  '        <p>{{company}} · {{period}}</p>',
  '        <p>{{description}}</p>',
  '      </section>',
  '    {{/each}}',
  '    <h2>Học vấn</h2>',
  '    {{#each education}}',
  '      <section class="item"><h3>{{school}}</h3><p>{{degree}}</p></section>',
  '    {{/each}}',
  '  </main>',
  '</div>'
].join('\n');
const cssFile=[
  '*{box-sizing:border-box}',
  'body{margin:0;background:#fff;color:#192b43;font:15px/1.65 Arial,sans-serif}',
  '.cv{display:grid;grid-template-columns:32% 68%;max-width:900px;min-height:1110px;margin:auto}',
  '.sidebar{padding:40px 26px;background:#10223d;color:#fff}',
  '.avatar{display:block;width:124px;height:124px;object-fit:cover;border-radius:50%;margin:0 auto 30px}',
  '.sidebar h2{font-size:17px;color:#85c1ff;margin-top:30px;padding-bottom:8px;border-bottom:1px solid #446288}',
  '.sidebar p{overflow-wrap:anywhere}',
  '.skill{margin:7px 0}',
  '.detail{padding:43px 40px}',
  'h1{font-size:34px;line-height:1.25;margin:0;color:#10223d}',
  '.role{font-size:18px;color:#1683ea;font-weight:700;margin:10px 0 35px}',
  '.detail h2{font-size:18px;text-transform:uppercase;margin-top:35px;border-bottom:2px solid #b9d7fa;padding-bottom:7px}',
  'h3{font-size:16px;margin:15px 0 0}',
  'p{margin:9px 0}',
  '.item{break-inside:avoid;margin-bottom:22px}',
  '@media(max-width:620px){.cv{grid-template-columns:1fr}.sidebar,.detail{padding:27px}}'
].join('\n');
const sampleJson=JSON.stringify(sample,null,2),manifestJson=JSON.stringify(manifest,null,2);
function crc32(bytes){let crc=0xffffffff;for(const b of bytes){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function zipStored(files){
  const locals=[],centrals=[];let offset=0;
  for(const [name,content] of files){
    const filename=Buffer.from(name),data=Buffer.from(content),crc=crc32(data);
    const local=Buffer.alloc(30),central=Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
    local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);
    local.writeUInt16LE(filename.length,26);
    central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);
    central.writeUInt32LE(crc,16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);
    central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
    locals.push(local,filename,data);centrals.push(central,filename);
    offset+=local.length+filename.length+data.length;
  }
  const dir=Buffer.concat(centrals),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);
  end.writeUInt16LE(files.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...locals,dir,end]);
}
function previewMarkup(avatarData){
  return htmlFile
    .replace(/{{#each\s+([a-zA-Z]+)}}([\s\S]*?){{\/each}}/g,(_,key,child)=>{
      const list=sample[key]||[];
      return list.map(item=>child.replace(/{{([a-zA-Z]+)}}/g,(_,field)=>encode(item[field]||''))).join('');
    })
    .replace(/{{profile\.([a-zA-Z]+)}}/g,(_,field)=>field==='avatarUrl'?avatarData:encode(sample.profile[field]||''));
}
async function createSample(page){
  const avatarData=await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=200;c.height=200;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#8dc4f7';ctx.fillRect(0,0,200,200);
    ctx.fillStyle='#1b4f88';ctx.beginPath();ctx.arc(100,77,39,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.ellipse(100,188,82,73,0,Math.PI,Math.PI*2);ctx.fill();
    return c.toDataURL('image/png');
  });
  const avatar=Buffer.from(avatarData.split(',')[1],'base64');
  await page.setViewportSize({width:900,height:1200});
  await page.setContent('<!doctype html><html><head><style>'+cssFile+'</style></head><body>'+
    previewMarkup(avatarData)+'</body></html>',{waitUntil:'load'});
  const preview=await page.screenshot({type:'png',fullPage:true});
  if(preview.length>=1024*1024)throw Error('Preview screenshot too large');
  const files=[
    ['template.json',Buffer.from(manifestJson)],
    ['index.html',Buffer.from(htmlFile)],
    ['style.css',Buffer.from(cssFile)],
    ['sample-data.json',Buffer.from(sampleJson)],
    ['preview.png',preview],
    ['assets/avatar-placeholder.png',avatar]
  ];
  const zip=zipStored(files);
  if(zip.length>5*1024*1024)throw Error('Sample exceeds 5 MB ZIP cap');
  await writeFile('/tmp/'+filename,zip);
  console.log('[CV GUIDE SAMPLE] ZIP BUILT',zip.length,'bytes, 6 valid ESC v1 files');
  return zip;
}
function article(downloadUrl){
  const zipTree=['template.json','index.html','style.css','sample-data.json','preview.png','assets/avatar-placeholder.png'];
  const checklist=[
    'ZIP có cấu trúc và tệp hợp lệ; không mã thực thi, không thư mục ../, không file ẩn.',
    'Manifest khai báo đúng engine/schema esc-cv-v1, các đường dẫn khớp file trong ZIP.',
    'index.html có {{profile.fullName}} và các {{#each ...}} đóng bằng {{/each}} đúng thứ tự.',
    'Không có meta, link, script, iframe, onload/onclick hoặc liên kết JavaScript trong HTML.',
    'CSS chỉ dùng kiểu an toàn, không @import, không tải ảnh/font từ web ngoài.',
    'sample-data.json có đối tượng profile và các nhóm danh sách dạng mảng object.',
    'Ảnh preview thật (PNG/JPG/WebP) dưới 1 MB; ảnh đại diện dùng tên dự phòng đúng quy ước.',
    'Upload lên ESC hiển thị “Có thể chỉnh sửa trực tuyến”, sau đó kiểm tra chỉnh chữ/ảnh và thêm/xóa mục.'
  ];
  const sections=[
    para('<strong>Tài liệu chuẩn ESC CV v1</strong> — phiên bản hướng dẫn ngày 16/10/2026. Bài này dành cho người thiết kế CV, lập trình viên và các trợ lý AI (ChatGPT, Gemini, Grok, Claude...). Mục tiêu là tạo file ZIP được <strong>ESC CV Studio nhận là mẫu có thể chỉnh sửa trực tuyến</strong>, không chỉ là HTML nhìn giống CV.'),
    '<p><strong>Đường dẫn sử dụng:</strong> <a href="/tao-cv-truc-tuyen/#cvstudio-templates">Tạo CV trực tuyến</a>. <strong>Lưu ý:</strong> hệ thống sẽ tự kiểm tra ZIP; chỉ ZIP thỏa chuẩn mới mở Builder. File không đạt chuẩn có thể chỉ được xem trước và các biến <code>{{...}}</code> sẽ còn nguyên.</p>',
    section('1. Tải mẫu ZIP chính thức để bắt đầu',
      para('Đây là mẫu nhỏ đã xây dựng theo contract của ESC CV v1: 2 cột, màu xanh công nghệ, có họ tên, ảnh, liên hệ, kỹ năng, kinh nghiệm và học vấn. Bạn có thể dùng trực tiếp, đổi giao diện hoặc giao cho AI phát triển tiếp từ chính các file này.')+
      '<p><a href="'+encode(downloadUrl)+'" target="_blank" rel="noopener noreferrer"><strong>⬇ Tải mẫu ZIP ESC CV v1 chính thức (đầy đủ HTML/CSS/JSON/ảnh)</strong></a></p>'+
      para('Nên giải nén, chỉnh sửa, nén lại đúng cấu trúc, sau đó tự upload vào ESC CV Studio. Không dùng ảnh chụp mẫu CV làm thay cho mã HTML/CSS.')
    ),
    section('2. Những định dạng nào được chấp nhận?',
      '<ul><li><strong>ZIP ESC CV v1:</strong> tối đa 5 MB, kiểm tra manifest, HTML/CSS, preview và cú pháp biến; nếu hợp lệ thì chỉnh sửa trực tuyến.</li>'+
      '<li><strong>ZIP HTML không chuẩn:</strong> có thể xem trước nhưng không bật chế độ sửa trực tiếp; biến {{...}} sẽ không được thay bằng dữ liệu.</li>'+
      '<li><strong>HTML rời (.html/.htm):</strong> tối đa 2 MB, chỉ xem trước.</li>'+
      '<li><strong>PDF hoặc ảnh PNG/JPG/WebP:</strong> chỉ xem trước, không sửa nội dung theo từng trường.</li>'+
      '<li><strong>DOCX:</strong> chưa được hỗ trợ. Chức năng công khai CV lên hosting và Member hiện chưa triển khai.</li></ul>'
    ),
    section('3. Cấu trúc ZIP chính xác',
      para('ZIP cho phép đặt các tệp ở gốc hoặc trong <strong>một thư mục bao ngoài duy nhất</strong>. Tối thiểu phải có <code>template.json</code>, HTML, CSS và ảnh preview. Để CV có dữ liệu demo, nên thêm <code>sample-data.json</code> và ảnh dự phòng.')+
      pre(zipTree.join('\n'),'text')+
      para('Tên file trong manifest phải trùng chính xác (phân biệt chữ hoa/thường). Không thêm các file tạm như .DS_Store, .git, file thực thi, hoặc đường dẫn lùi thư mục.')
    ),
    section('4. File template.json — manifest bắt buộc',
      pre(manifestJson,'json')+
      para('<code>id</code> phải là 2–32 ký tự, bắt đầu bằng chữ in hoa và chỉ gồm A–Z, 0–9, dấu _ hoặc -. <code>version</code> dạng ba số nguyên như 1.0.0. <code>name</code> tối đa 140 ký tự. Hai khóa <code>engine</code> và <code>schema</code> <strong>phải bằng esc-cv-v1</strong>. <code>entry</code>, <code>stylesheet</code> và <code>preview</code> trỏ đúng tệp thật trong ZIP; đường dẫn tương đối, không dùng URL ngoài.')+
      para('Tệp <code>sample</code> là tùy chọn nhưng rất nên có để khi chọn mẫu, Builder hiển thị dữ liệu demo. Manifest hợp lệ chưa đủ; hệ thống còn kiểm tra cú pháp HTML, CSS, ảnh và các nhóm dữ liệu.')
    ),
    section('5. File index.html — mẫu hoàn chỉnh có thể chỉnh sửa',
      para('<strong>Rất quan trọng:</strong> hãy đưa phần thân HTML như ví dụ bên dưới vào <code>index.html</code>. <strong>Không chèn</strong> các thẻ <code>&lt;meta&gt;</code>, <code>&lt;link&gt;</code> để gọi CSS. ESC tự đưa CSS từ file đã khai báo vào tài liệu khi render.')+
      pre(htmlFile,'html')+
      para('Bắt buộc có chính xác biến <code>{{profile.fullName}}</code>. Các trường khác bắt đầu bằng <code>profile.</code> để ESC nhận diện phần hồ sơ. Các nhóm nhiều item dùng cú pháp <code>{{#each skills}}</code> ... <code>{{/each}}</code>, <code>{{#each experiences}}</code> ... <code>{{/each}}</code> và mỗi item dùng thuộc tính cục bộ như <code>{{name}}</code>, <code>{{position}}</code>.')+
      para('Mỗi nhóm lặp phải mở/đóng đúng cặp, không lồng quá sâu; trường trong nhóm phải trùng với keys ở sample-data.json. Dùng HTML có cấu trúc rõ ràng, nhóm lặp bao ngoài toàn bộ item để thao tác Thêm/Xóa/Đổi thứ tự.')
    ),
    section('6. File style.css — định dạng riêng, không nhúng link ngoài',
      pre(cssFile,'css')+
      para('Bạn có thể sáng tạo bố cục theo CV của mình, đặt màu sắc, khung, typography, cột, breakpoints ngay trong <code>style.css</code>. Hệ thống không cho CSS dùng <code>@import</code>, <code>expression(...)</code> hoặc <code>url(http...)</code>, <code>url(data:...)</code>. Không phụ thuộc JavaScript, Tailwind CDN, Google Fonts online hay tài nguyên mạng bên ngoài.')
    ),
    section('7. File sample-data.json — dữ liệu phải khớp 100% với HTML',
      pre(sampleJson,'json')+
      para('Đối tượng <code>profile</code> chứa thông tin đơn; <code>skills</code>, <code>experiences</code>, <code>education</code> là <strong>mảng đối tượng</strong> (không phải một chuỗi văn bản). Ví dụ <code>skills: [{"name":"React"}]</code>, tương ứng với <code>{{#each skills}}{{name}}{{/each}}</code>. Dữ liệu mẫu giúp mở Builder thấy thông tin ngay; thiếu nó, nhiều trường sẽ để trống.')
    ),
    section('8. Quy tắc ảnh đại diện và ảnh preview',
      '<ul><li><strong>Ảnh người dùng trong HTML:</strong> dùng đúng <code>&lt;img src="{{profile.avatarUrl}}" alt="Ảnh đại diện"&gt;</code>. Không dùng trực tiếp <code>src="assets/portrait.webp"</code> nếu muốn người dùng đổi ảnh trực tiếp.</li>'+
      '<li><strong>Ảnh demo dự phòng:</strong> đặt <code>assets/avatar-placeholder.png</code> hoặc <code>assets/sample-portrait.webp</code> trong ZIP. Để <code>profile.avatarUrl</code> rỗng (<code>""</code>) khi dùng ảnh này. Khi người dùng thay ảnh, ESC sẽ dùng dữ liệu mới.</li>'+
      '<li><strong>Ảnh preview:</strong> khai báo <code>preview.png</code>, <code>preview.jpg</code> hoặc <code>preview.webp</code> trong manifest; nội dung ảnh phải giải mã được, kích thước tối đa 5.000 × 5.000 pixel, dung lượng tối đa 1 MB.</li>'+
      '<li><strong>Asset tĩnh khác:</strong> để trong <code>assets/</code> và dùng đường dẫn tương đối; không tải ảnh từ domain ngoài.</li></ul>'
    ),
    section('9. Danh sách HTML/CSS bị từ chối vì an toàn',
      '<table><thead><tr><th>Không dùng trong mẫu editable</th><th>Cách làm đúng</th></tr></thead><tbody>'+
      '<tr><td><code>&lt;script&gt;</code>, JavaScript, <code>onclick</code>, <code>onload</code></td><td>Chỉ HTML + CSS tĩnh và biến ESC</td></tr>'+
      '<tr><td><code>&lt;meta&gt;</code>, <code>&lt;link&gt;</code>, <code>&lt;base&gt;</code></td><td>ESC tự tạo head; stylesheet được khai báo bằng manifest</td></tr>'+
      '<tr><td><code>&lt;iframe&gt;</code>, <code>&lt;object&gt;</code>, <code>&lt;embed&gt;</code>, <code>&lt;form&gt;</code></td><td>Thay bằng phần tử hiển thị thuần túy</td></tr>'+
      '<tr><td><code>javascript:</code>, thẻ PHP hoặc tài nguyên CSS từ internet</td><td>Đặt tài nguyên hợp lệ trong ZIP, không thực thi mã</td></tr>'+
      '<tr><td>Đường dẫn <code>../</code>, file ẩn hoặc file vượt giới hạn</td><td>Chỉ đường dẫn tương đối an toàn trong đúng thư mục ZIP</td></tr></tbody></table>'+
      para('Giới hạn: ZIP 100 byte – 5 MB, tối đa 100 tệp, tổng dung lượng giải nén tối đa 20 MB. HTML/CSS/JSON dùng UTF-8. Tệp ZIP dùng nén Store hoặc Deflate phổ biến, không mật khẩu; ảnh phải là PNG/JPG/WebP hợp lệ. Nội dung có thể bị từ chối vì lý do khác nếu không qua các bước kiểm tra cấu trúc hoặc giải mã.')
    ),
    section('10. Danh sách tự kiểm tra trước khi tải lên',
      '<ol>'+checklist.map(c=>'<li>'+c+'</li>').join('')+'</ol>'+
      para('Thử tại <a href="/tao-cv-truc-tuyen/#cvstudio-templates">ESC CV Studio</a>, bấm <strong>Tải lên mẫu CV của bạn</strong>. Nếu đạt, hệ thống hiển thị chế độ chỉnh sửa trực tiếp; nếu chỉ xem trước hoặc còn chuỗi {{...}}, hãy kiểm tra manifest, các thẻ bị cấm, dữ liệu demo và đường dẫn ảnh.')
    ),
    section('11. Prompt giao việc cho ChatGPT, Gemini, Grok hoặc Claude',
      para('Bạn có thể sao chép nội dung sau, đính kèm ZIP mẫu ở mục 1 và yêu cầu AI tạo một CV khác. Chỉ ảnh chụp thiết kế là chưa đủ để AI tự suy ra chuẩn ESC:')+
      pre([
        'Hãy tạo một mẫu CV đẹp theo tiêu chuẩn ESC CV v1.',
        'Tôi sẽ tải lên và CHỈ chấp nhận kết quả nếu chỉnh sửa trực tuyến trong ESC CV Studio.',
        'Dùng ZIP tham chiếu ESC CV v1 tôi đính kèm làm baseline; tạo thiết kế riêng, không phá contract.',
        'Kết quả: một ZIP <= 5 MB gồm template.json, index.html, style.css, sample-data.json,',
        'preview.png hoặc preview.webp thật, cùng ảnh đại diện dự phòng trong assets/.',
        'Manifest: engine và schema đều esc-cv-v1; id, version, path hợp lệ.',
        'index.html chứa {{profile.fullName}}, các trường profile.xxx, và các nhóm',
        '{{#each skills}}, {{#each experiences}}, {{#each education}} đóng bằng {{/each}}.',
        'KHÔNG dùng script, meta, link, iframe, sự kiện onclick, CSS @import, tài nguyên online.',
        'Ảnh đại diện: <img src="{{profile.avatarUrl}}"> và file assets/avatar-placeholder.png.',
        'sample-data.json điền đủ dữ liệu thực tế cho từng trường để preview không trống.',
        'Tự kiểm ZIP từng file và đối chiếu checklist bài hướng dẫn trước khi trả kết quả.',
        'Nếu chưa chạy thử trực tiếp trên ESC CV Studio, phải nói rõ CHƯA XÁC NHẬN upload.',
        'Trả duy nhất ZIP hoàn thiện và nêu mọi giới hạn chưa kiểm chứng.'
      ].join('\n'),'text')
    ),
    section('12. Lỗi thường gặp khi kiểm thử',
      '<table><thead><tr><th>Hiện tượng</th><th>Nguyên nhân hay gặp và cách xử lý</th></tr></thead><tbody>'+
      '<tr><td>CV hiện nguyên <code>{{profile.fullName}}</code>, <code>{{#each}}</code></td><td>Đang ở chế độ chỉ xem HTML; ZIP chưa đạt chuẩn editable. Kiểm tra thẻ cấm, manifest, ảnh và cú pháp groups.</td></tr>'+
      '<tr><td>Không thấy ảnh đại diện</td><td>Đừng gán <code>avatarUrl</code> bằng đường dẫn ảnh; đổi thành chuỗi rỗng, thêm đúng asset dự phòng.</td></tr>'+
      '<tr><td>Upload báo manifest không hợp lệ</td><td>Soát các khóa engine, schema, id, version, entry, stylesheet và preview; tên file phải trùng.</td></tr>'+
      '<tr><td>Builder trống hoặc nhóm không có dữ liệu</td><td>Thêm sample-data.json, tạo mảng object có key trùng biến trong mỗi nhóm.</td></tr>'+
      '<tr><td>ZIP chỉ xem dù nhìn đẹp</td><td>HTML/CSS có thể chứa script/meta/link, CSS import hoặc preview bị lỗi; hãy đối chiếu lại mục 9.</td></tr></tbody></table>'
    ),
    para('<strong>Phạm vi:</strong> Tài liệu mô tả các quy tắc đang áp dụng cho ESC CV Studio tại thời điểm xuất bản, không bảo đảm mọi ZIP có thiết kế đẹp đều đạt chuẩn. Việc xác nhận cuối cùng cần tải trực tiếp ZIP lên Builder; bản mẫu tham chiếu giúp rút ngắn quá trình tạo và kiểm tra.')
  ];
  return sections.join('\n');
}
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1350,height:950}});
const assert=(x,m)=>{if(!x)throw Error(m);};
function challengeResult(body){
  const m=body.match(/(\d+)\s*([+\-x×*])\s*(\d+)\s*(?:=|\?)/);
  if(!m)return null;const a=Number(m[1]),b=Number(m[3]);
  return m[2]==='+'?a+b:m[2]==='-'?a-b:a*b;
}
async function login(){
  await page.goto(origin+'/wp-admin/',{waitUntil:'domcontentloaded',timeout:60000});
  if(await page.locator('#user_login').count()){
    await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
    await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
    const n=challengeResult(await page.locator('body').innerText());
    if(n!==null){
      const f=page.locator('#loginform input[name*="captcha" i],#loginform input[id*="captcha" i],#loginform input[name*="math" i]').first();
      assert(await f.count(),'Unexpected captcha');await f.fill(String(n));
    }
    await page.locator('#wp-submit').click();await page.waitForLoadState('domcontentloaded');
  }
  assert(!page.url().includes('wp-login.php')&&!(await page.locator('#login_error').count()),'WordPress authentication denied');
}
async function nonce(){
  const response=await page.request.get(origin+'/wp-admin/admin-ajax.php?action=rest-nonce',{timeout:25000});
  assert(response.ok(),'REST nonce failed');
  const n=(await response.text()).trim();
  assert(/^[A-Za-z0-9]{8,32}$/.test(n),'Malformed REST nonce');
  return n;
}
async function mediaUpload(zip,token){
  const headers={'X-WP-Nonce':token};
  const existing=await page.request.get(origin+'/wp-json/wp/v2/media?search='+encodeURIComponent('ESC-CV-v1-mau-chinh-thuc')+'&per_page=25',{headers,timeout:30000});
  assert(existing.ok(),'Media lookup failed: '+existing.status());
  const records=await existing.json();
  const found=records.filter(r=>r.slug==='esc-cv-v1-mau-chinh-thuc');
  if(found.length){
    assert(found.length===1 && found[0].source_url && found[0].mime_type==='application/zip','Existing sample conflict');
    console.log('[CV GUIDE SAMPLE] REUSED EXISTING MEDIA',found[0].id,found[0].source_url);
    return found[0].source_url;
  }
  const upload=await page.request.post(origin+'/wp-json/wp/v2/media',{
    headers:{...headers,'Content-Type':'application/zip',
      'Content-Disposition':'attachment; filename="'+filename+'"'},
    data:zip,timeout:60000
  });
  assert(upload.ok(),'Sample ZIP media upload failed '+upload.status()+': '+(await upload.text()).slice(0,550));
  const result=await upload.json();
  assert(result.id && result.source_url && result.mime_type==='application/zip','Invalid uploaded sample media');
  console.log('[CV GUIDE SAMPLE] MEDIA CREATED',result.id,result.source_url);
  return result.source_url;
}
async function updateArticle(html,token){
  const url=origin+'/wp-json/wp/v2/posts/'+postId;
  const headers={'X-WP-Nonce':token};
  const result=await page.request.get(url+'?context=edit',{headers,timeout:30000});
  assert(result.ok(),'Existing guide post missing');
  const post=await result.json();
  assert(post.id===postId && post.slug===slug && post.status==='publish','Guide identity/status mismatch, refusing overwrite');
  assert(post.title?.raw?.includes('Hướng dẫn chuẩn hóa mẫu CV'),'Unexpected article title');
  const previous=post.content?.raw||'';
  await writeFile('/tmp/cv-guide-before-update.html',previous);
  console.log('[CV GUIDE] Previous article backed up in run artifact');
  const response=await page.request.post(url,{
    headers:{...headers,'Content-Type':'application/json'},
    data:{
      title,slug,status:'publish',content:html,
      excerpt:'Đặc tả chính thức ESC CV v1: tải mẫu ZIP tham chiếu, cú pháp HTML/CSS/JSON, schema dữ liệu, ảnh, bảo mật, checklist và prompt để AI tạo CV chỉnh sửa trực tuyến.'
    },timeout:50000
  });
  assert(response.ok(),'WP post update rejected '+response.status()+': '+(await response.text()).slice(0,550));
  const updated=await response.json();
  assert(updated.id===postId && updated.slug===slug && updated.status==='publish','Failed guide update contract');
  const check=await page.request.get(url+'?context=edit',{headers,timeout:30000});
  assert(check.ok(),'Cannot verify saved post');
  const saved=await check.json();
  const raw=saved.content?.raw||'';
  for(const term of ['Tải mẫu ZIP chính thức','esc-cv-v1','assets/avatar-placeholder.png',
    'Không chèn','Prompt giao việc','sample-data.json','{{profile.fullName}}']){
      assert(raw.includes(term),'Guide revision did not persist: '+term);
  }
  assert((raw.match(/<h2>/g)||[]).length>=12,'Missing sections in new guide');
  assert(raw.includes('&lt;img') || raw.includes('&lt;div'),'Escaped HTML example absent');
  console.log('[CV GUIDE] EXISTING POST UPDATED + VERIFIED',postId,'chars='+raw.length,'sample URL included');
}
try{
  const zip=await createSample(page);
  await login();
  const token=await nonce();
  const downloadUrl=await mediaUpload(zip,token);
  await updateArticle(article(downloadUrl),token);
  console.log('[CV GUIDE V2] SUCCESS',origin+'/wp-admin/post.php?post='+postId+'&action=edit');
}catch(error){
  console.error(error);
  await page.screenshot({path:'cvstudio-guide-v2-error.png',fullPage:true}).catch(()=>{});
  throw error;
}finally{await browser.close();}
