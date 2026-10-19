"""Build data/colleges.js from the US News rankings spreadsheet + the IPEDS directory file.

Usage:
    python3 scripts/build_data.py US-News-National-University-Rankings-Top-150-Through-2027.xlsx HD2024.csv \
        cbsa-est2024-alldata.csv ic2023_ay.csv

HD2024.csv comes from https://nces.ed.gov/ipeds/datacenter/data/HD2024.zip and supplies
city, public/private, website and coordinates, joined on the IPEDS UNITID.

QS and THE world university ranks are read from data/sources/world_ranks.json (built by
scripts/build_world_ranks.py) and joined on IPEDS UNITID. Climate normals are read the same way from
data/sources/climate.json (built by scripts/build_climate.py).

Graduate subject rankings (US News Best Graduate Schools) are read from data/sources/grad_cs.csv
and data/sources/grad_bio.csv and joined on normalized school name + state.

Location setting and popular-city areas come from each school's metro area (IPEDS CBSA code):
- cbsa-est2024-alldata.csv (Census Bureau metro population estimates,
  https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/metro/totals/cbsa-est2024-alldata.csv)
  gives the metro name and 2024 population.
- data/sources/hubs.json lists popular cities ("hubs") as sets of metro areas (hand-curated);
  a school belongs to at most one hub.

Cost estimates come from the IPEDS institutional charges file
(https://nces.ed.gov/ipeds/datacenter/data/IC2023_AY.zip, academic year 2023-24):
- graduate tuition + required fees, in-state (TUITION6 + FEE6) and out-of-state (TUITION7 + FEE7);
- living costs = the school's off-campus (not with family) food & housing + other expenses
  (CHG7AY3 + CHG8AY3), falling back to its on-campus figures (CHG5AY3 + CHG6AY3) when a school
  reports no off-campus estimate; plus books & supplies (CHG4AY3). These are the school's
  undergraduate cost-of-attendance figures for one academic year (~9 months).
"""
import csv
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
CONTROL = {"1": "public", "2": "private", "3": "for-profit"}
ROOT = Path(__file__).resolve().parent.parent
# Biological Sciences (grad_bio.csv) is kept in data/sources but switched off for now;
# add "bio": "grad_bio.csv" back here to bring it back.
SUBJECTS = {"cs": "grad_cs.csv"}

# CSRankings institutions are matched by website domain (cs.berkeley.edu <-> berkeley.edu); these
# override that. None = no CSRankings entry for this school (e.g. "Rutgers University" in CSRankings
# is New Brunswick, not the Newark or Camden campuses).
CSR_OVERRIDES = {
    "University of Chicago": "University of Chicago",  # domain also matches TTI Chicago
    "Indiana University-Bloomington": "Indiana University",
    "Rutgers University-Newark": None,
    "Rutgers University-Camden": None,
    "CUNY-City College": None,  # CSRankings "CUNY" is CUNY as a whole
}

# "Major metro": metro area of 1M+ people AND campus in a city or large suburb (IPEDS LOCALE 11-13, 21).
# Everything else (smaller metros, or small suburbs/towns inside big metros, e.g. UC Davis, UConn Storrs)
# counts as "college town & smaller city".
MAJOR_METRO_POP = 1_000_000
METRO_LOCALES = {"11", "12", "13", "21"}

# US News grad lists name a few schools differently from the national-universities list.
# Keyed by our spreadsheet name -> name used in the grad rankings.
NAME_ALIASES = {
    "Arizona State University-Tempe": "Arizona State University",
    "Binghamton University": "Binghamton University--SUNY",
    "College of William and Mary": "William & Mary",
    "Iowa State University of Science and Technology": "Iowa State University",
    "Miami University-Oxford": "Miami University",
    "Ohio State University-Columbus": "Ohio State University",
    "Purdue University": "Purdue University--West Lafayette",
    "Stony Brook University": "Stony Brook University--SUNY",
    "University at Albany": "University at Albany--SUNY",
    "University of Alabama-Birmingham": "University of Alabama at Birmingham",
    "University of Arkansas": "University of Arkansas--Fayetteville",
    "University of Buffalo": "University at Buffalo--SUNY",
    "University of Minnesota": "University of Minnesota--Twin Cities",
    "University of Missouri-Columbia": "University of Missouri",
    "Virginia Polytechnic Institute and State University": "Virginia Tech",
}


