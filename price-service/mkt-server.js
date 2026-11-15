/* 球鞋ERP 行情服务 · GOAT 公开搜索数据源 + AI 视觉识别(可选)
 * 零依赖(Node 18+ 自带 fetch),按货号查询分尺码海外行情;配好大模型key后支持拍照识别建档
 * 启动: node mkt-server.js   (默认端口 6120,可用 PORT 环境变量覆盖)
 * 接口:
 *   GET  /health            -> {"ok":true}
 *   GET  /price?sku=DD1391-100 -> {found, sku, name, image, retail, minCny, minUsd, sizes:[{eu,us,cny,usd}]}
 *   GET  /ai                -> {ok, configured, model}  AI识别是否已配置
 *   POST /ai  {image:<base64>} -> {ok, fields:{brand,model,color,sku,size,price}}  拍照识别商品信息
 * 大模型配置:同目录 config.json {"llm":{"url":"...chat/completions","key":"...","model":"glm-4v-flash"}}
 *   默认指向智谱开放平台(https://open.bigmodel.cn),glm-4v-flash 免费;任何 OpenAI 兼容视觉接口均可
 * 说明: 行情数据来自 GOAT 前端公开搜索接口,AI识别走你自己配置的大模型,均仅供个人使用。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 6120;
const ALGOLIA_URL = 'https://2fwotdvm2o-dsn.algolia.net/1/indexes/*/queries?x-algolia-application-id=2FWOTDVM2O&x-algolia-api-key=ac96de6fef0e02bb95d433d8d5c7038a';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function llmConfig(){
  try{
    const p = path.join(__dirname, 'config.json');
    if(fs.existsSync(p)){
      const c = JSON.parse(fs.readFileSync(p, 'utf8')).llm || {};
      return {
        url: c.url || 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
        key: c.key || process.env.LLM_KEY || '',
        model: c.model || 'glm-4v-flash'
      };
    }
  }catch(e){}
  return { url:'https://open.bigmodel.cn/api/paas/v4/chat/completions', key: process.env.LLM_KEY || '', model:'glm-4v-flash' };
}

const AI_PROMPT = '你是球鞋进销存系统的录入助手。仔细看图(可能是鞋盒标签、鞋舌标、鞋盒侧面或鞋子照片),提取字段并只输出严格JSON,不要任何多余文字或代码块标记:{"brand":"品牌,如Nike","model":"系列/型号,如Dunk Low","color":"配色,中文","sku":"货号,如DD1391-100","size":"欧码尺码,如42.5","price":"吊牌/发售价,纯数字"}。看不清或不确定的字段填空字符串,绝不允许编造。';

async function aiRecognize(b64){
  const cfg = llmConfig();
  if(!cfg.key) throw new Error('未配置大模型API key:请在 price-service/config.json 的 llm.key 填入(智谱 glm-4v-flash 免费)');
  const res = await fetch(cfg.url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + cfg.key },
    body: JSON.stringify({
      model: cfg.model,
      messages: [{ role:'user', content:[
        { type:'image_url', image_url:{ url:'data:image/jpeg;base64,' + b64 } },
        { type:'text', text: AI_PROMPT }
      ]}],
      temperature: 0.1, max_tokens: 300
    })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error('大模型接口错误 ' + res.status + ': ' + JSON.stringify(data).slice(0, 200));
  const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const m = text.match(/\{[\s\S]*\}/);
  if(!m) throw new Error('大模型未返回JSON: ' + text.slice(0, 120));
  const f = JSON.parse(m[0]);
  const clean = v => String(v == null ? '' : v).trim().slice(0, 60);
  return { brand:clean(f.brand), model:clean(f.model), color:clean(f.color), sku:clean(f.sku).toUpperCase(), size:clean(f.size), price:clean(f.price) };
}

function readBody(req){
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if(buf.length > 12e6) reject(new Error('图片过大')); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if(req.method === 'OPTIONS'){ res.end(); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if(u.pathname === '/health'){ res.end('{"ok":true,"service":"sneaker-erp-mkt"}'); return; }
  if(u.pathname === '/ai'){
    const cfg = llmConfig();
    if(req.method === 'GET'){ res.end(JSON.stringify({ ok:true, configured:!!cfg.key, model:cfg.model })); return; }
    try{
      const body = JSON.parse(await readBody(req) || '{}');
      if(!body.image) throw new Error('缺少 image 字段(base64)');
      const fields = await aiRecognize(String(body.image).replace(/^data:image\/\w+;base64,/, ''));
      console.log(new Date().toLocaleTimeString(), 'AI识别', JSON.stringify(fields));
      res.end(JSON.stringify({ ok:true, fields:fields }));
    }catch(e){
      console.log(new Date().toLocaleTimeString(), 'AI识别失败', String(e.message || e));
      res.statusCode = 400;
      res.end(JSON.stringify({ ok:false, error:String(e.message || e) }));
    }
    return;
  }
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
