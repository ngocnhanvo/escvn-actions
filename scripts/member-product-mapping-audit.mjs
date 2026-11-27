/**
 * Read-only audit of Member product_id vs. ESC WordPress ACF `tld`.
 * No WordPress mutation, no WooCommerce ID matching.
 */
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.WP_URL || 'https://admin.esc.vn';
const OUTPUT = process.env.OUTPUT_DIR || 'member-product-mapping-audit';
const SOURCE = 'scripts/data/member-products.json';
const csv = JSON.parse(fs.readFileSync(SOURCE, 'utf8')).map((item, idx) => {
  if (!/^\d+$/.test(String(item.product_id))) throw new Error(`Invalid Member ID in row ${idx + 2}`);
  return { member_id: String(item.product_id), name: String(item.product_name).trim(), source_woo: String(item.woo_id ?? '').trim() };
});
const normal = (x) => String(x ?? '').normalize('NFKC').trim().toLocaleLowerCase('en-US');
const html = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/&amp;/gi, '&').replace(/&#039;|&apos;/gi, "'").replace(/&quot;/gi, '"');
const esc = (s) => `"${String(s ?? '').replaceAll('"', '""')}"`;

async function fetchJson(url, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'ESC-Member-Catalog-Audit/1.0' }, signal: AbortSignal.timeout(20000) });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < 3) { await new Promise(r => setTimeout(r, attempt * 2500)); continue; }
      }
      if (!response.ok) throw new Error(`${label} HTTP ${response.status}`);
      return { body: await response.json(), pages: Math.max(1, Number(response.headers.get('x-wp-totalpages') || 1)) };
    } catch (err) {
      if (attempt === 3) throw err;
      await new Promise(r => setTimeout(r, attempt * 2500));
    }
  }
  throw new Error(`${label}: retries exhausted`);
}

async function fetchProducts() {
  const all = [];
  const perPage = 50;
  let page = 1, pages = 1;
  do {
    const url = `${BASE}/wp-json/wp/v2/product?status=publish&per_page=${perPage}&page=${page}&_fields=id,title,slug,acf,prices,product_categories`;
    const response = await fetchJson(url, `WP products page ${page}`);
    if (!Array.isArray(response.body)) throw new Error('Product REST API did not return an array');
    all.push(...response.body);
    pages = response.pages;
    console.log(`Retrieved WordPress product page ${page}/${pages}, items ${response.body.length}`);
    page++;
    if (page <= pages) await new Promise(r => setTimeout(r, 300));
  } while (page <= pages && page <= 200);
  if (page <= pages) throw new Error('Exceeded 200 WordPress pages; refusing partial catalog');
  return all;
}

const products = await fetchProducts();
if (!products.length) throw new Error('WordPress returned zero products: aborting audit');
const index = new Map();
for (const product of products) {
  const key = normal(product.acf?.tld);
  if (!key) continue;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(product);
}
const seenMemberName = new Map();
for (const item of csv) seenMemberName.set(normal(item.name), (seenMemberName.get(normal(item.name)) || 0) + 1);
const audit = csv.map(item => {
  const key = normal(item.name);
  const candidates = index.get(key) || [];
  const originIds = [...new Set(candidates.map(p => String(p.acf?.origin_product_id || p.id)))];
  const exact = candidates.length > 0 && originIds.length === 1 && seenMemberName.get(key) === 1;
  return {
    ...item, key, status: exact ? 'EXACT_KEY' : candidates.length ? 'AMBIGUOUS' : 'UNMATCHED',
    wp_ids: candidates.map(p => p.id).join('|'),
    wp_titles: candidates.map(p => html(p.title?.rendered)).join('|'),
    origin_ids: originIds.join('|'),
    wp_languages: candidates.map(p => String(p.acf?.product_lang?.value || '')).join('|'),
    variation_ids: candidates.flatMap(p => p.prices?.variations?.map(v => v.variation_id) || []).filter(Boolean).join('|'),
    wp_tld: candidates.map(p => String(p.acf?.tld || '')).join('|')
  };
});
fs.mkdirSync(OUTPUT, { recursive: true });
const fields = ['member_id','name','key','status','wp_ids','wp_titles','origin_ids','wp_languages','variation_ids','wp_tld','source_woo'];
fs.writeFileSync(path.join(OUTPUT, 'mapping-audit.csv'), [fields.map(esc).join(','), ...audit.map(row => fields.map(k => esc(row[k])).join(','))].join('\n') + '\n');
fs.writeFileSync(path.join(OUTPUT, 'catalog-snapshot.json'), JSON.stringify(products.map(p => ({id:p.id,name:html(p.title?.rendered),tld:p.acf?.tld,origin_product_id:p.acf?.origin_product_id,product_lang:p.acf?.product_lang,variations:p.prices?.variations?.map(v => ({variation_id:v.variation_id,name:v.name})) || []})),null,2));
const counts = Object.fromEntries(['EXACT_KEY','AMBIGUOUS','UNMATCHED'].map(k => [k,audit.filter(x=>x.status===k).length]));
console.log(JSON.stringify({total_member:csv.length,total_wp:products.length,with_tld:products.filter(p=>normal(p.acf?.tld)).length,...counts,examples:audit.filter(x=>x.status==='EXACT_KEY').slice(0,12).map(x=>({name:x.name,member_id:x.member_id,wp_ids:x.wp_ids}))},null,2));
console.log('READ ONLY: WordPress was not modified.');


