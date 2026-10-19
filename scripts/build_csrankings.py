"""Compute CSRankings (https://csrankings.org) ranks for US institutions from its published data.

CSRankings ranks are computed in the browser from two files in its GitHub repo
(https://github.com/emeryberger/CSrankings, license CC BY-NC-ND 4.0). This script reproduces that
computation without changing it, for the default view "all areas, US, last 10 years":

- every publication row (author, dept, conference, adjustedcount, year) in the year window counts,
  except "next tier" conferences, which are off by default;
- conferences roll up into 27 top-level areas;
- a department's score is the geometric mean over the selected areas of (adjusted count + 1),
  rounded to 0.1; ranks are competition ranks (1, 1, 3, ...).

Category ranks (AI / Systems / Theory / Interdisciplinary) and per-area ranks use the same formula
with only those areas selected, which is what selecting them on csrankings.org does.

Usage:
    curl -O https://raw.githubusercontent.com/emeryberger/CSrankings/gh-pages/generated-author-info.csv
    curl -O https://raw.githubusercontent.com/emeryberger/CSrankings/gh-pages/institutions.csv
    python3 scripts/build_csrankings.py generated-author-info.csv institutions.csv [from_year to_year]

Writes data/sources/csrankings_us.json.
"""
import csv
import datetime
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

# From csrankings.js (CSRankings.parentMap / nextTier / *Areas), kept in the same order.
PARENT = {
    "aaai": "ai", "ijcai": "ai", "cvpr": "vision", "eccv": "vision", "iccv": "vision",
    "icml": "mlmining", "iclr": "mlmining", "kdd": "mlmining", "nips": "mlmining",
    "acl": "nlp", "emnlp": "nlp", "naacl": "nlp", "sigir": "inforet", "www": "inforet",
    "asplos": "arch", "isca": "arch", "micro": "arch", "hpca": "arch",
    "ccs": "sec", "oakland": "sec", "usenixsec": "sec", "ndss": "sec",
    "vldb": "mod", "sigmod": "mod", "icde": "mod", "pods": "mod", "dac": "da", "iccad": "da",
    "emsoft": "bed", "rtas": "bed", "rtss": "bed", "sc": "hpc", "hpdc": "hpc", "ics": "hpc",
    "mobicom": "mobile", "mobisys": "mobile", "sensys": "mobile", "imc": "metrics", "sigmetrics": "metrics",
    "osdi": "ops", "sosp": "ops", "eurosys": "ops", "fast": "ops", "usenixatc": "ops",
    "popl": "plan", "pldi": "plan", "oopsla": "plan", "icfp": "plan",
    "fse": "soft", "icse": "soft", "ase": "soft", "issta": "soft", "nsdi": "comm", "sigcomm": "comm",
    "siggraph": "graph", "siggraph-asia": "graph", "eurographics": "graph",
    "focs": "act", "soda": "act", "stoc": "act", "crypto": "crypt", "eurocrypt": "crypt",
    "cav": "log", "lics": "log", "ismb": "bio", "recomb": "bio", "ec": "ecom", "wine": "ecom",
    "chiconf": "chi", "ubicomp": "chi", "uist": "chi", "icra": "robotics", "iros": "robotics", "rss": "robotics",
    "vis": "visualization", "vr": "visualization", "sigcse": "csed",
}
NEXT_TIER = {"ase", "issta", "icde", "pods", "hpca", "ndss", "eurosys", "eurographics",
             "fast", "usenixatc", "icfp", "oopsla", "kdd"}
CATEGORIES = {
    "ai": ["ai", "vision", "mlmining", "nlp", "inforet"],
    "systems": ["arch", "comm", "sec", "mod", "da", "bed", "hpc", "mobile", "metrics", "ops", "plan", "soft"],
    "theory": ["act", "crypt", "log"],
    "interdisciplinary": ["bio", "graph", "csed", "ecom", "chi", "robotics", "visualization"],
}
# CSRankings.areaMap order. Floating-point sums and products follow this order on the site, and the
# order changes the last bit of some scores, which can flip their rounding to 0.1.
AREA_MAP_ORDER = [
    "ai", "aaai", "ijcai", "vision", "cvpr", "eccv", "iccv", "mlmining", "icml", "kdd", "iclr", "nips",
    "nlp", "acl", "emnlp", "naacl", "inforet", "sigir", "www", "arch", "asplos", "isca", "micro", "hpca",
    "comm", "sigcomm", "nsdi", "sec", "ccs", "oakland", "usenixsec", "ndss", "mod", "sigmod", "vldb", "icde",
    "pods", "hpc", "sc", "hpdc", "ics", "mobile", "mobicom", "mobisys", "sensys", "metrics", "imc",
    "sigmetrics", "ops", "sosp", "osdi", "fast", "usenixatc", "eurosys", "pldi", "popl", "icfp", "oopsla",
    "plan", "soft", "fse", "icse", "ase", "issta", "act", "focs", "soda", "stoc", "crypt", "crypto",
    "eurocrypt", "log", "cav", "lics", "graph", "siggraph", "siggraph-asia", "eurographics", "chi",
    "chiconf", "ubicomp", "uist", "robotics", "icra", "iros", "rss", "bio", "ismb", "recomb", "da", "dac",
    "iccad", "bed", "emsoft", "rtas", "rtss", "visualization", "vis", "vr", "ecom", "ec", "wine", "csed", "sigcse",
]
AREAS = [a for a in AREA_MAP_ORDER if a not in PARENT]  # the 27 top-level areas, in site order


