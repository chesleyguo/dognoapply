"""Build data/sources/climate.json: climate normals for each school's campus.

Usage:
    curl -O https://www.ncei.noaa.gov/data/normals-monthly/1991-2020/archive/us-climate-normals_1991-2020_v1.0.1_monthly_multivariate_by-station_c20230404.tar.gz
    python3 scripts/build_climate.py US-News-National-University-Rankings-Top-150-Through-2027.xlsx HD2024.csv \
        us-climate-normals_1991-2020_v1.0.1_monthly_multivariate_by-station_c20230404.tar.gz

Source: NOAA NCEI U.S. Climate Normals 1991-2020, monthly, one CSV per station (read straight from the archive).
Each campus (IPEDS coordinates) gets the nearest station that has complete monthly temperature and
precipitation normals; snowfall and rainy days each come from the nearest station that reports them,
which may be a different one.

Output per IPEDS ID, in NOAA's own units (°F, inches):
    hi / lo  monthly normal daily high / low, Jan..Dec (whole °F)
    prcp     annual precipitation (in)
    wet      days a year with 0.01 in or more of precipitation (None if no station near enough reports it)
    snow     annual snowfall (in; None if no snowfall station is near enough)
    koppen   Köppen-Geiger climate type, computed from the monthly normals (see koppen())
    station, km    the temperature station and its distance from campus
"""
import csv
import io
import json
import math
import sys
import tarfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import read_xlsx  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MAX_KM = 60  # farther than this and a station no longer says much about the campus


def num(v):
    v = (v or "").strip()
    try:
        x = float(v)
    except ValueError:
        return None
    return None if x <= -666 else x  # NOAA uses -9999 / -7777 style sentinels


def months(rows, col):
    vals = [num(r.get(col)) for r in rows]
    return vals if len(vals) == 12 and None not in vals else None


def read_stations(tar_path):
    temp, snow, wet = [], [], []
    with tarfile.open(tar_path) as tar:
        for m in tar:
            if not m.name.endswith(".csv"):
                continue
            rows = list(csv.DictReader(io.TextIOWrapper(tar.extractfile(m), encoding="utf-8")))
            if len(rows) != 12:
                continue
            rows.sort(key=lambda r: int(r["month"]))
            lat, lon = num(rows[0]["LATITUDE"]), num(rows[0]["LONGITUDE"])
            if lat is None or lon is None:
                continue
            name = rows[0]["NAME"].strip().removesuffix(" US").strip()
            hi, lo, pr = (months(rows, f"MLY-{v}-NORMAL") for v in ("TMAX", "TMIN", "PRCP"))
            if hi and lo and pr:
                temp.append({"lat": lat, "lon": lon, "name": name, "hi": hi, "lo": lo, "pr": pr})
            sn = months(rows, "MLY-SNOW-NORMAL")
            if sn:
                snow.append({"lat": lat, "lon": lon, "v": sum(sn)})
            wd = months(rows, "MLY-PRCP-AVGNDS-GE001HI")
            if wd:
                wet.append({"lat": lat, "lon": lon, "v": sum(wd)})
    return temp, snow, wet


def km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(a))


def nearest(stations, lat, lon):
    best = min(stations, key=lambda s: km(lat, lon, s["lat"], s["lon"]))
    return best, km(lat, lon, best["lat"], best["lon"])


def koppen(hi, lo, pr):
    """Köppen-Geiger type from monthly normals (Beck et al. 2018 rules; northern hemisphere).

    Uses 0 °C as the C/D boundary (coldest month), the usual convention for North America.
    """
    t = [((h + l) / 2 - 32) * 5 / 9 for h, l in zip(hi, lo)]  # monthly mean, °C
    p = [x * 25.4 for x in pr]  # mm
    mat, map_ = sum(t) / 12, sum(p)
    tcold, thot = min(t), max(t)
    summer, winter = p[3:9], p[:3] + p[9:]  # Apr-Sep / Oct-Mar
    ps, pw = sum(summer), sum(winter)
    if thot < 10:
        return "ET" if thot > 0 else "EF"
    pth = 2 * mat + (0 if pw >= 0.7 * map_ else 28 if ps >= 0.7 * map_ else 14)
    if map_ < 10 * pth:
        return ("BW" if map_ < 5 * pth else "BS") + ("h" if mat >= 18 else "k")
    if tcold >= 18:
        pdry = min(p)
        return "Af" if pdry >= 60 else "Am" if pdry >= 100 - map_ / 25 else "Aw"
    second = ("s" if min(summer) < 40 and min(summer) < max(winter) / 3
              else "w" if min(winter) < max(summer) / 10 else "f")
    warm = sum(x >= 10 for x in t)
    third = "a" if thot >= 22 else "b" if warm >= 4 else "d" if tcold < -38 else "c"
    return ("C" if tcold > 0 else "D") + second + third


def main(xlsx_path, hd_path, tar_path):
    rows = read_xlsx(xlsx_path)
    header = rows[0]
    schools = [dict(zip(header, r)) for r in rows[1:] if r]
    with open(hd_path, encoding="utf-8-sig") as f:
        ipeds = {r["UNITID"]: r for r in csv.DictReader(f)}
    temp, snow, wet = read_stations(tar_path)
    print(f"stations: {len(temp)} with temperature + precipitation, {len(snow)} with snowfall, "
          f"{len(wet)} with rainy days", file=sys.stderr)

    def near_value(stations, lat, lon, digits):
        st, d = nearest(stations, lat, lon)
        return round(st["v"], digits) if d <= MAX_KM else None

    out, far = {}, []
    for s in schools:
        h = ipeds.get(s["IPEDS"])
        if not h:
            continue
        lat, lon = float(h["LATITUDE"]), float(h["LONGITUD"])
        st, d = nearest(temp, lat, lon)
        if d > MAX_KM:
            far.append(f"{s['University Name']} ({d:.0f} km)")
            continue
        out[s["IPEDS"]] = {
            "koppen": koppen(st["hi"], st["lo"], st["pr"]),
            "hi": [round(x) for x in st["hi"]],
            "lo": [round(x) for x in st["lo"]],
            "prcp": round(sum(st["pr"]), 1),
            "wet": near_value(wet, lat, lon, None),
            "snow": near_value(snow, lat, lon, 1),
            "station": st["name"],
            "km": round(d, 1),
        }
    for k in ("wet", "snow"):
        print(f"{k}: missing for {[s['University Name'] for s in schools if s['IPEDS'] in out and out[s['IPEDS']][k] is None]}", file=sys.stderr)
    if far:
        print(f"no station within {MAX_KM} km: {far}", file=sys.stderr)
    dists = sorted(v["km"] for v in out.values())
    print(f"{len(out)} schools; station distance median {dists[len(dists) // 2]} km, max {dists[-1]} km", file=sys.stderr)
    types = {}
    for v in out.values():
        types[v["koppen"]] = types.get(v["koppen"], 0) + 1
    print(f"Köppen types: {dict(sorted(types.items()))}", file=sys.stderr)

    dest = ROOT / "data" / "sources" / "climate.json"
    dest.write_text(json.dumps({
        "source": "NOAA NCEI U.S. Climate Normals 1991-2020 (monthly)",
        "period": "1991-2020",
        "schools": dict(sorted(out.items())),
    }, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {dest}", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:4])
