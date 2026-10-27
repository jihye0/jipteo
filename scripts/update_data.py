"""공공데이터포털 실거래가 API로 서울·경기·인천 아파트 매매·전세를 받아
- data/history/<sido>/<시군구>.json : 단지·전용면적별 월간 기록 (계속 쌓임)
- data/price-<sido>.json, data/jeonse-<sido>.json : 최근 12개월 요약 (사이트가 읽는 파일)
- data/meta.json : 갱신 시각·기간
을 다시 만든다. 기존 price 행의 좌표·역·학교·정비사업(index 5~7)은 그대로 보존한다.

usage: DATA_GO_KR_KEY=... python scripts/update_data.py --months 2
       (처음 한 번은 --months 13 으로 1년치를 채운다)
"""
import argparse, datetime, io, json, os, re, statistics, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SALE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
RENT_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent"
SIDOS = ["seoul", "gyeonggi", "incheon"]


def load_json(path, default):
    if not os.path.exists(path):
        return default
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def norm_name(s):
    return re.sub(r"아파트|apt|단지|\s", "", re.sub(r"\(.*?\)", "", str(s or "")).lower())


def median(xs):
    return int(round(statistics.median(xs)))


def text(item, *names):
    for n in names:
        el = item.find(n)
        if el is not None and el.text is not None and el.text.strip() != "":
            return el.text.strip()
    return ""


def fetch(url, key, lawd, ym, retries=4):
    """한 시군구·한 달 전체 item 목록"""
    items, page = [], 1
    while True:
        q = "serviceKey=" + key + "&" + urllib.parse.urlencode({"LAWD_CD": lawd, "DEAL_YMD": ym, "pageNo": page, "numOfRows": 2000})
        last = None
        for attempt in range(retries):
            try:
                with urllib.request.urlopen(url + "?" + q, timeout=60) as r:
                    body = r.read()
                root = ET.fromstring(body)
                code = (root.findtext(".//resultCode") or "").strip()
                if code not in ("00", "000", ""):
                    raise RuntimeError("API " + code + " " + (root.findtext(".//resultMsg") or ""))
                break
            except Exception as e:  # 일시 오류는 잠깐 쉬고 다시
                last = e
                time.sleep(2 * (attempt + 1))
        else:
            raise RuntimeError("fetch failed %s %s %s: %s" % (url.split("/")[-1], lawd, ym, last))
        got = root.findall(".//item")
        items.extend(got)
        total = int((root.findtext(".//totalCount") or "0").strip() or 0)
        if len(items) >= total or not got:
            break
        page += 1
    return items


