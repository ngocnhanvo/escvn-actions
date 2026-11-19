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