def norm(name):
    s = name.lower().replace("&", " and ").replace("--", "-").replace("\u2014", "-")
    s = re.sub(r"\bsaint\b", "st", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"^the ", "", s.strip())


def read_subject(path):
    """{(normalized name, state): {"rank": int, "tied": bool}} for numerically ranked schools."""
    out = {}
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["rank"].isdigit():
                out[(norm(r["name"]), r["state"])] = {"rank": int(r["rank"]), "tied": r["tied"] == "True"}
    return out


def read_xlsx(path):
    """Read the first sheet of an .xlsx into a list of rows (stdlib only)."""
    with zipfile.ZipFile(path) as z:
        strings = [
            "".join(t.text or "" for t in si.iter(NS + "t"))
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(NS + "si")
        ]
        sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for r in sheet.iter(NS + "row"):
        row = {}
        for c in r.findall(NS + "c"):
            v = c.find(NS + "v")
            val = "" if v is None else v.text
            if c.get("t") == "s":
                val = strings[int(val)]
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group():
                col = col * 26 + ord(ch) - 64
            row[col - 1] = val
        rows.append([row.get(i, "") for i in range(max(row) + 1)] if row else [])
    return rows


def domain(url):
    """Registrable-ish domain: 'https://www.cs.cmu.edu/' -> 'cmu.edu'."""
    url = url.strip()
    if not url:
        return ""
    host = re.sub(r"^[a-z]+://", "", url.lower()).split("/")[0].split(":")[0]
    return ".".join(host.split(".")[-2:])


def read_csrankings():
    data = json.loads((ROOT / "data" / "sources" / "csrankings_us.json").read_text(encoding="utf-8"))
    by_name = {r["institution"]: r for r in data["institutions"]}
    by_domain = {}
    for r in data["institutions"]:
        by_domain.setdefault(domain(r["homepage"]), []).append(r)
    return data, by_name, by_domain


COST_YEAR = "2023-24"


