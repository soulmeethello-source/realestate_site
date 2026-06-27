// 로컬 개발용 프록시 — API 키를 .env 에서 읽어 숨기고, 공공 실거래가 API 를 중계합니다.
// 실행:  node proxy/server.js
// 매매:  http://localhost:8787/api/rh?lawd=11620&ym=202604        (lawd=법정동코드 5자리, ym=YYYYMM)
// 전월세: http://localhost:8787/api/rh-rent?lawd=11620&ym=202604
// 원본XML: 위 주소에 &raw=1 붙이면 원본 XML 그대로
// 상태:  http://localhost:8787/health
//
// 의존성 없음(Node 18+ 내장 fetch). 키는 코드에 없고 .env 에만 존재합니다.

const http = require('http');
const fs = require('fs');
const path = require('path');

// --- .env 로드 (의존성 없이) ---
function loadEnv() {
  const p = path.join(__dirname, '..', '.env');
  try {
    fs.readFileSync(p, 'utf8').split(/\r?\n/).forEach(line => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '').trim();
    });
  } catch (e) { /* .env 없으면 무시 */ }
}
loadEnv();

const KEY = process.env.MOLIT_API_KEY || '';
const PORT = parseInt(process.env.PROXY_PORT || '8787', 10);

// 국토교통부 RTMS 연립다세대 실거래가 (매매 / 전월세)
const ENDPOINTS = {
  trade: 'https://apis.data.go.kr/1613000/RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade',
  rent:  'https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent',
};

// vWorld 공동주택가격(공시가) — NED 부동산 속성조회 (PNU·기준연도)
const VWORLD_KEY = process.env.VWORLD_API_KEY || '';
const VWORLD_DOMAIN = process.env.VWORLD_DOMAIN || 'estate.lifetiming.kr';
const NED_APT = 'https://api.vworld.kr/ned/data/getApartHousingPriceAttr';

// --- XML <item> 파싱 (의존성 없이) ---
function parseItems(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(xml))) {
    const obj = {};
    const tagRe = /<([a-zA-Z]+)>([\s\S]*?)<\/\1>/g;
    let t;
    while ((t = tagRe.exec(m[1]))) obj[t[1]] = t[2].trim();
    items.push(obj);
  }
  return items;
}
function tagVal(xml, tag) {
  const m = xml.match(new RegExp('<' + tag + '>([\\s\\S]*?)<\\/' + tag + '>'));
  return m ? m[1].trim() : '';
}
const num = s => { const v = parseFloat(String(s || '').replace(/[^0-9.]/g, '')); return isNaN(v) ? null : v; };

