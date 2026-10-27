/* 집터 공통 스크립트: 내비, 저장소, 데이터 로더, 주소 도우미, 예산 계산 */
window.JT = (function () {
  "use strict";

  // ---------- 설정 ----------
  var KAKAO_KEY = "37e04196393a74fd4c0faa01f2042f84";
  var PAGES = [
    { href: "index.html", key: "budget", label: "내 예산" },
    { href: "find.html", key: "find", label: "후보 찾기" },
    { href: "map.html", key: "map", label: "지도·핀" },
    { href: "visit.html", key: "visit", label: "임장" },
    { href: "policy.html", key: "policy", label: "정책" },
    { href: "terms.html", key: "terms", label: "용어" }
  ];

  // 2026-10-27 기준 규정 파라미터 (금액 단위: 만원). 출처는 policy.html 참고.
  var P = {
    asOf: "2026-10-27",
    ltv: { regGeneral: 0.40, regFirst: 0.70, regLowIncome: 0.60, lowIncomeMax: 9000, lowIncomePriceMax: 80000, metro: 0.70, nonmetro: 0.70, nonmetroFirst: 0.80 },
    loanCap: [[150000, 60000], [250000, 40000], [Infinity, 20000]], // 수도권·규제지역 주택가격별 주담대 총액 한도
    maxTermMetro: 30,
    dsr: { bank: 0.40, stressMetro: 0.03, stressNonmetro: 0.0075, ratio: { variable: 1.0, mixed: 0.8, periodic: 0.4, fixed: 0 } },
    rates: { variable: 4.5, fixed: 4.7, bogeumjari: 5.1, didimdol: [2.85, 4.15], newborn: [1.8, 4.5] },
    acq: { brackets: [[60000, 0.01], [90000, null], [Infinity, 0.03]], eduRatio: 0.10, ruralOver85: 0.002, firstTimeCapMan: 200, firstTimePriceMax: 120000 },
    broker: [[5000, 0.006, 25], [20000, 0.005, 80], [90000, 0.004, null], [120000, 0.005, null], [150000, 0.006, null], [Infinity, 0.007, null]],
    brokerVat: 0.10,
    miscCost: 150,
    policyLoans: {
      didimdol: { incomeMax: { general: 6000, first: 7000, twoKids: 7000, newlywed: 8500 }, priceMax: { general: 50000, newlywedOrTwoKids: 60000 }, cap: { general: 20000, first: 24000, newlywedOrTwoKids: 32000 }, areaMax: 85 },
      bogeumjari: { incomeMax: { general: 7000, newlywed: 8500, oneKid: 9000, multiKids: 10000 }, priceMax: 60000, cap: { general: 36000, first: 42000, multiKids: 40000 } },
      newborn: { incomeMax: 13000, incomeMaxDual: 20000, priceMax: 90000, cap: 40000, areaMax: 85 }
    },
    regulatedGyeonggi: ["과천시", "광명시", "성남분당구", "성남수정구", "성남중원구", "수원영통구", "수원장안구", "수원팔달구", "안양동안구", "용인수지구", "의왕시", "하남시", "화성동탄구", "용인기흥구", "구리시"]
  };

  // ---------- 도우미 ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function num(v) { var n = Number(v); return isFinite(n) && v !== "" && v != null ? n : null; }
  function fmtEok(man, digits) { // 만원 -> "11.5억" / "7,000만"
    if (man == null || !isFinite(man)) return "–";
    var neg = man < 0; man = Math.abs(man);
    var s;
    if (man >= 10000) { var e = man / 10000; s = (digits != null ? e.toFixed(digits) : (Math.round(e * 10) / 10).toString().replace(/\.0$/, "")) + "억"; }
    else s = Math.round(man).toLocaleString("ko-KR") + "만";
    return (neg ? "−" : "") + s;
  }
  function fmtMan(man) { return man == null ? "–" : Math.round(man).toLocaleString("ko-KR") + "만원"; }
  function uid(prefix) { return (prefix || "v") + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- 내비 ----------
  function renderNav(active) {
    var el = document.querySelector(".topbar-inner"); if (!el) return;
    el.innerHTML = '<a class="brand" href="index.html">집<span>터</span></a><nav class="nav" aria-label="주요 메뉴">' +
      PAGES.map(function (p) { return '<a href="' + p.href + '"' + (p.key === active ? ' aria-current="page"' : "") + '>' + p.label + '</a>'; }).join("") + '</nav>';
    if (window.JT_TERMS) termify(document);
  }

  // ---------- 저장소 (브라우저 localStorage) ----------
  function makeStore(lsKey) {
    var s = { items: lsGet(lsKey, []), listeners: [] };
    function emit() { s.listeners.forEach(function (fn) { fn(s.items); }); }
    s.onChange = function (fn) { s.listeners.push(fn); fn(s.items); };
    s.save = function (rec) { s.items = s.items.filter(function (r) { return r.id !== rec.id; }).concat([rec]); lsSet(lsKey, s.items); emit(); return Promise.resolve(rec); };
    s.remove = function (id) { s.items = s.items.filter(function (r) { return r.id !== id; }); lsSet(lsKey, s.items); emit(); return Promise.resolve(); };
    s.get = function (id) { return s.items.find(function (r) { return r.id === id; }) || null; };
    return s;
  }
  var candidates = makeStore("imjang.candidates.v1");
  var visits = makeStore("imjang.visits.v1");

  // ---------- 데이터 ----------
  var SIDO = {
    "서울": "seoul", "서울시": "seoul", "서울특별시": "seoul", "부산": "busan", "부산광역시": "busan", "대구": "daegu", "대구광역시": "daegu",
    "인천": "incheon", "인천광역시": "incheon", "광주": "gwangju", "광주광역시": "gwangju", "대전": "daejeon", "대전광역시": "daejeon",
    "울산": "ulsan", "울산광역시": "ulsan", "세종": "sejong", "세종특별자치시": "sejong", "경기": "gyeonggi", "경기도": "gyeonggi",
    "강원": "gangwon", "강원도": "gangwon", "강원특별자치도": "gangwon", "충북": "chungbuk", "충청북도": "chungbuk", "충남": "chungnam", "충청남도": "chungnam",
    "전북": "jeonbuk", "전라북도": "jeonbuk", "전북특별자치도": "jeonbuk", "전남": "jeonnam", "전라남도": "jeonnam",
    "경북": "gyeongbuk", "경상북도": "gyeongbuk", "경남": "gyeongnam", "경상남도": "gyeongnam", "제주": "jeju", "제주특별자치도": "jeju"
  };
  var SIDO_NAME = { seoul: "서울", busan: "부산", daegu: "대구", incheon: "인천", gwangju: "광주", daejeon: "대전", ulsan: "울산", sejong: "세종", gyeonggi: "경기", gangwon: "강원", chungbuk: "충북", chungnam: "충남", jeonbuk: "전북", jeonnam: "전남", gyeongbuk: "경북", gyeongnam: "경남", jeju: "제주" };
  var PRICE_AVAILABLE = ["seoul", "gyeonggi", "incheon"]; // 실거래 요약이 들어 있는 시도
  var cache = {};
  function loadJson(path) {
    if (cache[path]) return cache[path];
    cache[path] = fetch(path).then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .catch(function (e) { delete cache[path]; throw e; });
    return cache[path];
  }
  function loadApt(code) { return loadJson("data/apt-" + code + ".json"); }
  function loadPrice(code) { return loadJson("data/price-" + code + ".json"); }

  // 지번 주소 "경기 성남시 분당구 서현동 83" -> { code, dongKey, jibun }
  function parseJibunAddr(a) {
    var t = String(a || "").trim().split(/\s+/); if (t.length < 2) return null;
    var code = SIDO[t[0]]; if (!code) return null;
    var jibun = /^(산)?\d+(-\d+)?$/.test(t[t.length - 1]) ? t[t.length - 1] : "";
    var mid = t.slice(1, jibun ? -1 : undefined);
    if (mid.length >= 2 && /시$/.test(mid[0]) && /구$/.test(mid[1])) mid = [mid[0].slice(0, -1) + mid[1]].concat(mid.slice(2));
    return { code: code, dongKey: mid.join(" "), jibun: jibun, loose: false };
  }
  function parseNominatimAddr(displayName) {
    var parts = String(displayName || "").split(",").map(function (s) { return s.trim(); });
    var code = null, dong = "";
    parts.forEach(function (p) { if (!code && SIDO[p]) code = SIDO[p]; });
    for (var i = 0; i < parts.length; i++) { if (/(동|읍|면|리|가)$/.test(parts[i]) && !/\d/.test(parts[i]) && parts[i].length <= 6) { dong = parts[i]; break; } }
    return code ? { code: code, dongKey: dong, jibun: "", loose: true } : null;
  }
  function shortArea(displayName) {
    var parts = String(displayName || "").split(",").map(function (s) { return s.trim(); });
    var admin = parts.filter(function (p) { return (/(시|군|구|동|읍|면|리)$/.test(p) || /^.{1,3}도$/.test(p)) && !/^\d/.test(p); });
    if (!admin.length) admin = parts.filter(function (p) { return !/^\d{5}$/.test(p) && p !== "대한민국"; });
    return admin.slice(0, 3).reverse().join(" ");
  }
  function shortKakaoAddr(a) { var t = String(a || "").split(" "), out = []; for (var i = 0; i < t.length; i++) { if (/\d/.test(t[i])) break; out.push(t[i]); } return out.slice(0, 4).join(" "); }
  function normName(s) { return String(s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/아파트|apt|단지|\s+/g, ""); }
  function inDong(row, addr) {
    if (!addr || !addr.dongKey) return true;
    if (addr.loose) return row[1] === addr.dongKey || row[1].slice(-addr.dongKey.length - 1) === " " + addr.dongKey;
    return row[1] === addr.dongKey;
  }
  // 단지 데이터에서 주소·이름으로 찾기. rows: apt-*.json 행
  function aptMatch(rows, addr, name) {
    var out = { exact: null, list: [] };
    var same = rows.filter(function (r) { return inDong(r, addr); });
    if (addr && addr.jibun && !addr.loose) {
      var j = same.filter(function (r) { return r[2] === addr.jibun; });
      if (j.length === 1) { out.exact = j[0]; return out; }
      if (j.length > 1) out.list = j;
    }
    var q = normName(name);
    if (q) {
      var scored = (same.length ? same : rows).map(function (r) {
        var n = normName(r[0]), s = 0;
        if (n === q) s = 100; else if (n.indexOf(q) >= 0 || q.indexOf(n) >= 0) s = 60 + Math.min(n.length, q.length);
        else { var hit = 0; q.replace(/[가-힣a-z0-9]{2}/g, function (bg) { if (n.indexOf(bg) >= 0) hit++; return bg; }); s = hit * 4; }
        return { r: r, s: s };
      }).filter(function (x) { return x.s >= 8; }).sort(function (a, b) { return b.s - a.s || b.r[3] - a.r[3]; });
      if (scored.length && scored[0].s >= 100 && (scored.length === 1 || scored[1].s < 100)) { out.exact = scored[0].r; return out; }
      if (!out.list.length) out.list = scored.slice(0, 8).map(function (x) { return x.r; });
    }
    if (!out.list.length && same.length && same.length <= 12) out.list = same.slice().sort(function (a, b) { return b[3] - a[3]; });
    return out;
  }
  // 실거래 요약에서 단지 찾기 (dongKey + jibun, 없으면 이름)
  function priceMatch(rows, dongKey, jibun, name) {
    var hit = rows.filter(function (r) { return r[0] === dongKey && r[1] === jibun; });
    if (hit.length === 1) return hit[0];
    var q = normName(name);
    if (q) {
      var cand = (hit.length ? hit : rows.filter(function (r) { return r[0] === dongKey; })).filter(function (r) { return normName(r[2]) === q; });
      if (cand.length) return cand[0];
    }
    return hit[0] || null;
  }
  function areaLabel(a) { return a + "㎡ (" + Math.round(a / 3.3058) + "평형)"; }
  function pyeong(a) { return Math.round(a / 3.3058); }

  // ---------- 예산 계산 ----------
  function annuityFactor(annualRate, years) { var r = annualRate / 12, n = years * 12; if (r <= 0) return 1 / n; return r / (1 - Math.pow(1 + r, -n)); }
  function acquisitionTax(price, firstTime, over85) {
    var rate;
    if (price <= 60000) rate = 0.01;
    else if (price <= 90000) rate = Math.round(((price * 2 / 30000) - 3) * 100) / 10000;
    else rate = 0.03;
    var tax = price * rate;
    var exempt = 0;
    if (firstTime && price <= P.acq.firstTimePriceMax) exempt = Math.min(tax, P.acq.firstTimeCapMan);
    var base = tax - exempt;
    var edu = base * P.acq.eduRatio, rural = over85 ? price * P.acq.ruralOver85 : 0;
    return { rate: rate, tax: tax, exempt: exempt, edu: edu, rural: rural, total: base + edu + rural };
  }
  function brokerFee(price) {
    for (var i = 0; i < P.broker.length; i++) { var b = P.broker[i]; if (price < b[0] || b[0] === Infinity) { var f = price * b[1]; if (b[2] != null) f = Math.min(f, b[2]); return { rate: b[1], fee: f, vat: f * P.brokerVat, total: f * (1 + P.brokerVat) }; } }
    return { rate: 0, fee: 0, vat: 0, total: 0 };
  }
  function costsFor(price, inp) { var a = acquisitionTax(price, inp.firstTime, inp.over85), b = brokerFee(price); return { acq: a, broker: b, misc: P.miscCost, total: a.total + b.total + P.miscCost }; }
  function ltvFor(price, inp) {
    if (inp.region === "regulated") { if (inp.firstTime) return P.ltv.regFirst; if (inp.income <= P.ltv.lowIncomeMax && price <= P.ltv.lowIncomePriceMax) return P.ltv.regLowIncome; return P.ltv.regGeneral; }
    if (inp.region === "metro") return P.ltv.metro;
    return inp.firstTime ? P.ltv.nonmetroFirst : P.ltv.nonmetro;
  }
  function capFor(price, inp) { if (inp.region === "nonmetro") return Infinity; for (var i = 0; i < P.loanCap.length; i++) if (price <= P.loanCap[i][0]) return P.loanCap[i][1]; return 0; }
  function dsrLoan(inp) {
    var stress = inp.region === "nonmetro" ? P.dsr.stressNonmetro : P.dsr.stressMetro * (P.dsr.ratio[inp.loanType] != null ? P.dsr.ratio[inp.loanType] : 1);
    var annualCap = inp.income * P.dsr.bank - inp.debtMonthly * 12;
    if (annualCap <= 0) return { loan: 0, stressRate: inp.rate / 100 + stress, annualCap: annualCap };
    var af = annuityFactor(inp.rate / 100 + stress, inp.term);
    return { loan: annualCap / 12 / af, stressRate: inp.rate / 100 + stress, annualCap: annualCap };
  }
  function loanFor(price, inp) {
    var d = dsrLoan(inp), ltv = ltvFor(price, inp), cap = capFor(price, inp);
    var byLtv = price * ltv, byCap = cap, byDsr = d.loan;
    var loan = Math.max(0, Math.min(byLtv, byCap, byDsr));
    var binding = loan === byDsr ? "dsr" : loan === byCap ? "cap" : "ltv";
    return { loan: loan, ltv: ltv, byLtv: byLtv, byCap: byCap, byDsr: byDsr, binding: binding, stressRate: d.stressRate };
  }
  // 최대 집값: cash + loan(P) >= P + costs(P) 를 만족하는 최대 P (1000만원 단위 탐색)
  function maxPrice(inp) {
    var best = 0, step = 1000, limit = 1000000;
    for (var p = step; p <= limit; p += step) {
      var l = loanFor(p, inp).loan, c = costsFor(p, inp).total;
      if (inp.cash + l >= p + c) best = p; else if (p > best + 50000) break;
    }
    return best;
  }
  function monthlyPayment(loan, ratePct, years) { return loan * annuityFactor(ratePct / 100, years); }
  function policyEligibility(inp, price) {
    var pl = P.policyLoans, out = [];
    var kids = inp.children || 0;
    var dIncome = inp.newlywed ? pl.didimdol.incomeMax.newlywed : (inp.firstTime || kids >= 2) ? pl.didimdol.incomeMax.first : pl.didimdol.incomeMax.general;
    var dPrice = (inp.newlywed || kids >= 2) ? pl.didimdol.priceMax.newlywedOrTwoKids : pl.didimdol.priceMax.general;
    var dCap = (inp.newlywed || kids >= 2) ? pl.didimdol.cap.newlywedOrTwoKids : inp.firstTime ? pl.didimdol.cap.first : pl.didimdol.cap.general;
    out.push({ name: "디딤돌대출", ok: inp.income <= dIncome && price <= dPrice, why: "부부합산 " + fmtEok(dIncome) + " 이하 · 집값 " + fmtEok(dPrice) + " 이하 · 전용 85㎡ 이하", cap: dCap, rate: P.rates.didimdol[0] + "~" + P.rates.didimdol[1] + "%" });
    var bIncome = kids >= 2 ? pl.bogeumjari.incomeMax.multiKids : kids === 1 ? pl.bogeumjari.incomeMax.oneKid : inp.newlywed ? pl.bogeumjari.incomeMax.newlywed : pl.bogeumjari.incomeMax.general;
    var bCap = inp.firstTime ? pl.bogeumjari.cap.first : kids >= 2 ? pl.bogeumjari.cap.multiKids : pl.bogeumjari.cap.general;
    out.push({ name: "보금자리론", ok: inp.income <= bIncome && price <= pl.bogeumjari.priceMax, why: "부부합산 " + fmtEok(bIncome) + " 이하 · 집값 6억 이하", cap: bCap, rate: "약 " + P.rates.bogeumjari + "% 고정" });
    if (inp.newborn) out.push({ name: "신생아 특례대출", ok: inp.income <= (inp.dualIncome ? pl.newborn.incomeMaxDual : pl.newborn.incomeMax) && price <= pl.newborn.priceMax, why: "2년 내 출산 · 부부합산 1.3억(맞벌이 2억) 이하 · 집값 9억 이하", cap: pl.newborn.cap, rate: P.rates.newborn[0] + "~" + P.rates.newborn[1] + "%" });
    return out;
  }
  function budget(inp) {
    var price = maxPrice(inp);
    var loan = loanFor(price, inp), costs = costsFor(price, inp);
    return { price: price, loan: loan, costs: costs, cashUsed: price + costs.total - loan.loan, monthly: monthlyPayment(loan.loan, inp.rate, inp.term), dsr: dsrLoan(inp), policy: policyEligibility(inp, price), noLoanPrice: Math.max(0, Math.floor((inp.cash - P.miscCost) / 1.02 / 1000) * 1000) };
  }
  function regionOf(code, dongKey) {
    if (code === "seoul") return "regulated";
    if (code === "gyeonggi") { var sgg = (dongKey || "").split(" ")[0]; return P.regulatedGyeonggi.indexOf(sgg) >= 0 ? "regulated" : "metro"; }
    if (code === "incheon") return "metro";
    return "nonmetro";
  }

  // ---------- 지번 키 확장 (경기 "성남분당구 서현동" -> "성남시 분당구 서현동") ----------
  function expandDongKey(code, dongKey) {
    var t = String(dongKey || "").split(" ");
    if (code === "gyeonggi" && t.length >= 2 && /구$/.test(t[0]) && t[0].length >= 4) t[0] = t[0].slice(0, 2) + "시 " + t[0].slice(2); // 경기의 시·구 합친 키: 시 이름은 모두 두 글자
    return t.join(" ");
  }

  // ---------- 카카오 SDK (지도 없이 검색만 쓸 때도 공용) ----------
  function getKakaoKey() { var k = ""; try { k = localStorage.getItem("imjang.kakaoKey") || ""; } catch (e) {} return String(k || KAKAO_KEY || "").trim(); }
  var kakaoPromise = null;
  function loadKakao(key) {
    key = key || getKakaoKey();
    if (kakaoPromise) return kakaoPromise;
    kakaoPromise = new Promise(function (resolve, reject) {
      if (window.kakao && window.kakao.maps && window.kakao.maps.Map) return resolve();
      if (!key) return reject("키 없음");
      var done = false, s = document.createElement("script");
      s.src = "https://dapi.kakao.com/v2/maps/sdk.js?appkey=" + encodeURIComponent(key) + "&autoload=false&libraries=services";
      s.onload = function () {
        if (window.kakao && window.kakao.maps && typeof window.kakao.maps.load === "function") {
          window.kakao.maps.load(function () { done = true; if (window.kakao.maps.Map) resolve(); else reject("키 또는 사이트 도메인 설정을 확인해 주세요"); });
        } else { done = true; reject("SDK가 초기화되지 않았습니다. 카카오맵 사용 설정과 도메인 등록을 확인해 주세요"); }
      };
      s.onerror = function () {
        done = true;
        fetch(s.src).then(function (r) { return r.text(); }).then(function (body) {
          var m = /"message"\s*:\s*"([^"]+)"/.exec(body || ""), msg = m ? m[1] : "";
          if (/domain mismatched/i.test(msg)) msg = "등록되지 않은 도메인입니다 (" + location.origin + "). 카카오 개발자 사이트 > 플랫폼 > Web 사이트 도메인에 이 주소를 등록해 주세요";
          reject(msg || "SDK 스크립트를 불러오지 못했습니다");
        }).catch(function () { reject("SDK 스크립트를 불러오지 못했습니다 (키 오류, 도메인 미등록, 또는 네트워크 차단)"); });
      };
      document.head.appendChild(s);
      setTimeout(function () { if (!done) reject("응답 시간 초과"); }, 8000);
    });
    kakaoPromise.catch(function () { kakaoPromise = null; });
    return kakaoPromise;
  }
  // 장소·주소 검색: 카카오가 되면 카카오, 아니면 OpenStreetMap(Nominatim)
  function placeSearch(q) {
    q = String(q || "").trim(); if (!q) return Promise.resolve([]);
    return loadKakao().then(function () {
      return new Promise(function (resolve) {
        new kakao.maps.services.Places().keywordSearch(q, function (data, status) {
          if (status === kakao.maps.services.Status.OK) return resolve(data.slice(0, 8).map(function (d) { return { name: d.place_name, area: shortKakaoAddr(d.address_name), lat: Number(d.y), lng: Number(d.x), detail: d.road_address_name || d.address_name, addr: parseJibunAddr(d.address_name) }; }));
          new kakao.maps.services.Geocoder().addressSearch(q, function (rows, st) {
            resolve(st === kakao.maps.services.Status.OK ? rows.slice(0, 8).map(function (d) { return { name: d.address_name, area: shortKakaoAddr(d.address_name), lat: Number(d.y), lng: Number(d.x), detail: d.road_address ? d.road_address.address_name : "", addr: parseJibunAddr(d.address_name) }; }) : []);
          });
        });
      });
    }, function () {
      return fetch("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=kr&accept-language=ko&q=" + encodeURIComponent(q)).then(function (r) { return r.json(); })
        .then(function (rows) { return rows.map(function (d) { return { name: (d.display_name || "").split(",")[0], area: shortArea(d.display_name), lat: Number(d.lat), lng: Number(d.lon), detail: d.display_name, addr: parseNominatimAddr(d.display_name) }; }); })
        .catch(function () { return []; });
    });
  }

  // ---------- 출퇴근 (두 사람의 직장 좌표) ----------
  var COMMUTE_KEY = "imjang.commute.v1";
  function defaultCommute() { return { people: [{ label: "나", name: "", lat: null, lng: null }, { label: "상대", name: "", lat: null, lng: null }] }; }
  function getCommute() { var c = lsGet(COMMUTE_KEY, null); if (!c || !c.people || c.people.length < 2) c = defaultCommute(); return c; }
  function setCommute(c) { lsSet(COMMUTE_KEY, c); }
  function haversineKm(lat1, lng1, lat2, lng2) {
    var R = 6371, toR = Math.PI / 180, dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
    var h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.pow(Math.sin(dLng / 2), 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // 직선거리 -> 대중교통 소요시간 어림값(분). 수도권 평균 체감 속도 기준, 참고용.
  function commuteMinutes(km) { return Math.round(km < 1.5 ? 10 + km * 5 : 12 + km * 3.4); }
  function kakaoRouteUrl(fromName, fromLat, fromLng, toName, toLat, toLng) {
    return "https://map.kakao.com/link/from/" + encodeURIComponent(fromName) + "," + fromLat + "," + fromLng + "/to/" + encodeURIComponent(toName) + "," + toLat + "," + toLng;
  }
  function commutePeople() { return getCommute().people.filter(function (p) { return p.lat != null && p.lng != null; }); }
  // 단지 좌표 -> [{label, km, min, url}] (직장이 설정된 사람만)
  function commuteFor(lat, lng, fromName) {
    if (lat == null || lng == null) return [];
    return commutePeople().map(function (p) {
      var km = haversineKm(lat, lng, p.lat, p.lng);
      return { label: p.label, name: p.name, km: km, min: commuteMinutes(km), url: kakaoRouteUrl(fromName || "집", lat, lng, p.name || p.label + " 직장", p.lat, p.lng) };
    });
  }
  function commuteChips(lat, lng, fromName) {
    return commuteFor(lat, lng, fromName).map(function (c) {
      var cls = c.km <= 8 ? " good" : c.km <= 15 ? "" : c.km <= 25 ? " warn" : " bad";
      return '<a class="chip commute' + cls + '" href="' + c.url + '" target="_blank" rel="noopener" title="' + esc(c.name || "") + ' · 카카오맵 길찾기 열기">' + esc(c.label) + ' ' + c.km.toFixed(1) + 'km · 약 ' + c.min + '분</a>';
    }).join("");
  }
  // 출퇴근 설정 UI. el 안에 두 사람 입력칸을 그리고, 바뀌면 onChange() 호출
  function renderCommuteSetup(el, onChange) {
    var c = getCommute();
    el.innerHTML = c.people.map(function (p, i) {
      return '<div class="commute-row" data-i="' + i + '">' +
        '<input class="who" value="' + esc(p.label) + '" aria-label="누구" maxlength="6">' +
        '<div class="search"><input class="where" autocomplete="off" placeholder="직장 이름이나 주소 (예: 판교역, 테헤란로 152)" value="' + esc(p.name) + '"><button type="button" class="btn find">찾기</button>' + (p.lat != null ? '<button type="button" class="btn ghost clear">지우기</button>' : "") + '</div>' +
        '<div class="geo-results" hidden></div><p class="hint">' + (p.lat != null ? "설정됨 · " + esc(p.name) : "아직 설정되지 않았습니다") + '</p></div>';
    }).join("");
    function save() { setCommute(c); if (onChange) onChange(c); }
    el.querySelectorAll(".commute-row").forEach(function (row) {
      var i = Number(row.dataset.i), p = c.people[i], who = row.querySelector(".who"), where = row.querySelector(".where"), box = row.querySelector(".geo-results"), hint = row.querySelector(".hint");
      who.addEventListener("change", function () { p.label = who.value.trim() || (i === 0 ? "나" : "상대"); who.value = p.label; save(); });
      function doSearch() {
        var q = where.value.trim(); if (!q) return;
        hint.textContent = "찾는 중"; box.hidden = true;
        placeSearch(q).then(function (list) {
          if (!list.length) { hint.textContent = "찾지 못했습니다. 역 이름이나 도로명 주소로 다시 적어 보세요."; return; }
          box.hidden = false; hint.textContent = "맞는 곳을 고르세요";
          box.innerHTML = list.map(function (r, k) { return '<button type="button" data-k="' + k + '"><b>' + esc(r.name) + '</b> <span class="muted small">' + esc(r.detail || r.area) + '</span></button>'; }).join("");
          box.onclick = function (ev) { var b = ev.target.closest("button[data-k]"); if (!b) return; var r = list[Number(b.dataset.k)]; p.name = r.name; p.lat = r.lat; p.lng = r.lng; save(); renderCommuteSetup(el, onChange); };
        });
      }
      row.querySelector(".find").addEventListener("click", doSearch);
      where.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doSearch(); } });
      var clr = row.querySelector(".clear"); if (clr) clr.addEventListener("click", function () { p.name = ""; p.lat = null; p.lng = null; save(); renderCommuteSetup(el, onChange); });
    });
  }

  // ---------- 용어 설명 팝오버 ----------
  // 페이지의 <dfn data-t="키">낱말</dfn> 을 누르면 짧은 설명이 뜬다. 용어 목록은 assets/terms.js
  function termify(root) {
    var T = window.JT_TERMS; if (!T) return;
    var byKey = {}; T.forEach(function (t) { byKey[t.k] = t; });
    var pop = document.getElementById("term-pop");
    if (!pop) { pop = document.createElement("div"); pop.id = "term-pop"; pop.className = "term-pop"; pop.hidden = true; pop.setAttribute("role", "dialog"); document.body.appendChild(pop); }
    function close() { pop.hidden = true; }
    function open(dfn) {
      var t = byKey[dfn.dataset.t]; if (!t) return;
      pop.innerHTML = '<div class="term-pop-head"><b>' + esc(t.t) + '</b>' + (t.full ? '<span class="muted small">' + esc(t.full) + '</span>' : "") + '</div><p>' + esc(t.d) + '</p>' + (t.eg ? '<p class="small muted">' + esc(t.eg) + '</p>' : "") + '<a class="small" href="terms.html#' + esc(t.k) + '">용어 사전에서 더 보기</a>';
      pop.hidden = false;
      var r = dfn.getBoundingClientRect(), w = Math.min(340, window.innerWidth - 24);
      var left = Math.max(12, Math.min(r.left + window.scrollX, window.scrollX + window.innerWidth - w - 12));
      pop.style.width = w + "px"; pop.style.left = left + "px"; pop.style.top = (r.bottom + window.scrollY + 8) + "px";
    }
    (root || document).querySelectorAll("dfn[data-t]").forEach(function (d) {
      if (d.dataset.ready) return; d.dataset.ready = "1";
      var t = byKey[d.dataset.t]; if (!t) return;
      d.setAttribute("tabindex", "0"); d.setAttribute("role", "button"); d.setAttribute("title", "뜻 보기: " + t.t);
      d.addEventListener("click", function (ev) { ev.stopPropagation(); if (!pop.hidden && pop.dataset.for === d.dataset.t) return close(); pop.dataset.for = d.dataset.t; open(d); });
      d.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); d.click(); } });
    });
    if (!termify.bound) { termify.bound = true; document.addEventListener("click", function (ev) { if (!pop.contains(ev.target)) close(); }); document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") close(); }); }
  }

  return { P: P, PAGES: PAGES, KAKAO_KEY: KAKAO_KEY, SIDO: SIDO, SIDO_NAME: SIDO_NAME, PRICE_AVAILABLE: PRICE_AVAILABLE,
    $: $, esc: esc, num: num, fmtEok: fmtEok, fmtMan: fmtMan, uid: uid, lsGet: lsGet, lsSet: lsSet, renderNav: renderNav,
    candidates: candidates, visits: visits, loadApt: loadApt, loadPrice: loadPrice,
    parseJibunAddr: parseJibunAddr, parseNominatimAddr: parseNominatimAddr, shortArea: shortArea, shortKakaoAddr: shortKakaoAddr, normName: normName, aptMatch: aptMatch, priceMatch: priceMatch, areaLabel: areaLabel, pyeong: pyeong,
    budget: budget, loanFor: loanFor, costsFor: costsFor, acquisitionTax: acquisitionTax, brokerFee: brokerFee, monthlyPayment: monthlyPayment, policyEligibility: policyEligibility, regionOf: regionOf, annuityFactor: annuityFactor,
    expandDongKey: expandDongKey, getKakaoKey: getKakaoKey, loadKakao: loadKakao, placeSearch: placeSearch,
    getCommute: getCommute, setCommute: setCommute, commutePeople: commutePeople, commuteFor: commuteFor, commuteChips: commuteChips, commuteMinutes: commuteMinutes, haversineKm: haversineKm, kakaoRouteUrl: kakaoRouteUrl, renderCommuteSetup: renderCommuteSetup, termify: termify };
})();