def months_back(n):
    today = datetime.date.today()
    y, m = today.year, today.month
    out = []
    for _ in range(n):
        out.append("%04d%02d" % (y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=2, help="이번에 다시 받을 최근 개월 수")
    ap.add_argument("--sido", default="", help="한 시도만 (테스트용)")
    ap.add_argument("--sgg", default="", help="쉼표로 나눈 시군구 이름만 (예: 화성동탄구,검단구)")
    args = ap.parse_args()
    key = os.environ.get("DATA_GO_KR_KEY", "").strip()
    if not key:
        sys.exit("DATA_GO_KR_KEY 환경변수가 없습니다")
    if "%" in key:  # Encoding 키를 넣었으면 Decoding 형태로
        key = urllib.parse.unquote(key)
    key = urllib.parse.quote(key, safe="")  # URL에 한 번만 인코딩

    codes = load_json(os.path.join(DATA, "sgg-codes.json"), {})
    yms = months_back(args.months)
    window = months_back(12)  # 사이트 요약에 쓰는 최근 12개월
    print("months:", yms, "window:", window[0], "~", window[-1])

    for sido in SIDOS:
        if args.sido and sido != args.sido:
            continue
        # 기존 price 행(좌표·역·학교·정비사업 보존용) 색인 + 누적 보관 파일(enrich-<sido>.json: 창 밖으로 나갔다 돌아와도 유지)
        old_price = load_json(os.path.join(DATA, "price-%s.json" % sido), [])
        epath = os.path.join(DATA, "enrich-%s.json" % sido)
        enrich = load_json(epath, {})
        by_key, by_sgg_jb_name, by_sgg_name = {}, {}, {}
        for r in old_price:
            by_key[r[0] + "|" + r[1]] = r
            sgg = r[0].split(" ")[0]
            by_sgg_jb_name.setdefault(sgg + "|" + r[1] + "|" + norm_name(r[2]), r)
            by_sgg_name.setdefault(sgg + "|" + norm_name(r[2]), r)
            ex = [r[5] if len(r) > 5 else None, r[6] if len(r) > 6 else None, r[7] if len(r) > 7 else None]
            if any(ex):
                enrich[r[0] + "|" + r[1]] = ex
                enrich.setdefault(sgg + "|" + r[1] + "|" + norm_name(r[2]), ex)
        save_json(epath, enrich)

        sggs = sorted((c, v[1]) for c, v in codes.items() if v[0] == sido)
        only = [x.strip() for x in args.sgg.split(",") if x.strip()]
        for lawd, sgg in sggs:
            if only and sgg not in only:
                continue
            hpath = os.path.join(DATA, "history", sido, sgg + ".json")
            hist = load_json(hpath, {})
            for ym in yms:
                sales = fetch(SALE_URL, key, lawd, ym)
                rents = fetch(RENT_URL, key, lawd, ym)
                # 이 달 기록은 새로 계산 (해제·정정 반영)
                for k in list(hist.keys()):
                    hist[k].get("m", {}).pop(ym, None)
                agg = {}

                def slot(umd, jibun, name, built):
                    jibun = jibun or ""
                    # 기존 행과 맞춰 dongKey(읍·면 포함)를 유지
                    old = by_sgg_jb_name.get(sgg + "|" + jibun + "|" + norm_name(name)) or (by_key.get(sgg + " " + umd + "|" + jibun) if umd else None)
                    if old is None and not jibun:
                        old = by_sgg_name.get(sgg + "|" + norm_name(name))
                    dong_key = old[0] if old else (sgg + " " + umd).strip()
                    k = dong_key + "|" + jibun
                    rec = agg.get(k)
                    if not rec:
                        rec = agg[k] = {"n": name, "b": built, "a": {}}
                    return rec

                for it in sales:
                    if text(it, "cdealType", "해제여부") == "O":
                        continue
                    amt = text(it, "dealAmount", "거래금액").replace(",", "")
                    area = text(it, "excluUseAr", "전용면적")
                    if not amt or not area:
                        continue
                    rec = slot(text(it, "umdNm", "법정동"), text(it, "jibun", "지번"), text(it, "aptNm", "아파트"), int(text(it, "buildYear", "건축년도") or 0))
                    a = rec["a"].setdefault(int(round(float(area))), {"s": [], "j": [], "jn": []})
                    a["s"].append(int(amt))
                for it in rents:
                    rent = text(it, "monthlyRent", "월세금액", "월세").replace(",", "") or "0"
                    if int(rent or 0) > 0:
                        continue
                    dep = text(it, "deposit", "보증금액", "보증금").replace(",", "")
                    area = text(it, "excluUseAr", "전용면적")
                    if not dep or not area or int(dep) == 0:
                        continue
                    rec = slot(text(it, "umdNm", "법정동"), text(it, "jibun", "지번"), text(it, "aptNm", "아파트"), int(text(it, "buildYear", "건축년도") or 0))
                    a = rec["a"].setdefault(int(round(float(area))), {"s": [], "j": [], "jn": []})
                    a["j"].append(int(dep))
                    if text(it, "contractType", "계약구분") == "신규":
                        a["jn"].append(int(dep))
                for k, rec in agg.items():
                    h = hist.setdefault(k, {"n": rec["n"], "b": rec["b"], "m": {}})
                    h["n"] = rec["n"] or h["n"]; h["b"] = rec["b"] or h["b"]
                    month = {}
                    for area, a in rec["a"].items():
                        js = a["jn"] or a["j"]
                        month[str(area)] = [len(a["s"]), median(a["s"]) if a["s"] else 0, min(a["s"]) if a["s"] else 0, max(a["s"]) if a["s"] else 0, len(a["j"]), median(js) if js else 0, len(a["jn"])]
                    h["m"][ym] = month
                print(sido, sgg, ym, "sales", len(sales), "rents", len(rents), flush=True)
                time.sleep(0.2)
            save_json(hpath, hist)

        # 최근 12개월 요약 다시 만들기
        price, jeonse = [], []
        for lawd, sgg in sggs:
            hist = load_json(os.path.join(DATA, "history", sido, sgg + ".json"), {})
            for k, h in hist.items():
                dong_key, jibun = k.split("|", 1)
                areas_s, areas_j = {}, {}
                for ym, month in h["m"].items():
                    if ym < window[0] or ym > window[-1]:
                        continue
                    for area, v in month.items():
                        n, med, lo, hi, nj, medj, njn = v
                        if n:
                            s = areas_s.setdefault(int(area), {"vals": [], "lo": 10 ** 9, "hi": 0, "last": ""})
                            s["vals"].extend([med] * n); s["lo"] = min(s["lo"], lo); s["hi"] = max(s["hi"], hi); s["last"] = max(s["last"], ym)
                        if nj:
                            j = areas_j.setdefault(int(area), {"vals": [], "nn": 0, "last": ""})
                            j["vals"].extend([medj] * nj); j["nn"] += njn; j["last"] = max(j["last"], ym)
                if areas_s:
                    row = [dong_key, jibun, h["n"], h["b"], [[a, len(s["vals"]), median(s["vals"]), s["lo"], s["hi"], s["last"]] for a, s in sorted(areas_s.items())]]
                    sgg_name = dong_key.split(" ")[0]
                    ex = enrich.get(k) or enrich.get(sgg_name + "|" + jibun + "|" + norm_name(h["n"])) or [None, None, None]
                    row.extend(ex[:3] if ex[2] else ex[:2])
                    price.append(row)
                if areas_j:
                    jeonse.append([dong_key, jibun, h["n"], h["b"], [[a, len(j["vals"]), median(j["vals"]), j["last"], j["nn"]] for a, j in sorted(areas_j.items())]])
        price.sort(key=lambda r: (r[0], r[2])); jeonse.sort(key=lambda r: (r[0], r[2]))
        save_json(os.path.join(DATA, "price-%s.json" % sido), price)
        save_json(os.path.join(DATA, "jeonse-%s.json" % sido), jeonse)
        print(sido, "price rows", len(price), "jeonse rows", len(jeonse), flush=True)

    meta = load_json(os.path.join(DATA, "meta.json"), {})
    meta.update({"updatedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "window": [window[0], window[-1]], "source": "국토교통부 아파트 매매·전월세 실거래가 API (data.go.kr)"})
    save_json(os.path.join(DATA, "meta.json"), meta)
    print("done")


if __name__ == "__main__":
    main()
