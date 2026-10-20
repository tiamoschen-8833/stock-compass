// 收盤後訊號檢查：用網站同一套「止跌反轉四道閘門」規則，計算 watchlist.json 中每檔追蹤個股，輸出 signals.json
import { JSDOM } from 'jsdom';
import fs from 'node:fs';

const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10); // 台北日期
const force = process.argv.includes('--force');
const prev = fs.existsSync('signals.json') ? JSON.parse(fs.readFileSync('signals.json', 'utf8')) : null;
if (!force && prev?.date === today && prev?.complete) { console.log('今日已完成，略過'); process.exit(0); }
const wl = JSON.parse(fs.readFileSync('watchlist.json', 'utf8'));
if (!wl.watch?.length) { console.log('追蹤清單為空'); }

const html = fs.readFileSync('index.html', 'utf8');
const dom = new JSDOM(html, {
  runScripts: 'dangerously', url: 'https://tiamoschen-8833.github.io/stock-compass/',
  beforeParse(w) { w.fetch = fetch; w.scrollTo = () => {}; }
});
const w = dom.window;
w.__WL = wl;
const res = await w.eval(`(async()=>{
  const WL=window.__WL;
  S.me.watch=WL.watch||[]; if(WL.groups) S.me.groups=WL.groups; S.me.sig=WL.sig||null; S.me.sigBy=WL.sigBy||{};
  S.me.companies=[...new Set([...S.me.companies,...S.me.watch])];
  const since=d=>dstr(new Date(Date.now()-d*864e5));
  const tx=(await bget('dataset=TaiwanStockPrice&data_id=TAIEX&start_date='+since(200))).map(x=>[x.date,x.open,x.max,x.min,x.close,Math.round(x.Trading_money/1e8)]);
  S.market={taiex:tx, etf:DATA.etf};
  const peers=new Set(S.me.watch); for(const id of S.me.watch){ const g=groupOf(id); if(g) for(const p of S.me.groups[g]) peers.add(p); }
  const failed=[];
  for(const id of peers){
    try{ const px=(await bget('dataset=TaiwanStockPrice&data_id='+id+'&start_date='+since(200))).map(x=>[x.date,x.open,x.max,x.min,x.close,Math.round(x.Trading_Volume/1000)]);
      const base=DATA.co[id]||{n:DATA.stockList[id]?.[0]||id,i:DATA.stockList[id]?.[2]||'',m:DATA.stockList[id]?.[1]||'',fs:{},bs:{},cf:{},mr:[],per:null};
      if(px.length) S.cache[id]={...base, px, upd:Date.now()}; }
    catch(e){ failed.push(id+'：'+(e.message||e.code)); }
  }
  memo.clear();
  const stocks=S.me.watch.map(id=>{ const E=co(id)?signalEval(id):null; if(!E||!E.date) return {id,name:nameOf(id),status:'資料不足'};
    const P=E.i>0?signalEval(id,E.i-1):null; const px=adjPx(co(id).px);
    const miss=SG_GATES.flatMap(([g,t,ks])=>ks.filter(([k])=>E.gates[g]?.items?.[k]?.s!=='ok').map(([k,l])=>g+'-'+l));
    return {id,name:nameOf(id),date:E.date,status:E.status,prevStatus:P?.status||null,close:px[E.i][4],chg:+(px[E.i][4]/px[E.i-1][4]-1).toFixed(4),
      L:E.L,L2:E.L2,H:E.H,stop:E.stop!=null?+E.stop.toFixed(2):null,target:E.target??null,rr:E.rr!=null?+E.rr.toFixed(2):null,
      gates:[1,2,3,4].map(g=>!!E.gates[g]?.pass), missing:miss, alerts:E.alerts.map(a=>a[1]),
      position:E.pos?{capital:sgCfg(id).capital,riskPct:sgCfg(id).risk,maxLoss:Math.round(E.loss),amount:Math.round(E.pos),lots:E.lots,oddShares:E.odd}:null};
  });
  return {taiexDate:tx.at(-1)?.[0], env:stocks.length&&co(S.me.watch[0])?marketEnv(adjPx(co(S.me.watch[0]).px).at(-1)[0],S.me.watch[0]).text:null, stocks, failed};
})()`);

const complete = res.taiexDate === today && res.stocks.every(s => s.date === today);
const out = {
  date: res.taiexDate, complete, generatedAt: new Date().toISOString(),
  env: res.env, watchUpdatedAt: wl.updatedAt || null,
  summary: {
    entry: res.stocks.filter(s => s.status === '可評估進場').map(s => s.id),
    changed: res.stocks.filter(s => s.prevStatus && s.prevStatus !== s.status).map(s => ({ id: s.id, from: s.prevStatus, to: s.status }))
  },
  stocks: res.stocks, failed: res.failed
};
if (res.taiexDate !== today && !force) { console.log('FinMind 尚未更新今日（最新 ' + res.taiexDate + '），稍後再試'); process.exit(0); }
fs.writeFileSync('signals.json', JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.summary), 'complete=' + complete);
