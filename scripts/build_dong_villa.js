// 법정동 빌라(연립+다세대) 실거래 데이터 빌드 (시세비교용)
// 사용: node scripts/build_dong_villa.js <lawd5> <"시군구명"> <동명> <출력파일> [fromYYYYMM] [toYYYYMM]
//   예: node scripts/build_dong_villa.js 28177 "인천 미추홀구" 주안동 data/juan_villa.json
// 로컬 프록시(proxy/server.js, 8787) 가 떠 있어야 함. 결과 포맷은 hwagok_villa.json 과 동일.
const fs = require('fs');
const path = require('path');
const PROXY = 'http://localhost:8787';

const [lawd, sgg, dong, out, fromArg, toArg] = process.argv.slice(2);
if (!lawd || !sgg || !dong || !out) { console.error('인자: <lawd5> <시군구명> <동명> <출력파일> [from] [to]'); process.exit(1); }
const FROM = parseInt(fromArg || '202301', 10), TO = parseInt(toArg || '202512', 10);

function months(from, to) { const r = []; let y = Math.floor(from / 100), m = from % 100; while (y * 100 + m <= to) { r.push(`${y}${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } return r; }

(async () => {
  const yms = months(FROM, TO), rows = []; let done = 0;
  const pool = 6; let i = 0;
  async function worker() {
    while (i < yms.length) {
      const ym = yms[i++];
      try {
        const r = await fetch(`${PROXY}/api/rh?lawd=${lawd}&ym=${ym}&rows=1000`);
        const j = await r.json();
        (j.items || []).forEach(it => {
          if (it.동 !== dong) return;
          if (it.해제) return;                 // 해제(취소) 거래 제외
          if (!(it.금액만원 > 0)) return;
          rows.push({ b: it.번지, nm: it.건물명, ar: it.전용면적, la: it.대지권면적, yr: it.건축년도, amt: it.금액만원, fl: it.층, ym: +ym });
        });
      } catch (e) { console.error('월', ym, '실패:', e.message); }
      process.stdout.write(`\r수집 ${++done}/${yms.length}개월 · ${rows.length}건`);
    }
  }
  await Promise.all(Array.from({ length: pool }, worker));
  const data = { meta: { dong, sgg, source: '국토부 실거래가', period: [FROM, TO], n: rows.length }, rows };
  fs.writeFileSync(path.join(__dirname, '..', out), JSON.stringify(data));
  const sz = fs.statSync(path.join(__dirname, '..', out)).size;
  console.log(`\n✅ ${out} 저장 — ${dong} ${rows.length}건 (${(sz / 1024).toFixed(0)}KB)`);
})();
