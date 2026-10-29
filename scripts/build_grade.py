# -*- coding: utf-8 -*-
"""
급지(구·시별 평당 매매가 순위) 생성 → data/grade.json

- 재료: data/price-<sido>.json (최근 12개월 실거래 요약, 평형별 중앙값)
- 기준: 전용 40~140㎡ 평형의 "중앙값 ÷ 전용면적"을 거래 건수만큼(평형당 최대 30건) 모아 구·시별 중앙값 → 전용 평당가(만원/평)
- 급지 = 서울·경기·인천 구·시를 평당가 내림차순으로 줄 세운 순위. 경기는 시가 아니라 구 단위(성남 분당구, 중원구 …).
- 동 순위 = 같은 구 안에서 동(법정동)별 평당가 순위. 표본 20건 미만인 동은 순위를 매기지 않음.

출력 형식:
{ "window": [...], "count": 82,
  "sgg":  { "<sido>|<구>": [순위, 평당가, 표본수] },
  "dong": { "<sido>|<dongKey>": [구 안 순위, 평당가, 표본수, 구 안 동 개수] } }
"""
import io, json, os, statistics

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
SIDOS = ["seoul", "gyeonggi", "incheon"]
AREA_MIN, AREA_MAX, CAP = 40, 140, 30
PY = 3.3058


def load(path, default):
    try:
        with io.open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def build():
    sgg_vals, dong_vals = {}, {}
    for sido in SIDOS:
        for r in load(os.path.join(DATA, "price-%s.json" % sido), []):
            sgg = sido + "|" + r[0].split(" ")[0]
            dong = sido + "|" + r[0]
            for a in r[4]:
                area, n, med = a[0], a[1], a[2]
                if area < AREA_MIN or area > AREA_MAX or not med:
                    continue
                v = [med / area] * min(n, CAP)
                sgg_vals.setdefault(sgg, []).extend(v)
                dong_vals.setdefault(dong, []).extend(v)
    ranked = sorted(((k, statistics.median(v) * PY, len(v)) for k, v in sgg_vals.items() if len(v) >= 30), key=lambda x: -x[1])
    out = {"sgg": {}, "dong": {}}
    for i, (k, ppy, n) in enumerate(ranked, 1):
        out["sgg"][k] = [i, round(ppy), n]
    by_sgg = {}
    for k, v in dong_vals.items():
        if len(v) < 20:
            continue
        sgg = k.split(" ")[0]
        by_sgg.setdefault(sgg, []).append((k, statistics.median(v) * PY, len(v)))
    for sgg, lst in by_sgg.items():
        lst.sort(key=lambda x: -x[1])
        for i, (k, ppy, n) in enumerate(lst, 1):
            out["dong"][k] = [i, round(ppy), n, len(lst)]
    out["count"] = len(ranked)
    meta = load(os.path.join(DATA, "meta.json"), {})
    if meta.get("window"):
        out["window"] = meta["window"]
    with io.open(os.path.join(DATA, "grade.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    return out


if __name__ == "__main__":
    o = build()
    print("grade.json: 구·시", o["count"], "개, 동", len(o["dong"]), "개")
