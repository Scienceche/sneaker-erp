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

/* ================= 得物采集触发页 ================= */
function collectPage() {
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="theme-color" content="#0f1115">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="得物采集">
<link rel="manifest" href="/dewu/manifest.json">
<link rel="icon" type="image/png" sizes="192x192" href="/dewu/icon-192.png">
<link rel="apple-touch-icon" href="/dewu/icon-192.png">
<link rel="shortcut icon" href="/dewu/icon-192.png">
<title>得物行情采集</title><style>
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#0f1115;color:#e8eaf0;font-size:15px;padding:16px;padding-top:calc(16px + env(safe-area-inset-top));max-width:520px;margin:0 auto;min-height:100vh}
h1{font-size:1.3em;margin:12px 0 16px;display:flex;align-items:center;gap:8px}
h1 .dot{width:10px;height:10px;border-radius:50%;background:#c8f135;box-shadow:0 0 10px #c8f135}
.card{background:#171a21;border:1px solid #2a2f3a;border-radius:14px;padding:16px;margin-bottom:14px}
.card h3{font-size:14px;margin-bottom:10px;color:#8b93a3;font-weight:400}
textarea{width:100%;height:100px;background:#1e222b;color:#e8eaf0;border:1px solid #2a2f3a;border-radius:10px;padding:12px;font-size:15px;resize:none;outline:none}
textarea:focus{border-color:#c8f135}
.btn{background:#c8f135;color:#111;border:none;border-radius:12px;padding:15px 20px;font-size:17px;font-weight:700;width:100%;cursor:pointer;margin-top:12px;transition:opacity .15s}
.btn:active{opacity:.7;transform:scale(.98)}
.btn:disabled{opacity:.3}
.btn.ghost{background:transparent;color:#8b93a3;border:1px solid #2a2f3a;font-weight:400;font-size:14px;padding:10px}
#status{font-size:13px;color:#8b93a3;margin-top:10px;white-space:pre-wrap;line-height:1.6}
.ok{color:#3ddc84}.err{color:#ff5252}
.dl-btn{display:none;margin-top:12px;background:#171a21;border:1px solid rgba(200,241,53,.4);color:#c8f135;border-radius:12px;padding:14px;text-align:center;font-size:16px;font-weight:600;text-decoration:none}
.dl-btn:active{opacity:.7}
.progress{display:none;margin-top:10px;background:#1e222b;border-radius:8px;height:6px;overflow:hidden}
.progress i{display:block;height:100%;background:#c8f135;border-radius:8px;transition:width .5s;width:0}
.hint{font-size:12px;color:#5a6170;line-height:1.6;margin-top:10px}
.hist{font-size:12px;color:#8b93a3;line-height:1.8}
.hist b{color:#c8f135}
.stat-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:14px}
.stat{background:#171a21;border:1px solid #2a2f3a;border-radius:12px;padding:10px 12px;text-align:center}
.stat .k{font-size:18px;font-weight:700;margin-top:2px}
.stat .l{font-size:11px;color:#8b93a3}
.stat.hl .k{color:#c8f135}
</style></head><body>
<h1><span class="dot"></span>得物行情采集</h1>

<div class="stat-row" id="stats" style="display:none">
  <div class="stat hl"><div class="k" id="sOk">0</div><div class="l">成功</div></div>
  <div class="stat"><div class="k" id="sTotal">0</div><div class="l">总数</div></div>
  <div class="stat"><div class="k" id="sTime">-</div><div class="l">耗时</div></div>
</div>

<div class="card">
<h3>货号列表(每行一个,留空自动用库存)</h3>
<textarea id="arts" placeholder="DD1391-100&#10;AQ9129-501&#10;IQ7604-100"></textarea>
<button class="btn" onclick="run()" id="btn">🚀 开始采集</button>
<button class="btn stop-btn" onclick="stopCollect()" id="stopBtn" style="display:none;background:transparent;color:#ff5252;border:1px solid rgba(255,82,82,.5);margin-top:8px;padding:12px">⛔ 强制停止</button>
<div class="progress" id="prog"><i id="progBar"></i></div>
<div id="status">填好货号点按钮,手机会自动操作得物App</div>
<a class="dl-btn" id="dl" href="/dewu/csv">📥 下载 CSV(导入ERP)</a>
</div>

<div class="card" id="scheduleCard" style="border-color:rgba(200,241,53,.25)">
<h3>⏰ 定时采集(手机插电脑时自动跑)</h3>
<div style="display:flex;align-items:center;gap:12px;margin:8px 0">
  <label style="flex:none;font-size:14px;color:#8b93a3">间隔</label>
  <select id="intervalH" style="flex:1;background:#1e222b;color:#e8eaf0;border:1px solid #2a2f3a;border-radius:8px;padding:8px 12px;font-size:14px">
    <option value="2">每 2 小时</option>
    <option value="4">每 4 小时</option>
    <option value="6" selected>每 6 小时</option>
    <option value="12">每 12 小时</option>
    <option value="24">每天一次</option>
  </select>
  <button class="btn ghost" style="flex:none;margin:0;padding:8px 16px" onclick="toggleSchedule()" id="schedBtn">开启</button>
</div>
<div id="schedStatus" class="hint">开启后,只要手机USB连着电脑,到了间隔就自动采集(用上次的货号清单)</div>
</div>

<div class="card">
<h3>使用说明</h3>
<p class="hint">① <b>手动采集</b>:贴入货号 → 点按钮 → 手机自动跑<br>
② <b>定时采集</b>:开启后手机插电脑就自动按间隔跑<br>
③ 采完下载CSV → 手机ERP导入</p>
<p class="hint" style="margin-top:8px;color:#5a6170">加到主屏幕:Chrome菜单 → 添加到主屏幕</p>
</div>

<div class="card" id="histCard" style="display:none">
<h3>上次采集</h3>
<div class="hist" id="hist"></div>
</div>

<script>
let polling=null;
async function run(){
  const btn=document.getElementById('btn');
  const stopBtn=document.getElementById('stopBtn');
  const st=document.getElementById('status');
  const dl=document.getElementById('dl');
  const prog=document.getElementById('prog');
  const bar=document.getElementById('progBar');
  const stats=document.getElementById('stats');
  btn.disabled=true;btn.textContent='⏳ 采集中...';
  stopBtn.style.display='block';
  st.textContent='正在启动采集引擎...';st.className='';dl.style.display='none';prog.style.display='block';
  try{
    const body={arts:document.getElementById('arts').value.trim()};
    const r=await fetch('/dewu/collect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const d=await r.json();
    stats.style.display='grid';
    document.getElementById('sOk').textContent=d.ok||0;
    document.getElementById('sTotal').textContent=d.total||0;
    if(d.ok>0){
      st.innerHTML='✅ 成功采集 <b style="color:#3ddc84">'+d.ok+'</b> / '+d.total+' 个货号';
      st.className='ok';
      dl.style.display='block';
      bar.style.width='100%';
      try{localStorage.setItem('lastCollect',JSON.stringify({time:new Date().toLocaleString(),ok:d.ok,total:d.total}))}catch(e){}
      showHist();
    }else{
      st.textContent='❌ '+(d.error||'全部失败,检查手机USB连接和得物App');
      st.className='err';
      bar.style.width='100%';bar.parentElement.style.display='none';
    }
  }catch(e){st.textContent='❌ 连不上行情服务,确保电脑开着';st.className='err';prog.style.display='none';}
  btn.disabled=false;btn.textContent='🚀 开始采集';
  stopBtn.style.display='none';
}
async function stopCollect(){
  const st=document.getElementById('status');
  try{
    const r=await fetch('/dewu/stop',{method:'POST'});
    const d=await r.json();
    st.textContent='⛔ '+d.msg;st.className='err';
  }catch(e){st.textContent='⛔ 停止请求失败';st.className='err';}
  document.getElementById('stopBtn').style.display='none';
  document.getElementById('btn').disabled=false;
  document.getElementById('btn').textContent='🚀 开始采集';
  document.getElementById('prog').style.display='none';
}
function showHist(){
  try{
    const h=JSON.parse(localStorage.getItem('lastCollect')||'null');
    if(h){document.getElementById('histCard').style.display='';document.getElementById('hist').innerHTML='<b>'+h.ok+'</b> / '+h.total+' 个 · '+h.time;}
  }catch(e){}
}
showHist();

/* 定时采集 */
async function loadSchedule(){
  try{
    const r=await fetch('/dewu/schedule');
    const s=await r.json();
    const btn=document.getElementById('schedBtn');
    const st=document.getElementById('schedStatus');
    document.getElementById('intervalH').value=s.intervalHours||6;
    if(s.enabled){
      btn.textContent='关闭';btn.style.background='#ff5252';btn.style.color='#fff';
      st.innerHTML='✅ 已开启,每 '+s.intervalHours+' 小时自动采集<br>下次: '+s.nextRun+'<br>上次: '+(s.lastResult?s.lastResult.ok+'/'+s.lastResult.total+'成功':'未运行');
    }else{
      btn.textContent='开启';btn.style.background='';btn.style.color='';
      st.textContent='开启后,只要手机USB连着电脑,到了间隔就自动采集';
    }
  }catch(e){}
}
async function toggleSchedule(){
  const btn=document.getElementById('schedBtn');
  const h=parseInt(document.getElementById('intervalH').value)||6;
  const r=await fetch('/dewu/schedule');
  const cur=await r.json();
  const body={enabled:!cur.enabled,intervalHours:h};
  await fetch('/dewu/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  loadSchedule();
}
loadSchedule();
setInterval(loadSchedule,30000);
</script></body></html>`;
}
let lastCollectResult = null;

/* ================= 定时采集调度器 ================= */
const SCHEDULE_FILE = path.join(__dirname, 'dewu-schedule.json');
const ARTICLES_FILE = path.join(__dirname, '..', '..', 'tools', 'my_articles.txt');

function loadSchedule(){
  try{ return JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8')); }catch(e){}
  return { enabled:false, intervalHours:6, lastRun:0, articles:[] };
}
function saveSchedule(s){ fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(s, null, 1)); }

let collectProc = null;
let collectBusy = false;

async function runCollect(arts){
  if(collectBusy) return { ok:0, total:0, error:'采集进行中' };
  collectBusy = true;
  try{
    let args = arts && arts.length ? arts : [];
    if(!args.length && fs.existsSync(ARTICLES_FILE)){
      args = fs.readFileSync(ARTICLES_FILE, 'utf8').trim().split('\n').filter(Boolean);
    }
    if(!args.length) args = ['DD1391-100'];
    console.log(new Date().toLocaleTimeString(), '[定时] 得物采集启动:', args.length, '个货号');
    const proc = require('child_process').spawn('python',
      [path.join(__dirname, '..', '..', 'tools', 'dewu_query.py'), ...args],
      { cwd: path.join(__dirname, '..', '..', 'tools'), stdio: 'pipe' });
    collectProc = proc;
    let out = '';
    proc.stdout.on('data', d => { out += d; const line = String(d).trim(); if(line) console.log('  [dewu]', line); });
    proc.stderr.on('data', d => { out += d; });
    await new Promise(resolve => { proc.on('close', resolve); });
    const m = out.match(/成功 (\d+)\/(\d+)/);
    lastCollectResult = { ok: m ? parseInt(m[1]) : 0, total: m ? parseInt(m[2]) : 0, time: new Date().toISOString(), errors: out.slice(-300) };
    console.log('[定时] 完成:', JSON.stringify(lastCollectResult));
    return lastCollectResult;
  }catch(e){
    return { ok:0, total:0, error:String(e.message || e) };
  }finally{
    collectBusy = false; collectProc = null;
  }
}

/* 定时器:每5分钟检查一次是否该跑了 */
setInterval(async () => {
  const s = loadSchedule();
  if(!s.enabled) return;
  const next = s.lastRun + s.intervalHours * 3600000;
  if(Date.now() >= next && !collectBusy){
    console.log('[定时] 触发定时采集');
    const r = await runCollect(s.articles);
    s.lastRun = Date.now();
    saveSchedule(s);
  }
}, 5 * 60 * 1000);

/* ================= 备份 ================= */
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
      temperature: 0.1, max_tokens: 1024,
      thinking: { type: 'disabled' }  /* GLM-4.5系为思考模型,关掉以免token耗在推理上;其他端点会忽略 */
    })
  });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error('大模型接口错误 ' + res.status + ': ' + JSON.stringify(data).slice(0, 200));
  const msg = (data.choices && data.choices[0] && data.choices[0].message) || {};
  const text = msg.content || msg.reasoning_content || '';
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

/* 可选本地扩展包(不入库):同目录存在 gx-local.js 等扩展时自动挂载,提供额外的行情数据源端点 */
const localExts = [];
try{
  const gx = require('./gx-local.js');
  if(gx && gx.handle) localExts.push(gx);
}catch(e){}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if(req.method === 'OPTIONS'){ res.end(); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for(const ext of localExts){
    try{ if(await ext.handle(u.pathname, req, res)) return; }catch(e){}
  }
  /* ================= 静态文件服务(ERP托管) ================= */
  const ERP_DIR = path.join(__dirname, '..');
  const MIME = { '.html':'text/html; charset=utf-8', '.js':'application/javascript; charset=utf-8',
    '.css':'text/css; charset=utf-8', '.json':'application/json', '.png':'image/png',
    '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
  if(req.method === 'GET' && !u.pathname.startsWith('/price') && !u.pathname.startsWith('/ai')
     && !u.pathname.startsWith('/gx') && !u.pathname.startsWith('/dewu') && !u.pathname.startsWith('/health')){
    let fp = path.join(ERP_DIR, u.pathname === '/' ? 'index.html' : u.pathname);
    if(!fp.startsWith(ERP_DIR)) { res.statusCode = 403; res.end(); return; }
    try{
      const data = fs.readFileSync(fp);
      res.setHeader('Content-Type', MIME[path.extname(fp)] || 'application/octet-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.end(data);
    }catch(e){
      // SPA fallback: 非API路径都回index.html
      try{
        const data = fs.readFileSync(path.join(ERP_DIR, 'index.html'));
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(data);
      }catch(e2){ res.statusCode = 404; res.end('Not found'); }
    }
    return;
  }

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
  if(u.pathname === '/dewu/collect' && req.method === 'GET'){
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(collectPage()); return;
  }
  if(u.pathname === '/dewu/manifest.json'){
    try{
      const m = fs.readFileSync(path.join(__dirname, 'dewu-manifest.json'));
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(m);
    }catch(e){ res.statusCode = 404; res.end('{}'); }
    return;
  }
  if(u.pathname.startsWith('/dewu/icon-')){
    try{
      const size = u.pathname.includes('512') ? '512' : '192';
      const icon = fs.readFileSync(path.join(__dirname, '..', 'icons', 'icon-' + size + '.png'));
      res.setHeader('Content-Type', 'image/png');
      res.end(icon);
    }catch(e){ res.statusCode = 404; res.end(); }
    return;
  }
  if(u.pathname === '/dewu/schedule' && req.method === 'GET'){
    const s = loadSchedule();
    const next = s.enabled ? new Date(s.lastRun + s.intervalHours * 3600000).toLocaleString() : null;
    res.end(JSON.stringify({ ...s, nextRun: next, busy: collectBusy, lastResult: lastCollectResult }));
    return;
  }
  if(u.pathname === '/dewu/schedule' && req.method === 'POST'){
    try{
      const body = JSON.parse(await readBody(req) || '{}');
      const s = loadSchedule();
      if(body.enabled !== undefined) s.enabled = !!body.enabled;
      if(body.intervalHours) s.intervalHours = Math.max(1, Math.min(48, parseInt(body.intervalHours) || 6));
      if(body.articles) s.articles = body.articles;
      if(body.reset) s.lastRun = 0;
      saveSchedule(s);
      console.log('[定时] 更新:', JSON.stringify(s));
      res.end(JSON.stringify({ ok:true, ...s }));
    }catch(e){ res.end(JSON.stringify({ ok:false, error:String(e.message) })); }
    return;
  }
  if(u.pathname === '/dewu/collect' && req.method === 'POST'){
    try{
      const body = JSON.parse(await readBody(req) || '{}');
      let arts = (body.arts || '').split(/[\n,，;；\s]+/).filter(Boolean);
      /* 手动采集:空输入必须报错(防止误触跑全量);定时采集才用保存清单 */
      if(!arts.length){
        res.end(JSON.stringify({ ok:0, total:0, error:'请先输入货号(每行一个)' }));
        return;
      }
      /* 同时更新定时清单 */
      const s = loadSchedule();
      if(arts.length) s.articles = arts;
      saveSchedule(s);
      const r = await runCollect(arts);
      /* 记录本次为最后一次运行 */
      s.lastRun = Date.now(); saveSchedule(s);
      res.end(JSON.stringify(r));
    }catch(e){ res.end(JSON.stringify({ ok:0, total:0, error:String(e.message || e) })); }
    return;
  }
  if(u.pathname === '/dewu/stop' && req.method === 'POST'){
    if(collectProc){
      try{ collectProc.kill('SIGKILL'); }catch(e){}
      collectProc = null;
      collectBusy = false;
      console.log(new Date().toLocaleTimeString(), '[采集] 用户强制停止');
      res.end(JSON.stringify({ ok:true, msg:'已强制停止' }));
    }else{
      res.end(JSON.stringify({ ok:true, msg:'当前无采集任务' }));
    }
    return;
  }
  if(u.pathname === '/dewu/csv'){
    const csvPath = path.join(__dirname, '..', '..', 'tools', 'dewu_prices.csv');
    try{
      const csv = fs.readFileSync(csvPath);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="dewu_prices.csv"');
      res.end(csv);
    }catch(e){ res.statusCode = 404; res.end('{"error":"CSV不存在,先采集一次"}'); }
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
