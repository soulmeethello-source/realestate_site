// Vercel 서버리스 함수 — vWorld 공동주택 공시가격(NED) 중계
// 호출:  /api/gongsi?pnu=1150010300103760009&year=2025   (pnu=19자리, year=기준연도 YYYY)
// 키·도메인은 Vercel 환경변수 VWORLD_API_KEY / VWORLD_DOMAIN 에만 존재. (로컬은 proxy/server.js)

const ENDPOINT = 'https://api.vworld.kr/ned/data/getApartHousingPriceAttr';

const num = s => { const v = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v; };

function mapGongsi(it) {
  return {
    연도: it.stdrYear || '', 공시가: num(it.pblntfPc), 전용면적: num(it.prvuseAr),
    번지: it.mnnmSlno || '', 건물명: it.aphusNm || '', 유형: it.aphusSeCodeNm || '',
    동: it.dongNm || '', 호: it.hoNm || '', 층: num(it.floorNm),
    법정동: it.ldCodeNm || '', pnu: it.pnu || '',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  const send = (code, obj) => { res.status(code).setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };

  const KEY = process.env.VWORLD_API_KEY || '';
  const DOMAIN = process.env.VWORLD_DOMAIN || 'estate.lifetiming.kr';
  if (!KEY) { send(500, { error: 'VWORLD_API_KEY 미설정 — Vercel 환경변수를 확인하세요' }); return; }

  const { pnu, year } = req.query || {};
  if (!pnu) { send(400, { error: 'pnu(19자리) 파라미터 필요' }); return; }
  const rows = req.query.rows || '1000';
  let apiUrl = `${ENDPOINT}?key=${encodeURIComponent(KEY)}&domain=${encodeURIComponent(DOMAIN)}&pnu=${encodeURIComponent(pnu)}&format=json&numOfRows=${rows}&pageNo=1`;
  if (year) apiUrl += `&stdrYear=${encodeURIComponent(year)}`;

  try {
    const r = await fetch(apiUrl);
    const j = await r.json();
    if (req.query.raw) { res.status(r.status).setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(j)); return; }
    const ah = j.apartHousingPrices || (j.response || {}).apartHousingPrices || {};
    const raw = ah.field || [];
    const items = (Array.isArray(raw) ? raw : [raw]).map(mapGongsi);
    send(200, { ok: true, pnu, year: year || '', count: items.length, items });
  } catch (e) {
    send(502, { error: 'vWorld 호출 실패: ' + String(e) });
  }
};