// 매매 item → 깔끔한 스키마
function mapTrade(it) {
  return {
    동: it.umdNm || '', 건물명: it.mhouseNm || '', 유형: it.houseType || '',
    전용면적: num(it.excluUseAr), 대지권면적: num(it.landAr),
    금액만원: num(it.dealAmount), 층: num(it.floor), 건축년도: num(it.buildYear),
    계약: `${it.dealYear}-${String(it.dealMonth).padStart(2, '0')}-${String(it.dealDay).padStart(2, '0')}`,
    매수자: it.buyerGbn || '', 매도자: it.slerGbn || '', 거래유형: it.dealingGbn || '',
    해제: (it.cdealType && it.cdealType.trim()) ? it.cdealType.trim() : '',
    번지: it.jibun || '', sggCd: it.sggCd || '',
  };
}
// 공동주택 공시가격 item → 깔끔한 스키마
function mapGongsi(it) {
  return {
    연도: it.stdrYear || '', 공시가: num(it.pblntfPc), 전용면적: num(it.prvuseAr),
    번지: it.mnnmSlno || '', 건물명: it.aphusNm || '', 유형: it.aphusSeCodeNm || '',
    동: it.dongNm || '', 호: it.hoNm || '', 층: num(it.floorNm),
    법정동: it.ldCodeNm || '', pnu: it.pnu || '',
  };
}
// 전월세 item → 깔끔한 스키마 (월세 0 = 전세)
function mapRent(it) {
  return {
    동: it.umdNm || '', 건물명: it.mhouseNm || '', 유형: it.houseType || '',
    전용면적: num(it.excluUseAr), 보증금: num(it.deposit), 월세: num(it.monthlyRent),
    층: num(it.floor), 건축년도: num(it.buildYear),
    계약: `${it.dealYear}-${String(it.dealMonth).padStart(2, '0')}-${String(it.dealDay).padStart(2, '0')}`,
    번지: it.jibun || '', sggCd: it.sggCd || '',
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };
  const u = new URL(req.url, 'http://localhost');

  if (u.pathname === '/health') { send(200, { ok: true, keyLoaded: !!KEY, vworld: !!VWORLD_KEY }); return; }

  // 공동주택 공시가격 (vWorld NED)
  if (u.pathname === '/api/gongsi') {
    if (!VWORLD_KEY) { send(500, { error: 'VWORLD_API_KEY 미설정 — .env 를 확인하세요' }); return; }
    const pnu = u.searchParams.get('pnu');
    if (!pnu) { send(400, { error: 'pnu(19자리) 파라미터 필요' }); return; }
    const year = u.searchParams.get('year') || '';
    const rows = u.searchParams.get('rows') || '1000';
    let apiUrl = `${NED_APT}?key=${encodeURIComponent(VWORLD_KEY)}&domain=${encodeURIComponent(VWORLD_DOMAIN)}&pnu=${encodeURIComponent(pnu)}&format=json&numOfRows=${rows}&pageNo=1`;
    if (year) apiUrl += `&stdrYear=${encodeURIComponent(year)}`;
    try {
      const r = await fetch(apiUrl);
      const j = await r.json();
      if (u.searchParams.get('raw')) { send(r.status, j); return; }
      const ah = j.apartHousingPrices || (j.response || {}).apartHousingPrices || {};
      const raw = ah.field || [];
      const items = (Array.isArray(raw) ? raw : [raw]).map(mapGongsi);
      send(200, { ok: true, pnu, year, count: items.length, items });
    } catch (e) {
      send(502, { error: 'vWorld 호출 실패: ' + String(e) });
    }
    return;
  }

  const kind = u.pathname === '/api/rh' ? 'trade' : u.pathname === '/api/rh-rent' ? 'rent' : null;
  if (kind) {
    if (!KEY) { send(500, { error: 'MOLIT_API_KEY 미설정 — .env 를 확인하세요' }); return; }
    const lawd = u.searchParams.get('lawd');
    const ym = u.searchParams.get('ym');
    if (!lawd || !ym) { send(400, { error: 'lawd(법정동코드 5자리), ym(YYYYMM) 파라미터 필요' }); return; }
    const rows = u.searchParams.get('rows') || '1000';
    const page = u.searchParams.get('page') || '1';
    const keyParam = KEY.includes('%') ? KEY : encodeURIComponent(KEY);
    const apiUrl = `${ENDPOINTS[kind]}?serviceKey=${keyParam}&LAWD_CD=${encodeURIComponent(lawd)}&DEAL_YMD=${encodeURIComponent(ym)}&numOfRows=${rows}&pageNo=${page}`;
    try {
      const r = await fetch(apiUrl);
      const xml = await r.text();
      if (u.searchParams.get('raw')) { res.statusCode = r.status; res.setHeader('Content-Type', 'text/xml; charset=utf-8'); res.end(xml); return; }
      const code = tagVal(xml, 'resultCode');
      if (code && code !== '000') { send(502, { error: 'API 오류: ' + tagVal(xml, 'resultMsg'), resultCode: code }); return; }
      const raw = parseItems(xml);
      const items = kind === 'trade' ? raw.map(mapTrade) : raw.map(mapRent);
      send(200, { ok: true, kind, lawd, ym, count: items.length, total: num(tagVal(xml, 'totalCount')), items });
    } catch (e) {
      send(502, { error: '업스트림 호출 실패: ' + String(e) });
    }
    return;
  }

  res.statusCode = 404; res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[proxy] http://localhost:${PORT}  (API 키 ${KEY ? '로드됨 ✓' : '없음 ✗ — .env 확인'})`);
  console.log(`[proxy] 매매:  http://localhost:${PORT}/api/rh?lawd=11620&ym=202604`);
});