def ranks(scores):
    """Competition ranks after CSRankings' rounding to 0.1; ties broken by name for ordering only."""
    # JavaScript's Math.round (halves round up), not Python's round() (halves round to even).
    rounded = {d: math.floor(10.0 * s + 0.5) / 10.0 for d, s in scores.items()}
    order = sorted(rounded, key=lambda d: (-rounded[d], d))
    out, rank, prev = {}, 0, None
    for i, d in enumerate(order):
        if rounded[d] != prev:
            rank = i + 1
            prev = rounded[d]
        out[d] = rank
    return out, rounded


def main(author_file, inst_file, from_year=None, to_year=None):
    this_year = datetime.date.today().year
    from_year = int(from_year or this_year - 10)
    to_year = int(to_year or this_year)

    with open(inst_file, encoding="utf-8") as f:
        insts = {r["institution"]: r for r in csv.DictReader(f)}
    us = {name for name, r in insts.items() if r["countryabbrv"] == "us"}

    conf_adj = defaultdict(float)     # (dept, conference) -> adjusted count, summed in file order
    faculty = defaultdict(set)        # dept -> authors with a counted publication
    with open(author_file, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            dept, conf = r["dept"], r["area"]
            if dept not in us or conf in NEXT_TIER or conf not in PARENT:
                continue
            if not (from_year <= int(r["year"]) <= to_year):
                continue
            conf_adj[(dept, conf)] += float(r["adjustedcount"])
            faculty[dept].add(r["name"])

    depts = sorted(faculty)
    # Then roll conferences up into areas in areaMap order, as buildDepartmentsIncremental does.
    adj = defaultdict(float)          # (dept, area) -> adjusted count
    for conf in AREA_MAP_ORDER:
        if conf in PARENT and conf not in NEXT_TIER:
            for d in depts:
                if (d, conf) in conf_adj:
                    adj[(d, PARENT[conf])] += conf_adj[(d, conf)]

    def geo_mean(dept, areas):
        p = 1.0
        for a in sorted(areas, key=AREAS.index):
            p *= adj.get((dept, a), 0.0) + 1.0
        return p ** (1.0 / len(areas))

    overall, overall_score = ranks({d: geo_mean(d, AREAS) for d in depts})
    # Like csrankings.org, a category only lists departments with publications in its areas.
    cat_ranks = {
        c: ranks({d: geo_mean(d, areas) for d in depts if any(adj.get((d, a), 0) > 0 for a in areas)})[0]
        for c, areas in CATEGORIES.items()
    }
    # Per-area ranks only among departments with publications in that area.
    area_ranks = {}
    for a in AREAS:
        active = {d: adj[(d, a)] + 1.0 for d in depts if adj.get((d, a), 0) > 0}
        area_ranks[a] = ranks(active)[0]

    rows = []
    for d in sorted(depts, key=lambda d: overall[d]):
        rows.append({
            "institution": d,
            "homepage": insts[d].get("homepage", ""),
            "rank": overall[d],
            "score": overall_score[d],
            "faculty": len(faculty[d]),
            "categories": {c: cat_ranks[c][d] for c in CATEGORIES if d in cat_ranks[c]},
            "areas": {a: area_ranks[a][d] for a in AREAS if d in area_ranks[a]},
        })
    out = Path(__file__).resolve().parent.parent / "data" / "sources" / "csrankings_us.json"
    out.write_text(json.dumps({
        "source": "https://csrankings.org/#/index?all&us",
        "license": "CC BY-NC-ND 4.0",
        "years": [from_year, to_year],
        "generated": datetime.date.today().isoformat(),
        "institutions": rows,
    }, indent=1), encoding="utf-8")
    print(f"{len(rows)} US institutions, {from_year}-{to_year} -> {out}", file=sys.stderr)


if __name__ == "__main__":
    main(*sys.argv[1:5])
