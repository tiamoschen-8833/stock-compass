// ETF 每日持股：抓元大投信「持股比重」頁（伺服器端渲染的 window.__NUXT__），
// 取出每檔成分股的持有股數與權重，累積到 etf-holdings.json（保留最近 KEEP 個資料日）。
// 網站「本股 ETF 持股變化」以相鄰資料日的股數相減，判斷 ETF 對個股是加碼、減碼、新進或出清。
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const FILE = 'etf-holdings.json';
const KEEP = 30;
const ETFS = [
  { code: '0050', url: 'https://www.yuantaetfs.com/product/detail/0050/ratio' },
  { code: '0056', url: 'https://www.yuantaetfs.com/product/detail/0056/ratio' }
];
const UA = 'Mozilla/5.0 (compatible; stock-compass/1.0; +https://tiamoschen-8833.github.io/stock-compass/)';

// 元大網站憑證鏈在部分 OpenSSL 版本驗證會失敗，先用 Node fetch，失敗改用 curl
async function getHtml(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } catch (e) {
    console.log('fetch 失敗（' + (e.cause?.code || e.message) + '），改用 curl');
    return execFileSync('curl', ['-fsSL', '--max-time', '60', '-A', UA, url], { encoding: 'utf8', maxBuffer: 64 << 20 });
  }
}

// __NUXT__ 是包裝過的函式運算式，不是純 JSON；在空白沙箱中求值，不給任何全域物件
function extract(html) {
  const m = html.match(/<script>window\.__NUXT__=(.*?)<\/script>/s);
  if (!m) throw new Error('頁面沒有 window.__NUXT__');
  const nuxt = vm.runInNewContext('(' + m[1].replace(/;\s*$/, '') + ')', Object.create(null), { timeout: 2000 });
  const wd = (nuxt?.data || []).find(p => p?.weightData?.FundWeights)?.weightData;
  if (!wd) throw new Error('找不到 weightData.FundWeights');
  const pcf = wd.PCF || {}, tr = String(pcf.trandate || '');
  const date = /^\d{8}$/.test(tr) ? tr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3') : tr;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('資料日格式不符：' + tr);
  const h = {};
  for (const s of wd.FundWeights.StockWeights || []) {
    const code = String(s.code || '').trim();
    if (!/^\d{4,6}[A-Z]?$/.test(code)) continue;
    h[code] = [Number(s.qty) || 0, Number(s.weights) || 0, s.name || ''];
  }
  if (Object.keys(h).length < 10) throw new Error('成分股數量異常：' + Object.keys(h).length);
  return { date, upd: pcf.upddate || null, name: pcf.fundname || '', h };
}

const db = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : { etfs: {} };
db.etfs ||= {};
const failed = [];
let changed = false;
for (const e of ETFS) {
  try {
    const x = extract(await getHtml(e.url));
    const slot = db.etfs[e.code] ||= { name: x.name, url: e.url, days: [] };
    slot.name = x.name || slot.name; slot.url = e.url;
    const old = slot.days.find(d => d.d === x.date);
    if (old && JSON.stringify(old.h) === JSON.stringify(x.h)) { console.log(e.code, x.date, '已是最新'); continue; }
    changed = true;
    slot.days = slot.days.filter(d => d.d !== x.date);
    slot.days.push({ d: x.date, upd: x.upd, src: 'yuanta', h: x.h });
    slot.days.sort((a, b) => a.d.localeCompare(b.d));
    slot.days = slot.days.slice(-KEEP);
    console.log(e.code, x.date, Object.keys(x.h).length + ' 檔');
  } catch (err) {
    failed.push(e.code + '：' + err.message);
    console.log(e.code, '失敗', err.message);
  }
}
if (!changed && !failed.length) { console.log('沒有新資料'); process.exit(0); }
db.generatedAt = new Date().toISOString();
db.source = '元大投信 ETF 持股比重頁（yuantaetfs.com）';
db.failed = failed;
fs.writeFileSync(FILE, JSON.stringify(db) + '\n');
if (failed.length === ETFS.length) process.exit(1);
