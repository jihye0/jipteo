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
    { href: "watch.html", key: "watch", label: "관심 단지" },
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
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} if (typeof pushPrivate === "function") pushPrivate(k, v); }

  // ---------- 내비 ----------
  function renderNav(active) {
    var el = document.querySelector(".topbar-inner"); if (!el) return;
    el.innerHTML = '<a class="brand" href="index.html">집<span>터</span></a><nav class="nav" aria-label="주요 메뉴">' +
      PAGES.map(function (p) { return '<a href="' + p.href + '"' + (p.key === active ? ' aria-current="page"' : "") + '>' + p.label + '</a>'; }).join("") + '</nav><div class="auth" id="auth"></div>';
    if (window.JT_TERMS) termify(document);
    onSync(paintAuth);
    if (window.JT_FIREBASE) authInit();
  }

  // ---------- 저장소 (브라우저 localStorage) ----------
  function makeStore(lsKey) {
    var s = { items: lsGet(lsKey, []), listeners: [] };
    function emit() { s.listeners.forEach(function (fn) { fn(s.items); }); }
    s.onChange = function (fn) { s.listeners.push(fn); fn(s.items); };
    s.remote = null; // 실시간 공유가 켜지면 { set(rec), remove(id) }
    s.save = function (rec) { s.items = s.items.filter(function (r) { return r.id !== rec.id; }).concat([rec]); lsSet(lsKey, s.items); emit(); if (s.remote) { try { s.remote.set(rec); } catch (e) {} } return Promise.resolve(rec); };
    s.remove = function (id) { s.items = s.items.filter(function (r) { return r.id !== id; }); lsSet(lsKey, s.items); emit(); if (s.remote) { try { s.remote.remove(id); } catch (e) {} } return Promise.resolve(); };
    s.applyRemote = function (rec) { if (!rec || !rec.id) return; var cur = s.get(rec.id); if (cur && JSON.stringify(cur) === JSON.stringify(rec)) return; s.items = s.items.filter(function (r) { return r.id !== rec.id; }).concat([rec]); lsSet(lsKey, s.items); emit(); };
    s.removeRemote = function (id) { if (!s.get(id)) return; s.items = s.items.filter(function (r) { return r.id !== id; }); lsSet(lsKey, s.items); emit(); };
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
  function pyeong(a) { return Math.round(a / 3.3058 * 10) / 10; } // 전용 평
  function pyeongType(a) { return Math.round(a / 3.3058 / 0.75); } // 흔히 부르는 '평형'(공급면적 기준 어림, 전용률 75%)
  function areaLabel(a) { return a + "㎡ · " + pyeongType(a) + "평형 (전용 " + pyeong(a) + "평)"; }

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
  function placeSearch(q, bias) {
    q = String(q || "").trim(); if (!q) return Promise.resolve([]);
    return loadKakao().then(function () {
      return new Promise(function (resolve) {
        var opt = bias ? { location: new kakao.maps.LatLng(bias.lat, bias.lng), radius: Math.min(20000, bias.radius || 20000) } : undefined; // 카카오 반경 상한 20km
        new kakao.maps.services.Places().keywordSearch(q, function (data, status) {
          if (status === kakao.maps.services.Status.OK) return resolve(data.slice(0, 8).map(function (d) { return { name: d.place_name, area: shortKakaoAddr(d.address_name), lat: Number(d.y), lng: Number(d.x), detail: d.road_address_name || d.address_name, addr: parseJibunAddr(d.address_name) }; }));
          new kakao.maps.services.Geocoder().addressSearch(q, function (rows, st) {
            resolve(st === kakao.maps.services.Status.OK ? rows.slice(0, 8).map(function (d) { return { name: d.address_name, area: shortKakaoAddr(d.address_name), lat: Number(d.y), lng: Number(d.x), detail: d.road_address ? d.road_address.address_name : "", addr: parseJibunAddr(d.address_name) }; }) : []);
          });
        }, opt);
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
  // 사람: { label, mode: "point"|"shuttle", name, lat, lng, stops: [{ n, lat, lng }], maxWalk(m) }
  function isShuttle(p) { return p.mode === "shuttle"; }
  function personReady(p) { return isShuttle(p) ? !!(p.stops && p.stops.length) : (p.lat != null && p.lng != null); }
  function commutePeople() { return getCommute().people.filter(personReady); }
  function nearestStop(p, lat, lng) {
    var best = null;
    (p.stops || []).forEach(function (s) { var m = haversineKm(lat, lng, s.lat, s.lng) * 1000; if (!best || m < best.m) best = { n: s.n, lat: s.lat, lng: s.lng, m: Math.round(m) }; });
    return best;
  }
  // 단지 좌표 -> 사람별 출퇴근 정보. 직장 모드: 직선거리·어림 시간. 셔틀 모드: 가장 가까운 정류장까지 거리·도보 시간
  function commuteFor(lat, lng, fromName) {
    if (lat == null || lng == null) return [];
    return commutePeople().map(function (p) {
      if (isShuttle(p)) {
        var s = nearestStop(p, lat, lng), maxWalk = p.maxWalk || 1500;
        var o = { label: p.label, mode: "shuttle", stop: s.n, m: s.m, km: s.m / 1000, min: walkMin(s.m), maxWalk: maxWalk, ok: s.m <= maxWalk, url: kakaoRouteUrl(fromName || "집", lat, lng, s.n, s.lat, s.lng) };
        if (p.lat != null && p.lng != null) { o.ckm = haversineKm(lat, lng, p.lat, p.lng); o.cmin = commuteMinutes(o.ckm); o.cname = p.name; o.curl = kakaoRouteUrl(fromName || "집", lat, lng, p.name || p.label + " 직장", p.lat, p.lng); }
        return o;
      }
      var km = haversineKm(lat, lng, p.lat, p.lng);
      return { label: p.label, mode: "point", name: p.name, km: km, min: commuteMinutes(km), url: kakaoRouteUrl(fromName || "집", lat, lng, p.name || p.label + " 직장", p.lat, p.lng) };
    });
  }
  function commuteChips(lat, lng, fromName) {
    return commuteFor(lat, lng, fromName).map(function (c) {
      if (c.mode === "shuttle") {
        var cs = c.m <= 800 ? " good" : c.m <= 1500 ? "" : c.m <= 2500 ? " warn" : " bad";
        return '<a class="chip commute' + cs + '" href="' + c.url + '" target="_blank" rel="noopener" title="가장 가까운 셔틀 정류장: ' + esc(c.stop) + ' · 카카오맵 길찾기 열기">' + esc(c.label) + ' 셔틀 ' + esc(c.stop) + ' ' + (c.m > 2000 ? (c.m / 1000).toFixed(1) + 'km · 걷기엔 멀어요' : c.m + 'm · 도보 ' + c.min + '분') + '</a>' +
          (c.ckm != null ? '<a class="chip commute" href="' + c.curl + '" target="_blank" rel="noopener" title="' + esc(c.cname || "") + ' 직선거리 · 카카오맵 길찾기 열기">' + esc(c.label) + ' 회사 ' + c.ckm.toFixed(1) + 'km</a>' : "");
      }
      var cls = c.km <= 8 ? " good" : c.km <= 15 ? "" : c.km <= 25 ? " warn" : " bad";
      return '<a class="chip commute' + cls + '" href="' + c.url + '" target="_blank" rel="noopener" title="' + esc(c.name || "") + ' · 카카오맵 길찾기 열기">' + esc(c.label) + ' ' + c.km.toFixed(1) + 'km · 약 ' + c.min + '분</a>';
    }).join("");
  }
  // 정류장 이름 목록 -> 좌표 (카카오 장소 검색, 수도권 안에서만). onProgress(done, total)
  // 정류장 이름 하나로 시도할 검색어 목록 (원문 → 출구 번호 뗀 것 → 부가 설명 뗀 것 → 첫 낱말)
  function stopQueries(n) {
    var q = [], seen = {};
    function add(x) { x = String(x || "").replace(/\s+/g, " ").trim(); if (x.length >= 2 && !seen[x]) { seen[x] = 1; q.push(x); } }
    var GENERIC = /^(이마트|홈플러스|롯데마트|하나로마트|하나로클럽|힐스테이트|래미안|자이|푸르지오|더샵|아이파크|롯데캐슬|e편한세상|반도유보라|우미린|호반베르디움|호수마을|무지개마을|목동|주공|현대|삼성|한양|우성|벽산|동아|대림|쌍용|코오롱|두산|한신|신동아|극동|동부|한일|태영|삼익|진흥|금호|KT|CU|GS25|맥도날드|스타벅스|하나은행|우리은행|국민은행|기업은행|농협|우체국|주유소|교회|성당|병원|의원|약국|편의점|사거리|삼거리|오거리|입구|정문|후문|육교|정류장)$/;
    add(n);
    var aptized = n.replace(/([가-힣0-9])A(?=\s|$)/g, "$1아파트").replace(/([가-힣0-9])APT(?=\s|$)/gi, "$1아파트"); // '극동늘푸른A' -> '극동늘푸른아파트'
    add(aptized);
    var base = aptized.replace(/\(.*?\)/g, " ").replace(/\s*(전방|건너편|맞은\s?편|맞은편|옆|앞|방면|입구|후문|정문|사이|대도로변|버스정류장|택시승강장|육교\s?밑|육교|횡단보도)\s*\d*\s*[mM]?\s*$/g, "").trim();
    add(base);
    add(base.replace(/\s*\d+(\s*,\s*\d+)*\s*번\s*출구.*$/, "").trim());
    add(base.replace(/\s*\d+(\s*,\s*\d+)*\s*번\s*,?\s*\d*\s*번?\s*출구.*$/, "").trim());
    add(base.replace(/(사거리|삼거리|오거리|입구|육교)$/, "").trim());
    var toks = base.split(" ");
    if (toks.length === 2 && !GENERIC.test(toks[0]) && !GENERIC.test(toks[1])) add(toks[1] + " " + toks[0]); // '불정동 이마트' -> '이마트 불정동'
    if (toks.length >= 3) add(toks.slice(0, 2).join(" "));
    var st = /([가-힣A-Za-z0-9]+(역|초교|초등학교|중학교|고등학교|시청|구청|주민센터|터미널|공원|성당|교회|농협|우체국))/.exec(aptized);
    if (st && !GENERIC.test(st[1])) add(st[1]);
    // 마지막 보루: 앞 낱말 하나 (단, 흔한 상호·동네 이름은 금지)
    if (toks.length > 1 && !GENERIC.test(toks[0]) && toks[0].length >= 3) add(toks[0]);
    return q;
  }
  function geocodeStops(names, onProgress) {
    var out = [], miss = [], i = 0;
    function metro(list) { return list.find(function (d) { return d.addr && ["seoul", "gyeonggi", "incheon"].indexOf(d.addr.code) >= 0; }) || null; }
    function tryQueries(qs, k) {
      if (k >= qs.length) return Promise.resolve(null);
      return placeSearch(qs[k]).then(function (list) { var hit = metro(list); if (hit) return { hit: hit, q: qs[k] }; return new Promise(function (r) { setTimeout(r, 40); }).then(function () { return tryQueries(qs, k + 1); }); });
    }
    function next() {
      if (i >= names.length) return Promise.resolve({ stops: out, miss: miss });
      var n = names[i++];
      return tryQueries(stopQueries(n), 0).then(function (res) {
        if (res) out.push({ n: n, lat: res.hit.lat, lng: res.hit.lng, q: res.q !== n ? res.q : undefined }); else miss.push(n);
        if (onProgress) onProgress(i, names.length);
        return new Promise(function (r) { setTimeout(r, 40); }).then(next);
      });
    }
    return next();
  }
  // 출퇴근 설정 UI. el 안에 두 사람 입력칸을 그리고, 바뀌면 onChange() 호출
  function renderCommuteSetup(el, onChange) {
    var c = getCommute();
    el.innerHTML = c.people.map(function (p, i) {
      var sh = isShuttle(p);
      return '<div class="commute-row" data-i="' + i + '">' +
        '<input class="who" value="' + esc(p.label) + '" aria-label="누구" maxlength="6">' +
        '<div class="commute-body">' +
        '<div class="seg sm mode"><button type="button" data-m="point" aria-pressed="' + !sh + '">직장 위치</button><button type="button" data-m="shuttle" aria-pressed="' + sh + '">회사 셔틀 정류장</button></div>' +
        (sh
          ? '<textarea class="stops" rows="4" placeholder="정류장 이름을 한 줄에 하나씩 붙여 넣으세요 (예: 잠실역 6번출구)"></textarea>' +
            '<div class="search"><select class="maxwalk"><option value="800">정류장 도보 800m 이내</option><option value="1000">1km 이내</option><option value="1500">1.5km 이내 (기본)</option><option value="2000">2km 이내</option></select><button type="button" class="btn geocode">정류장 위치 찾기</button>' + (p.stops && p.stops.length ? '<button type="button" class="btn ghost clear">지우기</button>' : "") + '</div>' +
            '<p class="hint">' + (p.stops && p.stops.length ? "정류장 " + p.stops.length + "곳 저장됨 · 이 브라우저에만 저장되고 어디에도 보내지 않습니다" : "목록을 붙여 넣고 '정류장 위치 찾기'를 누르세요. 이 브라우저에만 저장됩니다") + '</p>' +
            '<details class="miss"' + (p.miss && p.miss.length ? "" : " hidden") + '><summary>' + (p.miss && p.miss.length ? "못 찾은 정류장 " + p.miss.length + "곳 보기 (이름을 고쳐 다시 붙여 넣으면 됩니다)" : "") + '</summary><p class="small muted">' + esc((p.miss || []).join(", ")) + '</p></details>' +
            '<div class="search"><input class="where" autocomplete="off" placeholder="회사 위치 (선택 · 점수에 40% 반영)" value="' + esc(p.name) + '"><button type="button" class="btn find">찾기</button>' + (p.lat != null ? '<button type="button" class="btn ghost clear-co">회사 지우기</button>' : "") + '</div>' +
            '<div class="geo-results" hidden></div><p class="hint2 small muted">' + (p.lat != null ? "회사 설정됨 · " + esc(p.name) : "회사 위치는 넣지 않아도 됩니다") + '</p>'
          : '<div class="search"><input class="where" autocomplete="off" placeholder="직장 이름이나 주소 (예: 판교역, 테헤란로 152)" value="' + esc(p.name) + '"><button type="button" class="btn find">찾기</button>' + (p.lat != null ? '<button type="button" class="btn ghost clear">지우기</button>' : "") + '</div>' +
            '<div class="geo-results" hidden></div><p class="hint">' + (p.lat != null ? "설정됨 · " + esc(p.name) : "아직 설정되지 않았습니다") + '</p>') +
        '</div></div>';
    }).join("");
    function save() { setCommute(c); if (onChange) onChange(c); }
    el.querySelectorAll(".commute-row").forEach(function (row) {
      var i = Number(row.dataset.i), p = c.people[i], who = row.querySelector(".who"), hint = row.querySelector(".hint");
      who.addEventListener("change", function () { p.label = who.value.trim() || (i === 0 ? "나" : "상대"); who.value = p.label; save(); });
      row.querySelector(".mode").addEventListener("click", function (ev) { var b = ev.target.closest("button[data-m]"); if (!b || b.dataset.m === (p.mode || "point")) return; p.mode = b.dataset.m; save(); renderCommuteSetup(el, onChange); });
      var clr = row.querySelector(".clear");
      if (clr) clr.addEventListener("click", function () { if (isShuttle(p)) { p.stops = []; } else { p.name = ""; p.lat = null; p.lng = null; } save(); renderCommuteSetup(el, onChange); });
      if (isShuttle(p)) {
        var ta = row.querySelector(".stops"), mw = row.querySelector(".maxwalk"), miss = row.querySelector(".miss");
        var cc = row.querySelector(".clear-co"); if (cc) cc.addEventListener("click", function () { p.name = ""; p.lat = null; p.lng = null; save(); renderCommuteSetup(el, onChange); });
        (function () {
          var where2 = row.querySelector(".where"), box2 = row.querySelector(".geo-results"), hint2 = row.querySelector(".hint2");
          function doSearch2() {
            var q = where2.value.trim(); if (!q) return;
            hint2.textContent = "찾는 중"; box2.hidden = true;
            placeSearch(q).then(function (list) {
              if (!list.length) { hint2.textContent = "찾지 못했습니다."; return; }
              box2.hidden = false; hint2.textContent = "맞는 곳을 고르세요";
              box2.innerHTML = list.map(function (r, k) { return '<button type="button" data-k="' + k + '"><b>' + esc(r.name) + '</b> <span class="muted small">' + esc(r.detail || r.area) + '</span></button>'; }).join("");
              box2.onclick = function (ev) { var b = ev.target.closest("button[data-k]"); if (!b) return; var r = list[Number(b.dataset.k)]; p.name = r.name; p.lat = r.lat; p.lng = r.lng; save(); renderCommuteSetup(el, onChange); };
            });
          }
          row.querySelector(".find").addEventListener("click", doSearch2);
          where2.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); doSearch2(); } });
        })();
        mw.value = String(p.maxWalk || 1500);
        mw.addEventListener("change", function () { p.maxWalk = Number(mw.value); save(); });
        row.querySelector(".geocode").addEventListener("click", function () {
          var names = ta.value.split(/\r?\n/).map(function (s) { return s.replace(/^[#■\s]+/, "").trim(); }).filter(function (s) { return s && !/^#/.test(s); });
          names = names.filter(function (s, k) { return names.indexOf(s) === k; });
          if (!names.length) { hint.textContent = "정류장 이름을 먼저 붙여 넣으세요."; return; }
          hint.textContent = "정류장 위치를 찾는 중 0/" + names.length;
          geocodeStops(names, function (d, t) { hint.textContent = "정류장 위치를 찾는 중 " + d + "/" + t; }).then(function (res) {
            p.stops = res.stops; p.miss = res.miss; save();
            hint.textContent = "정류장 " + res.stops.length + "곳 저장됨 · 못 찾음 " + res.miss.length + "곳 · 이 브라우저에만 저장됩니다";
            if (res.miss.length) { miss.hidden = false; miss.querySelector("summary").textContent = "못 찾은 정류장 " + res.miss.length + "곳 보기"; miss.querySelector("p").textContent = res.miss.join(", "); }
            ta.value = "";
            setTimeout(function () { renderCommuteSetup(el, onChange); }, 2500);
          }, function (why) { hint.textContent = "검색을 못 했습니다: " + why + " (카카오맵이 되는 사이트 주소에서 열어 주세요)"; });
        });
        return;
      }
      var where = row.querySelector(".where"), box = row.querySelector(".geo-results");
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
    });
  }

  // ---------- 단지 상세 (실거래 + 전세 + 단지 정보 + 주변 시설) ----------
  function loadJeonse(code) { return loadJson("data/jeonse-" + code + ".json"); }
  function walkMin(m) { return Math.max(1, Math.round(m / 67)); } // 보통 걸음 약 4km/h
  function ageOf(year) { return year ? (new Date().getFullYear() - year) : null; }
  // 역·학교: price 행 index 6 = [역명, 노선, 거리m, 초등학교명, 거리m] (없으면 null)
  function nearChips(near) {
    if (!near) return "";
    var out = "";
    if (near[0]) out += '<span class="chip' + (near[2] <= 500 ? " good" : near[2] <= 1000 ? "" : " warn") + '" title="' + esc(near[1] || "") + ' · 도보 약 ' + walkMin(near[2]) + '분">' + esc(near[0]) + ' ' + near[2] + 'm</span>';
    else out += '<span class="chip warn">1.5km 안에 역 없음</span>';
    if (near[3]) out += '<span class="chip' + (near[4] <= 300 ? " good" : "") + '" title="도보 약 ' + walkMin(near[4]) + '분">' + esc(near[3].replace(/^서울|초등학교$/g, "") + "초") + ' ' + near[4] + 'm</span>';
    return out;
  }
  // 가장 거래가 많은 평형의 전세가율
  function mainRatio(p, js) {
    if (!p || !js) return null;
    var best = null;
    p[4].forEach(function (a) {
      var j = js[4].find(function (x) { return x[0] === a[0]; });
      if (!j || !a[2] || !j[2]) return;
      if (!best || a[1] > best.n) best = { area: a[0], n: a[1], ratio: j[2] / a[2], sale: a[2], jeonse: j[2] };
    });
    return best;
  }
  function ratioChip(r) {
    if (!r) return "";
    var pct = Math.round(r.ratio * 100), cls = pct >= 70 ? " good" : pct >= 55 ? "" : " warn";
    return '<span class="chip' + cls + '" title="' + r.area + '㎡ 기준 · 전세 ' + fmtEok(r.jeonse) + ' ÷ 매매 ' + fmtEok(r.sale) + '">전세가율 ' + pct + '%</span>';
  }
  // 상세 HTML. p: price 행, apt: apt 행(없으면 null), js: jeonse 행(없으면 null), opts: { code, minp, maxp, lat, lng }
  function detailHtml(p, apt, js, opts) {
    opts = opts || {};
    var name = p[2], units = apt ? apt[3] : null, bld = apt ? apt[4] : null, year = p[3] || (apt ? apt[5] : 0), age = ageOf(year);
    var near = p[6] || null, pos = p[5] || null;
    var trades = p[4].reduce(function (s, a) { return s + a[1]; }, 0);
    var minp = opts.minp || 0, maxp = opts.maxp || Infinity;
    // 기본
    var kv = [];
    kv.push(["주소", esc((apt && apt[7]) ? apt[7] : "") + (apt && apt[7] ? " · " : "") + esc(p[0] + " " + p[1])]);
    kv.push(["규모", (units != null ? units.toLocaleString("ko-KR") + "세대" : "세대수 모름") + (bld != null ? " · " + bld + "개동" : "") + (units >= 1000 ? " · 대단지" : units != null && units < 300 ? " · 소규모" : "")]);
    kv.push(["준공", year ? year + "년 (" + age + "년차)" + (age >= 30 ? " · 재건축 연한 지남" : age >= 20 ? " · 구축" : age <= 7 ? " · 신축급" : "") : "모름"]);
    kv.push(["1년 거래", trades + "건" + (units ? " · 세대의 " + (trades / units * 100).toFixed(1) + "%" : "")]);
    var rd = p[7] || null;
    if (rd) kv.push(["정비사업", esc(rd[1]) + " · <b>" + esc(rd[0]) + "</b> · 구역 " + esc(rd[2]) + (rd[3] ? " · 공급 예정 " + Number(rd[3]).toLocaleString("ko-KR") + "세대" : "") + ' <span class="muted small">(국토부 전국 도시정비사업 통합 데이터, 2026-05 기준)</span>']);
    if (near) {
      kv.push(["지하철", near[0] ? esc(near[0]) + (near[1] ? " (" + esc(near[1]) + ")" : "") + " · " + near[2] + "m · 도보 약 " + walkMin(near[2]) + "분" + (near[2] <= 500 ? " · 역세권" : near[2] > 1000 ? " · 역까지 멀어 버스·마을버스 확인" : "") : "1.5km 안에 지하철역 없음"]);
      kv.push(["초등학교", near[3] ? esc(near[3]) + " · " + near[4] + "m · 도보 약 " + walkMin(near[4]) + "분" + (near[4] <= 300 ? " · 단지 바로 옆(초품아 가능성, 큰길 횡단 여부 확인)" : "") : "1km 안에 초등학교 없음"]);
    }
    // 평형 표
    var rows = p[4].map(function (a) {
      var j = js ? js[4].find(function (x) { return x[0] === a[0]; }) : null;
      var ratio = j && a[2] ? j[2] / a[2] : null, inB = a[2] >= minp && a[2] <= maxp;
      return '<tr' + (inB && opts.maxp ? ' class="inb"' : "") + '><td>' + a[0] + '㎡ <span class="muted">' + pyeongType(a[0]) + '평형 · 전용 ' + pyeong(a[0]) + '평</span></td>' +
        '<td class="n"><b>' + fmtEok(a[2], 1) + '</b></td><td class="n muted">' + fmtEok(a[3], 1) + '~' + fmtEok(a[4], 1) + '</td><td class="n">' + a[1] + '건</td>' +
        '<td class="n">' + (j ? fmtEok(j[2], 1) + ' <span class="muted small">' + j[1] + '건</span>' : "–") + '</td>' +
        '<td class="n">' + (ratio != null ? Math.round(ratio * 100) + "%" : "–") + '</td><td class="n">' + (j ? fmtEok(a[2] - j[2], 1) : "–") + '</td>' +
        '<td class="n muted">' + Math.round(a[2] / (a[0] / 3.3058)).toLocaleString("ko-KR") + '</td><td class="muted small">' + a[5].slice(0, 4) + "." + a[5].slice(4) + '</td></tr>';
    }).join("");
    var table = '<div class="tablewrap"><table class="detail-table"><thead><tr><th>전용</th><th class="n">매매 중앙값</th><th class="n">1년 범위</th><th class="n">거래</th><th class="n">전세 중앙값</th><th class="n"><dfn data-t="jeonse-ratio">전세가율</dfn></th><th class="n"><dfn data-t="gap">갭</dfn></th><th class="n">평당(만)</th><th>최근</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    // 해석
    var tips = [], mr = mainRatio(p, js);
    if (mr) { var pct = Math.round(mr.ratio * 100); tips.push(pct >= 75 ? "전세가율 " + pct + "%로 높습니다. 실제로 살려는 수요가 받쳐 주고, 전세 끼고 살 때 갭이 작은 단지입니다." : pct >= 55 ? "전세가율 " + pct + "%, 보통 수준입니다." : "전세가율 " + pct + "%로 낮습니다. 매매가에 미래 기대감(재건축·입지)이 많이 들어 있다는 뜻이라, 전세 수요만으로 값이 지탱되지는 않습니다."); }
    else if (!js) tips.push("최근 1년 전세 거래가 없어 전세가율을 계산하지 못했습니다.");
    if (rd) {
      if (/관리처분|착공|이주|철거/.test(rd[0])) tips.push("정비사업이 " + rd[0] + " 단계입니다. 곧 이주·철거가 진행되거나 이미 진행 중이라 지금 들어가 살기엔 맞지 않을 수 있고, 조합원 지위 양도 제한도 확인해야 합니다.");
      else if (/조합설립|사업시행/.test(rd[0])) tips.push("정비사업이 " + rd[0] + " 단계로 중간쯤 와 있습니다. 보통 준공까지 5~10년 더 걸리고 분담금이 생기니, 실거주하면서 기다릴 수 있는지 따져 보세요.");
      else tips.push("정비사업 초기 단계(" + rd[0] + ")입니다. 기대감이 가격에 먼저 반영되는 시기라 사업이 늦어질 때의 부담을 생각해 두세요.");
    }
    if (age >= 30) tips.push("지은 지 " + age + "년이 지나 재건축 연한을 넘겼습니다. 추진 단계(안전진단·조합 등)와 분담금 이야기를 중개사에게 꼭 물어보세요.");
    else if (age >= 20) tips.push("지은 지 " + age + "년 된 구축입니다. 배관·주차·엘리베이터 상태를 현장에서 확인하세요.");
    if (units >= 1000) tips.push("1,000세대 넘는 대단지라 거래가 잦아 시세가 투명하고 되팔기 쉬운 편입니다.");
    else if (units != null && units < 300) tips.push("300세대 미만 소규모 단지입니다. 관리비가 비싸고 매도 때 시간이 걸릴 수 있습니다.");
    if (units && trades / units < 0.01) tips.push("1년 거래가 세대수의 1% 미만으로 드뭅니다. 호가와 실거래 차이가 클 수 있으니 중개사 여러 곳에 물어보세요.");
    if (near && near[0] && near[2] <= 500) tips.push("역에서 " + near[2] + "m, 역세권입니다. 출퇴근 시간대에 직접 걸어 보고 열차 혼잡도를 확인하세요.");
    if (near && (!near[0] || near[2] > 1000)) tips.push("가까운 지하철역이 멀어 버스 환승이 필요할 수 있습니다. 출퇴근 경로를 카카오맵 길찾기로 미리 확인하세요.");
    if (opts.maxp) { var fit = p[4].filter(function (a) { return a[2] >= minp && a[2] <= maxp; }).map(function (a) { return a[0] + "㎡"; }); tips.push(fit.length ? "내 예산 안에 드는 평형: " + fit.join(", ") + " (표에서 파란 줄)" : "지금 예산으로는 들어가는 평형이 없습니다."); }
    // 링크
    var links = '<a class="btn sm" href="https://new.land.naver.com/search?sk=' + encodeURIComponent(name) + '" target="_blank" rel="noopener">네이버부동산</a>' +
      '<a class="btn sm" href="https://hogangnono.com/search?q=' + encodeURIComponent(name) + '" target="_blank" rel="noopener">호갱노노</a>' +
      (pos ? '<a class="btn sm" href="https://map.kakao.com/link/map/' + encodeURIComponent(name) + ',' + pos[0] + ',' + pos[1] + '" target="_blank" rel="noopener">카카오맵</a><a class="btn sm" href="https://map.kakao.com/link/roadview/' + pos[0] + ',' + pos[1] + '" target="_blank" rel="noopener">로드뷰</a>' : "") +
      '<a class="btn sm" href="https://www.k-apt.go.kr/" target="_blank" rel="noopener">K-apt 관리비</a>';
    var cm = pos ? commuteChips(pos[0], pos[1], name) : "";
    return '<div class="detail">' +
      (opts.score ? scoreHtml(opts.score) : "") +
      '<dl class="kv">' + kv.map(function (x) { return '<dt>' + x[0] + '</dt><dd>' + x[1] + '</dd>'; }).join("") + '</dl>' +
      (cm ? '<div class="chips">' + cm + '</div>' : "") +
      table +
      (tips.length ? '<ul class="tips">' + tips.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + '</ul>' : "") +
      '<div class="actions">' + links + '</div>' +
      '<p class="small muted">매매·전세: 국토교통부 실거래가(최근 1년, 평형별 중앙값, 전세는 신규 계약 우선). 역·학교: 카카오 장소 검색 직선거리. 해석은 일반적인 기준이며 단지마다 사정이 다릅니다.</p>' +
      '</div>';
  }
  // 한 단지의 상세를 비동기로 만든다 (후보 찾기 밖, 예: 지도 핀에서)
  function detailFor(code, dongKey, jibun, name, opts) {
    if (PRICE_AVAILABLE.indexOf(code) < 0) return Promise.resolve(null);
    return Promise.all([loadPrice(code), loadApt(code), loadJeonse(code).catch(function () { return []; })]).then(function (res) {
      var p = priceMatch(res[0], dongKey, jibun, name); if (!p) return null;
      var am = aptMatch(res[1], { code: code, dongKey: dongKey, jibun: jibun, loose: false }, name), apt = am.exact || am.list[0] || null;
      var js = priceMatch(res[2], dongKey, jibun, name);
      return detailHtml(p, apt, js, opts);
    });
  }

  // ---------- 추천 점수 (생애 첫 집·실거주·두 사람 출퇴근 기준, 100점) ----------
  function lin(v, lo, hi) { if (v == null || !isFinite(v)) return null; return Math.max(0, Math.min(1, (v - lo) / (hi - lo))); } // lo→0, hi→1
  // x: { r(price 행), units, year, redev, js, minPrice, trades, pos }, ctx: { maxp }
  function scoreRow(x, ctx) {
    var r = x.r, parts = [], total = 0, max = 0;
    function add(label, pts, maxPts, why) { if (pts == null) { parts.push({ label: label, pts: null, max: maxPts, why: why }); return; } pts = Math.round(pts * 10) / 10; parts.push({ label: label, pts: pts, max: maxPts, why: why }); total += pts; max += maxPts; }
    var people = commutePeople();
    if (people.length && x.pos) {
      var cm = commuteFor(x.pos[0], x.pos[1], r[2]);
      var fs = cm.map(function (c) { if (c.mode !== "shuttle") return 1 - lin(c.km, 5, 25); var sf = 1 - lin(c.m, 800, 2500); return c.ckm != null ? sf * 0.6 + (1 - lin(c.ckm, 5, 25)) * 0.4 : sf; });
      var meanF = fs.reduce(function (s, v) { return s + v; }, 0) / fs.length, minF = Math.min.apply(null, fs);
      var f = meanF * 0.7 + minF * 0.3;
      add("출퇴근", 30 * f, 30, cm.map(function (c) { return c.label + " " + (c.mode === "shuttle" ? "셔틀 정류장 " + (c.m > 2000 ? (c.m / 1000).toFixed(1) + "km" : c.m + "m") + "(800m 이하 만점)" + (c.ckm != null ? " + 회사 " + c.ckm.toFixed(1) + "km(5km 이하 만점, 비중 40%)" : "") : c.km.toFixed(1) + "km(5km 이하 만점)"); }).join(", "));
    } else add("출퇴근", null, 30, people.length ? "단지 좌표가 없어 계산 못 함" : "직장을 넣으면 반영됩니다");
    var near = r[6];
    if (near) {
      add("지하철", near[0] ? 15 * (1 - lin(near[2], 300, 1200)) : 0, 15, near[0] ? esc(near[0]) + " " + near[2] + "m (300m 이하 만점, 1.2km 넘으면 0)" : "1.5km 안에 역 없음");
      add("초등학교", near[3] ? 5 * (1 - lin(near[4], 300, 800)) : 0, 5, near[3] ? near[4] + "m (300m 이하 만점)" : "1km 안에 없음");
    } else { add("지하철", null, 15, "자료 없음"); add("초등학교", null, 5, "자료 없음"); }
    var mr = mainRatio(r, x.js);
    if (mr) add("전세가율", 15 * lin(mr.ratio, 0.45, 0.75), 15, Math.round(mr.ratio * 100) + "% (75% 이상 만점, 45% 이하 0 — 실수요가 받쳐 주는 정도)"); else add("전세가율", null, 15, "최근 1년 전세 거래 없음");
    if (x.units != null) add("세대수", 10 * lin(x.units, 300, 1000), 10, x.units.toLocaleString("ko-KR") + "세대 (1,000세대 이상 만점)"); else add("세대수", null, 10, "자료 없음");
    var age = ageOf(x.year);
    if (age != null) {
      var ap = age <= 10 ? 10 : age <= 20 ? 10 - (age - 10) * 0.4 : age <= 30 ? 6 - (age - 20) * 0.4 : (x.redev && /조합설립|사업시행|관리처분|착공/.test(x.redev[0]) ? 5 : 1);
      add("연식", ap, 10, age + "년차" + (age > 30 && x.redev ? ", 재건축 " + x.redev[0] + " 단계라 가점" : "") + " (10년 이하 만점)");
    } else add("연식", null, 10, "준공년도 모름");
    if (ctx.maxp && x.minPrice) { var ratio = x.minPrice / ctx.maxp; add("예산 여유", 10 * (1 - lin(ratio, 0.8, 1.0)) * 0.7 + 3, 10, "예산의 " + Math.round(ratio * 100) + "% (80% 이하면 만점, 취득세·수리비 여유)"); } else add("예산 여유", null, 10, "최대 집값을 넣으면 반영");
    if (x.units) add("거래 활발", 5 * lin(x.trades / x.units, 0.005, 0.03), 5, "1년 " + x.trades + "건, 세대의 " + (x.trades / x.units * 100).toFixed(1) + "% (3% 이상 만점)"); else add("거래 활발", null, 5, "세대수 모름");
    return { total: max ? Math.round(total / max * 100) : null, parts: parts, counted: max };
  }
  function scoreHtml(sc) {
    if (!sc || sc.total == null) return "";
    return '<div class="score-box"><div class="score-head"><b>추천 ' + sc.total + '점</b>' + (sc.counted < 100 ? '<span class="muted small"> (자료 있는 항목 ' + sc.counted + '점 만점을 100점으로 환산)</span>' : "") + '</div><ul class="score-parts">' +
      sc.parts.map(function (p) { return "<li><span>" + esc(p.label) + "</span><b>" + (p.pts == null ? "–" : p.pts + "/" + p.max) + "</b><span class=\"muted small\">" + p.why + "</span></li>"; }).join("") + "</ul></div>";
  }

  // ---------- 로그인 + 실시간 공유 (Firebase: 구글 로그인, 허용된 이메일만) ----------
  // 공용: /couple/candidates, /couple/visits (핀·임장 기록, 두 사람이 함께)
  // 개인: /users/<uid>/private/<키> (출퇴근·셔틀·예산·검색 조건, 본인 기기끼리만)
  var PRIVATE_KEYS = ["imjang.commute.v1", "imjang.budgetInputs", "imjang.budget", "imjang.findInputs2"];
  var SYNC = { status: "init", user: null, allowed: false, db: null, auth: null, error: "", listeners: [], privRef: null, pulled: false };
  function onSync(fn) { SYNC.listeners.push(fn); fn(SYNC); }
  function emitSync() { SYNC.listeners.forEach(function (fn) { try { fn(SYNC); } catch (e) {} }); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(src); }; document.head.appendChild(s); }); }
  function clean(o) { return JSON.parse(JSON.stringify(o)); }
  function isAllowed(email) { var list = window.JT_ALLOWED || []; email = String(email || "").toLowerCase(); return list.some(function (e) { return String(e).toLowerCase() === email; }); }
  function bindStore(store, path) {
    var ref = SYNC.db.ref(path);
    store.remote = { set: function (rec) { ref.child(rec.id).set(clean(rec)); }, remove: function (id) { ref.child(id).remove(); } };
    return ref.once("value").then(function (snap) {
      var remote = snap.val() || {}, byId = {};
      store.items.forEach(function (l) { byId[l.id] = l; });
      store.items.forEach(function (l) { if (!remote[l.id]) ref.child(l.id).set(clean(l)); });
      Object.keys(remote).forEach(function (id) { var r = remote[id], l = byId[id]; if (!l || (r.updatedAt || 0) > (l.updatedAt || 0)) store.applyRemote(r); else if ((l.updatedAt || 0) > (r.updatedAt || 0)) ref.child(id).set(clean(l)); });
      ref.on("child_added", function (s) { store.applyRemote(s.val()); });
      ref.on("child_changed", function (s) { store.applyRemote(s.val()); });
      ref.on("child_removed", function (s) { store.removeRemote(s.key); });
    });
  }
  // 개인 설정: 원격이 더 최근이면 받아서 적용(바뀐 게 있으면 새로고침), 그 뒤로는 저장할 때마다 올림
  function pullPrivate() {
    var stamps = lsGet("imjang.priv.t", {});
    return SYNC.privRef.once("value").then(function (snap) {
      var remote = snap.val() || {}, changed = false;
      PRIVATE_KEYS.forEach(function (k) {
        var r = remote[k.replace(/\./g, "_")];
        if (r && r.t > (stamps[k] || 0)) { try { localStorage.setItem(k, JSON.stringify(r.v)); } catch (e) {} stamps[k] = r.t; changed = true; }
        else if (!r) { var v = lsGet(k, null); if (v != null) { var t = Date.now(); SYNC.privRef.child(k.replace(/\./g, "_")).set({ v: clean(v), t: t }); stamps[k] = t; } }
      });
      lsSet("imjang.priv.t", stamps);
      SYNC.pulled = true;
      if (changed) { SYNC.status = "reloading"; emitSync(); setTimeout(function () { location.reload(); }, 300); }
    });
  }
  function pushPrivate(k, v) {
    if (!SYNC.privRef || !SYNC.pulled || PRIVATE_KEYS.indexOf(k) < 0) return;
    var t = Date.now(), stamps = lsGet("imjang.priv.t", {}); stamps[k] = t; try { localStorage.setItem("imjang.priv.t", JSON.stringify(stamps)); } catch (e) {}
    try { SYNC.privRef.child(k.replace(/\./g, "_")).set({ v: clean(v), t: t }); } catch (e) {}
  }
  function authInit() {
    if (!window.JT_FIREBASE) { SYNC.status = "noconfig"; emitSync(); return Promise.resolve(false); }
    if (SYNC.auth) return Promise.resolve(true);
    SYNC.status = "loading"; emitSync();
    var base = "https://www.gstatic.com/firebasejs/10.14.1/";
    return loadScript(base + "firebase-app-compat.js").then(function () { return Promise.all([loadScript(base + "firebase-auth-compat.js"), loadScript(base + "firebase-database-compat.js")]); }).then(function () {
      if (!firebase.apps.length) firebase.initializeApp(window.JT_FIREBASE);
      SYNC.auth = firebase.auth(); SYNC.db = firebase.database();
      SYNC.auth.onAuthStateChanged(function (user) {
        SYNC.user = user || null;
        if (!user) { SYNC.status = "out"; SYNC.allowed = false; emitSync(); return; }
        // 허용 여부는 데이터베이스 규칙이 결정한다 (이메일 목록은 Firebase 안에만 있음). 읽기가 거부되면 허용되지 않은 계정.
        SYNC.status = "connecting"; emitSync();
        SYNC.privRef = SYNC.db.ref("users/" + user.uid + "/private");
        Promise.all([bindStore(candidates, "couple/candidates"), bindStore(visits, "couple/visits"), pullPrivate()]).then(function () {
          if (SYNC.status !== "reloading") { SYNC.status = "on"; emitSync(); }
          SYNC.db.ref(".info/connected").on("value", function (s) { SYNC.connected = !!s.val(); emitSync(); });
          SYNC.allowed = true;
        }).catch(function (e) { var msg = (e && (e.code || e.message)) ? String(e.code || e.message) : String(e); if (/permission/i.test(msg)) { SYNC.status = "denied"; SYNC.allowed = false; } else { SYNC.status = "error"; SYNC.error = msg; } emitSync(); });
      });
      return true;
    }).catch(function (e) { SYNC.status = "error"; SYNC.error = (e && e.message) ? e.message : String(e); emitSync(); return false; });
  }
  function signIn() {
    return authInit().then(function () {
      var p = new firebase.auth.GoogleAuthProvider(); p.setCustomParameters({ prompt: "select_account" });
      return SYNC.auth.signInWithPopup(p).catch(function (e) { if (e && /popup|cancel/i.test(e.code || "")) return SYNC.auth.signInWithRedirect(p); throw e; });
    }).catch(function (e) { SYNC.status = "error"; SYNC.error = (e && e.message) ? e.message : String(e); emitSync(); });
  }
  function signOut() { if (!SYNC.auth) return; SYNC.auth.signOut().then(function () { location.reload(); }); }
  function authLabel(S) {
    if (S.status === "noconfig") return "";
    if (S.status === "loading" || S.status === "init") return '<span class="muted small">…</span>';
    if (S.status === "out") return '<button type="button" class="btn sm" data-auth="in">구글 로그인</button>';
    var who = S.user ? esc((S.user.displayName || S.user.email || "").split(" ")[0]) : "";
    var st = S.status === "on" ? (S.connected === false ? "연결 끊김" : "공유 중") : S.status === "connecting" || S.status === "reloading" ? "연결 중" : S.status === "denied" ? "허용되지 않은 계정" : S.status === "nolist" ? "허용 목록 없음" : S.status === "error" ? "오류" : "";
    return '<span class="auth-who" title="' + esc(S.user ? S.user.email : "") + '">' + who + ' <span class="muted small">' + st + '</span></span><button type="button" class="btn sm ghost" data-auth="out">로그아웃</button>';
  }
  function paintAuth() {
    var el = document.getElementById("auth"); if (!el) return;
    el.innerHTML = authLabel(SYNC);
    var b = el.querySelector("[data-auth=in]"); if (b) b.addEventListener("click", signIn);
    var o = el.querySelector("[data-auth=out]"); if (o) o.addEventListener("click", signOut);
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
    parseJibunAddr: parseJibunAddr, parseNominatimAddr: parseNominatimAddr, shortArea: shortArea, shortKakaoAddr: shortKakaoAddr, normName: normName, aptMatch: aptMatch, priceMatch: priceMatch, areaLabel: areaLabel, pyeong: pyeong, pyeongType: pyeongType,
    budget: budget, loanFor: loanFor, costsFor: costsFor, acquisitionTax: acquisitionTax, brokerFee: brokerFee, monthlyPayment: monthlyPayment, policyEligibility: policyEligibility, regionOf: regionOf, annuityFactor: annuityFactor,
    expandDongKey: expandDongKey, getKakaoKey: getKakaoKey, loadKakao: loadKakao, placeSearch: placeSearch,
    getCommute: getCommute, setCommute: setCommute, commutePeople: commutePeople, commuteFor: commuteFor, commuteChips: commuteChips, commuteMinutes: commuteMinutes, haversineKm: haversineKm, kakaoRouteUrl: kakaoRouteUrl, renderCommuteSetup: renderCommuteSetup, nearestStop: nearestStop, isShuttle: isShuttle, termify: termify,
    loadJeonse: loadJeonse, nearChips: nearChips, mainRatio: mainRatio, ratioChip: ratioChip, detailHtml: detailHtml, detailFor: detailFor, walkMin: walkMin, scoreRow: scoreRow, scoreHtml: scoreHtml,
    SYNC: SYNC, onSync: onSync, authInit: authInit, signIn: signIn, signOut: signOut, isAllowed: isAllowed };
})();
