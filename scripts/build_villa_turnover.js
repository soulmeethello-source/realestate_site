// 빌라(연립+다세대) 시군구 회전율 빌드
//   회전율 = ranking 1년치 거래 ÷ KOSIS 시군구 재고(연립+다세대)
// 실행: node scripts/build_villa_turnover.js   (KOSIS 키는 .env)
// 출력: data/villa_turnover.json
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// .env 로드
fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach(l => {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
});

const SIDO = { '서울': '11', '인천': '23', '경기': '31' };
function parseRegion(지역) {           // "경기도 수원시 장안구 화서동" → {시, 구}
  const t = 지역.split(' '); let si = null, gu = null;
  for (let i = 1; i < t.length; i++) {
    if (/구$/.test(t[i])) gu = t[i];
    else if (/(시|군)$/.test(t[i])) si = t[i];
    else break;
  }
  return { 시: si, 구: gu };
}

(async () => {
  const rk = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/villa_ranking.json'), 'utf8'));

  // 1) KOSIS 시군구 재고 (연립+다세대, 최신연도)
  const key = (process.env.KOSIS_API_KEY || '').trim();
  const url = (process.env.KOSIS_API_URL || '').replace('__KEY__', key);
  const j = await (await fetch(url)).json();
  if (!Array.isArray(j)) throw new Error('KOSIS 응답 오류: ' + JSON.stringify(j).slice(0, 200));
  const Y = [...new Set(j.map(x => x.PRD_DE))].sort().pop();
  const stock = {}, stockCode = {};    // "11|강서구" → 재고 / KOSIS 코드(11500)
  j.forEach(x => {
    if (x.PRD_DE !== Y || x.C1.length !== 5 || /부$/.test(x.C1_NM)) return;
    if (!['연립주택', '다세대주택'].includes(x.ITM_NM)) return;
    const k = x.C1.slice(0, 2) + '|' + x.C1_NM;
    stock[k] = (stock[k] || 0) + (+x.DT || 0);
    stockCode[k] = x.C1;
  });

  // 2) ranking 거래를 KOSIS 단위로 집계 (구 우선, 없으면 부모 시)
  const agg = {};                      // unitKey → {시도, 시군구, 거래, 재고}
  rk.data.forEach(r => {
    const p = SIDO[r.시도]; if (!p) return;
    const { 시, 구 } = parseRegion(r.지역);
    let unitName = null, display = null;
    if (구 && stock[p + '|' + 구]) { unitName = 구; display = (시 ? 시 + ' ' : '') + 구; }
    else if (시 && stock[p + '|' + 시]) { unitName = 시; display = 시; }
    else if (구 && 시 && stock[p + '|' + 시]) { unitName = 시; display = 시; } // 신설구 → 부모 시
    if (!unitName) { (agg.__un = agg.__un || { miss: {} }).miss[(시 || '') + ' ' + (구 || '')] = true; return; }
    const k = p + '|' + unitName;
    if (!agg[k]) agg[k] = { 코드: stockCode[k], 시도: r.시도, 시군구: display, 거래: 0, 재고: stock[k] };
    agg[k].거래 += r.거래건수;
  });

  const data = Object.values(agg).filter(v => v.거래 != null)
    .map(v => ({ ...v, 회전율: +(v.거래 / v.재고 * 100).toFixed(2) }))
    .sort((a, b) => b.회전율 - a.회전율);

  const out = {
    기준: { 거래기간: rk.기간, 재고연도: Y, 단위: '연립+다세대 주택수(호)', 출처: 'KOSIS 주택총조사 + 국토부 실거래가' },
    갱신: rk.갱신, 시군구수: data.length, data,
  };
  fs.writeFileSync(path.join(ROOT, 'data/villa_turnover.json'), JSON.stringify(out, null, 0));
  console.log(`✅ data/villa_turnover.json 저장 — 시군구 ${data.length}개 (재고 ${Y}년, 거래 ${rk.기간})`);
  console.log('TOP10:', data.slice(0, 10).map(d => `${d.시군구} ${d.회전율}%`).join(', '));
})().catch(e => { console.error('에러:', e.message); process.exit(1); });