// Member Product ID presence audit (read only; ACF field, not WooCommerce ID).
// Public links follow the Astro product route: /san-pham/<slug> for vi.
const memberNameIndex = new Map();
for (const item of csv) {
  const key = normal(item.name);
  if (!memberNameIndex.has(key)) memberNameIndex.set(key, []);
  memberNameIndex.get(key).push(item.member_id);
}
const memberIdRows = products.map(p => {
  const current = String(p.acf?.member_product_id ?? '').trim();
  const field_status = !current ? 'MISSING' : (/^[1-9]\d*$/.test(current) ? 'SET' : 'INVALID');
  const language = String(p.acf?.product_lang?.value || 'vi').trim().toLowerCase();
  const originalSlug = String(p.slug ?? '').trim();
  const suffix = '-' + language;
  const slug = originalSlug.endsWith(suffix) ? originalSlug.slice(0, -suffix.length) : originalSlug;
  const prefix = language === 'en' ? 'products' : 'san-pham';
  const url = slug ? 'https://esc.vn/' + prefix + '/' + encodeURIComponent(slug) : '';
  const tld = String(p.acf?.tld ?? '').trim();
  const catalog = tld ? (memberNameIndex.get(normal(tld)) || []) : [];
  return {
    wp_id: p.id,
    origin_id: String(p.acf?.origin_product_id || p.id),
    language,
    service: html(p.title?.rendered),
    url,
    member_product_id: current,
    field_status,
    member_tld: tld,
    expected_member_id: catalog.length === 1 ? catalog[0] : '',
    match_status: catalog.length === 1 ? 'EXACT_TLD' : catalog.length > 1 ? 'AMBIGUOUS_TLD' : 'NO_EXACT_TLD'
  };
});
const fieldNotSet = memberIdRows.filter(r => r.field_status !== 'SET');
const fieldMissing = fieldNotSet.filter(r => r.field_status === 'MISSING');
const memberMappedMissing = fieldNotSet.filter(r => r.match_status === 'EXACT_TLD');
const fieldsMissing = ['wp_id','origin_id','language','service','url','member_product_id','field_status','member_tld','expected_member_id','match_status'];
const asCsv = rows => [fieldsMissing.map(esc).join(','), ...rows.map(row => fieldsMissing.map(k => esc(row[k])).join(','))].join('\n') + '\n';
fs.writeFileSync(path.join(OUTPUT, 'products-missing-member-product-id.csv'), asCsv(fieldNotSet));
fs.writeFileSync(path.join(OUTPUT, 'member-matched-products-missing-id.csv'), asCsv(memberMappedMissing));
fs.writeFileSync(path.join(OUTPUT, 'member-product-id-coverage.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  wp_host: BASE,
  total_published_wp_records: memberIdRows.length,
  set_member_id: memberIdRows.length - fieldNotSet.length,
  missing_member_id: fieldMissing.length,
  invalid_member_id: fieldNotSet.length - fieldMissing.length,
  missing_with_unique_member_reference: memberMappedMissing.length,
  missing_without_unique_member_reference: fieldNotSet.length - memberMappedMissing.length,
  unique_missing_origins: new Set(fieldNotSet.map(r => r.origin_id)).size,
  records: fieldNotSet
}, null, 2) + '\n');
console.log('MEMBER_ID_COVERAGE ' + JSON.stringify({
  total_wp: memberIdRows.length,
  set: memberIdRows.length - fieldNotSet.length,
  missing: fieldMissing.length,
  invalid: fieldNotSet.length - fieldMissing.length,
  missing_with_exact_tld_member_match: memberMappedMissing.length,
  missing_without_exact_match: fieldNotSet.length - memberMappedMissing.length,
  distinct_missing_product_origins: new Set(fieldNotSet.map(r => r.origin_id)).size
}));
for (const row of fieldNotSet) console.log('MEMBER_ID_MISSING_RECORD ' + JSON.stringify(row));
console.log('MEMBER_ID_AUDIT_READ_ONLY: no WordPress products were modified.');
