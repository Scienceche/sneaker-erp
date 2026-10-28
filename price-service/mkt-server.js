/* 球鞋ERP 行情服务 · GOAT 公开搜索数据源
 * 零依赖(Node 18+ 自带 fetch),按货号查询分尺码海外行情
 * 启动: node mkt-server.js   (默认端口 6120,可用 PORT 环境变量覆盖)
 * 接口:
 *   GET /health            -> {"ok":true}
 *   GET /price?sku=DD1391-100 -> {found, sku, name, image, retail, minCny, minUsd, sizes:[{eu,us,cny,usd}]}
 * 说明: 数据来自 GOAT 前端公开的搜索接口(与开源 Sneaks-API 同源同性质),非官方、仅供个人行情参考。
 */
const http = require('http');
const PORT = process.env.PORT || 6120;
const ALGOLIA_URL = 'https://2fwotdvm2o-dsn.algolia.net/1/indexes/*/queries?x-algolia-application-id=2FWOTDVM2O&x-algolia-api-key=ac96de6fef0e02bb95d433d8d5c7038a';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

async function goatQuery(sku){
  const body = JSON.stringify({ requests:[{ indexName:'product_variants_v2', params:'query=' + encodeURIComponent(sku) + '&hitsPerPage=100' }] });
  let lastErr = null;
  for(let i=0;i<2;i++){
    try{
      const res = await fetch(ALGOLIA_URL, { method:'POST', headers:{ 'Content-Type':'application/json', 'User-Agent':UA }, body });
      if(!res.ok) throw new Error('algolia http ' + res.status);
      const data = await res.json();
      const hits = (data.results && data.results[0] && data.results[0].hits) || [];
      /* 精确匹配货号(search_sku 为去符号小写形式),避免搜出同名其它配色 */
      const matched = hits.filter(h => norm(h.search_sku) === norm(sku) || norm(h.sku) === norm(sku));
      return matched.length ? matched : [];
    }catch(e){ lastErr = e; await new Promise(r => setTimeout(r, 800)); }
  }
  throw lastErr || new Error('query failed');
}

function summarize(hits){
  const first = hits[0] || {};
  const map = {};
  hits.forEach(h => {
    if(h.shoe_condition && h.shoe_condition !== 'new_no_defects') return; /* 只统计全新 */
    const cny = Math.round((h.lowest_price_cents_cny || 0) / 100);
    const usd = Math.round((h.lowest_price_cents_usd || 0)) / 100;
    if(!cny && !usd) return;
    const eu = h.size_eu_men != null ? String(h.size_eu_men) : '';
    const us = h.size != null ? String(h.size) : '';
    const key = eu || ('US' + us);
    const cur = map[key] || { eu:eu, us:us, cny:0, usd:0 };
    if(cny && (!cur.cny || cny < cur.cny)) cur.cny = cny;
    if(usd && (!cur.usd || usd < cur.usd)) cur.usd = usd;
    map[key] = cur;
  });
  const sizes = Object.values(map);
  const cnyList = sizes.map(s => s.cny).filter(v => v > 0);
  const usdList = sizes.map(s => s.usd).filter(v => v > 0);
  return {
    found: sizes.length > 0,
    sku: first.sku || '',
    name: first.name || '',
    image: String(first.grid_picture_url || '').replace('/375/', '/750/'),
    retail: Math.round((first.retail_price_cents || 0) / 100),
    minCny: cnyList.length ? Math.min.apply(null, cnyList) : 0,
    minUsd: usdList.length ? Math.min.apply(null, usdList) : 0,
    sizes: sizes
  };
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if(u.pathname === '/health'){ res.end('{"ok":true,"service":"sneaker-erp-mkt"}'); return; }
  if(u.pathname !== '/price'){ res.statusCode = 404; res.end('{"error":"not found, use /price?sku=STYLE-CODE"}'); return; }
  const sku = (u.searchParams.get('sku') || '').trim();
  if(!sku){ res.statusCode = 400; res.end('{"error":"sku required"}'); return; }
  try{
    const hits = await goatQuery(sku);
    const out = hits.length ? summarize(hits) : { found:false };
    console.log(new Date().toLocaleTimeString(), sku, out.found ? ('sizes=' + out.sizes.length + ' minCny=' + out.minCny) : 'not found');
    res.end(JSON.stringify(out));
  }catch(e){
    console.log(new Date().toLocaleTimeString(), sku, 'ERROR', String(e.message || e));
    res.statusCode = 502;
    res.end(JSON.stringify({ error:String(e.message || e) }));
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log('球鞋ERP 行情服务已启动(GOAT数据源)');
  console.log('  本机:   http://127.0.0.1:' + PORT);
  console.log('  局域网: http://<本机IP>:' + PORT + '   (手机与电脑同WiFi可用)');
  console.log('  按 Ctrl+C 停止');
});