def read_costs(path):
    """{UNITID: cost dict} from the IPEDS IC_AY file; see module docstring for the fields used."""
    def num(v):
        v = (v or "").strip()
        return int(v) if v.isdigit() else None

    out = {}
    with open(path, encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            off = (num(r["CHG7AY3"]), num(r["CHG8AY3"]))
            on = (num(r["CHG5AY3"]), num(r["CHG6AY3"]))
            if None not in off:
                living, basis = sum(off), "off"
            elif None not in on:
                living, basis = sum(on), "on"
            else:
                living, basis = None, None
            tin, fin, tout, fout = (num(r[k]) for k in ("TUITION6", "FEE6", "TUITION7", "FEE7"))
            out[r["UNITID"]] = {
                "tuitionIn": tin + (fin or 0) if tin is not None else None,
                "tuitionOut": tout + (fout or 0) if tout is not None else None,
                "living": living,
                "livingBasis": basis,
                "books": num(r["CHG4AY3"]),
            }
    return out


def read_metros(path):
    """{CBSA code: (name, 2024 population)} for metro/micro areas (not divisions or counties)."""
    with open(path, encoding="latin-1") as f:
        return {r["CBSA"]: (r["NAME"], int(r["POPESTIMATE2024"]))
                for r in csv.DictReader(f) if not r["MDIV"] and not r["STCOU"]}


def main(xlsx_path, hd_path, cbsa_path, ic_path):
    rows = read_xlsx(xlsx_path)
    header = rows[0]
    years = [h for h in header if h.isdigit()]
    with open(hd_path, encoding="utf-8-sig") as f:
        ipeds = {r["UNITID"]: r for r in csv.DictReader(f)}

    subjects = {k: read_subject(ROOT / "data" / "sources" / f) for k, f in SUBJECTS.items()}
    metros = read_metros(cbsa_path)
    costs = read_costs(ic_path)
    csr_data, csr_by_name, csr_by_domain = read_csrankings()
    hubs = json.loads((ROOT / "data" / "sources" / "hubs.json").read_text(encoding="utf-8"))
    world = json.loads((ROOT / "data" / "sources" / "world_ranks.json").read_text(encoding="utf-8"))
    climate = json.loads((ROOT / "data" / "sources" / "climate.json").read_text(encoding="utf-8"))
    hub_of = {code: hub["id"] for hub in hubs for code in hub["cbsa"]}

    colleges = []
    for row in rows[1:]:
        rec = dict(zip(header, row + [""] * (len(header) - len(row))))
        h = ipeds.get(rec["IPEDS"])
        if not h:
            print(f"skip (not in IPEDS): {rec['University Name']}", file=sys.stderr)
            continue
        url = h["WEBADDR"].strip()
        if url and not url.startswith("http"):
            url = "https://" + url
        colleges.append({
            "name": rec["University Name"],
            "city": h["CITY"],
            "state": h["STABBR"],  # spreadsheet has typos (e.g. "MZ"), IPEDS is authoritative
            "control": CONTROL.get(h["CONTROL"], "other"),
            "url": url,
            "lat": round(float(h["LATITUDE"]), 4),
            "lon": round(float(h["LONGITUD"]), 4),
            "ipeds": rec["IPEDS"],
            # Non-numeric cells (e.g. a stray "flo") are treated as unranked.
            "ranks": {y: int(rec[y]) for y in years if rec[y].isdigit()},
        })
        metro_name, metro_pop = metros.get(h["CBSA"], ("", 0))
        colleges[-1].update({
            "metro": metro_name,
            "metroPop": metro_pop,
            "setting": "metro" if metro_pop >= MAJOR_METRO_POP and h["LOCALE"] in METRO_LOCALES else "town",
            "hub": hub_of.get(h["CBSA"]),
        })
        if rec["IPEDS"] in world["schools"]:
            colleges[-1]["world"] = world["schools"][rec["IPEDS"]]
        if rec["IPEDS"] in climate["schools"]:
            colleges[-1]["climate"] = climate["schools"][rec["IPEDS"]]
        if rec["IPEDS"] in costs:
            colleges[-1]["cost"] = costs[rec["IPEDS"]]
        name = rec["University Name"]
        if name in CSR_OVERRIDES:
            csr = csr_by_name[CSR_OVERRIDES[name]] if CSR_OVERRIDES[name] else None
        else:
            cands = csr_by_domain.get(domain(h["WEBADDR"]), [])
            csr = cands[0] if len(cands) == 1 else None
        if csr:
            colleges[-1]["csr"] = {"rank": csr["rank"], "faculty": csr["faculty"],
                                   "cat": csr["categories"], "areas": csr["areas"]}
        key = (norm(NAME_ALIASES.get(rec["University Name"], rec["University Name"])), h["STABBR"])
        for subj, table in subjects.items():
            if key in table:
                colleges[-1][subj] = table[key]

    for subj in subjects:
        print(f"{subj}: matched {sum(subj in c for c in colleges)} schools", file=sys.stderr)
    print(f"costs: {sum('cost' in c for c in colleges)} schools, "
          f"living on-campus fallback: {[c['name'] for c in colleges if c.get('cost', {}).get('livingBasis') == 'on']}",
          file=sys.stderr)
    for system in world["editions"]:
        print(f"{system}: {sum(system in c.get('world', {}) for c in colleges)} schools", file=sys.stderr)
    print(f"climate: {sum('climate' in c for c in colleges)} schools", file=sys.stderr)
    print(f"csrankings: matched {sum('csr' in c for c in colleges)} schools", file=sys.stderr)
    print(f"no metro: {[c['name'] for c in colleges if not c['metro']]}", file=sys.stderr)
    print(f"major metro: {sum(c['setting'] == 'metro' for c in colleges)}, "
          f"in a popular city: {sum(bool(c['hub']) for c in colleges)}", file=sys.stderr)
    hubs_out = [{"id": hub["id"], "en": hub["en"], "zh": hub["zh"]} for hub in hubs]

    out = ROOT / "data" / "colleges.js"
    out.parent.mkdir(exist_ok=True)
    out.write_text(
        "// Generated by scripts/build_data.py — do not edit by hand.\n"
        f"window.RANK_YEARS = {json.dumps(years)};\n"
        f"window.HUBS = {json.dumps(hubs_out, ensure_ascii=False)};\n"
        f"window.COST_YEAR = {json.dumps(COST_YEAR)};\n"
        f"window.WORLD_EDITIONS = {json.dumps(world['editions'])};\n"
        f"window.CLIMATE_PERIOD = {json.dumps(climate['period'])};\n"
        f"window.CSR_META = {json.dumps({k: csr_data[k] for k in ('source', 'license', 'years', 'generated')})};\n"
        # Compact: this file is loaded on every page, so whitespace is wasted bytes.
        f"window.COLLEGES = {json.dumps(colleges, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8",
    )
    print(f"wrote {len(colleges)} colleges to {out}", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:5])
