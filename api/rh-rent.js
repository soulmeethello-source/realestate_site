// Vercel 서버리스 함수 — 국토교통부 연립다세대(빌라) 전월세 실거래가 중계
// 호출:  /api/rh-rent?lawd=11500&ym=202604   (lawd=법정동코드 5자리, ym=YYYYMM)
// 키는 Vercel 환경변수 MOLIT_API_KEY 에만 존재. (로컬은 proxy/server.js)

const ENDPOINT = 'https://apis.data.go.kr/1613000/RTMSDataSvcRHRent/getRTMSDataSvcRHRent';

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

function mapRent(it) {
  return {
    동: it.umdNm || '', 건물명: it.mhouseNm || '', 유형: it.houseType || '',
    전용면적: num(it.excluUseAr), 보증금: num(it.deposit), 월세: num(it.monthlyRent),
    층: num(it.floor), 건축년도: num(it.buildYear),
    계약: `${it.dealYear}-${String(it.dealMonth).padStart(2, '0')}-${String(it.dealDay).padStart(2, '0')}`,
    번지: it.jibun || '', sggCd: it.sggCd || '',
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
  const send = (code, obj) => { res.status(code).setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(obj)); };

  const KEY = process.env.MOLIT_API_KEY || '';
  if (!KEY) { send(500, { error: 'MOLIT_API_KEY 미설정 — Vercel 환경변수를 확인하세요' }); return; }

  const { lawd, ym } = req.query || {};
  if (!lawd || !ym) { send(400, { error: 'lawd(법정동코드 5자리), ym(YYYYMM) 파라미터 필요' }); return; }
  const rows = req.query.rows || '1000';
  const page = req.query.page || '1';
  const keyParam = String(KEY).includes('%') ? KEY : encodeURIComponent(KEY);
  const apiUrl = `${ENDPOINT}?serviceKey=${keyParam}&LAWD_CD=${encodeURIComponent(lawd)}&DEAL_YMD=${encodeURIComponent(ym)}&numOfRows=${rows}&pageNo=${page}`;

  try {
    const r = await fetch(apiUrl);
    const xml = await r.text();
    if (req.query.raw) { res.status(r.status).setHeader('Content-Type', 'text/xml; charset=utf-8'); res.end(xml); return; }
    const code = tagVal(xml, 'resultCode');
    if (code && code !== '000') { send(502, { error: 'API 오류: ' + tagVal(xml, 'resultMsg'), resultCode: code }); return; }
    const items = parseItems(xml).map(mapRent);
    send(200, { ok: true, kind: 'rent', lawd, ym, count: items.length, total: num(tagVal(xml, 'totalCount')), items });
  } catch (e) {
    send(502, { error: '업스트림 호출 실패: ' + String(e) });
  }
};
