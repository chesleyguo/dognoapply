"""Build data/sources/world_ranks.json: QS and THE world university ranks for the schools on the site.

Usage (from the repository root, with the source CSVs in it):
    python3 scripts/build_world_ranks.py US-News-National-University-Rankings-Top-150-Through-2027.xlsx

Sources (one row per university per edition; only U.S. rows are used):
- QS World University Rankings 2017-2022: qs-world-university-rankings-2017-to-2022-V2.csv
- QS 2023-2026: "2023 QS World University Rankings.csv", "2024 QS World University Rankings 1.1 (For qs.com).csv",
  "QS World University Rankings 2025 (Top global universities).csv", "2026 QS World University Rankings.csv"
- THE World University Rankings 2016-2026: "THE World University Rankings 2016-2026.csv"

Ranks are kept as published: an int for an exact rank, or a band string such as "601–650" or "1401+".
Two sources need fixing up:
- The QS 2023 file numbers its unscored rows (501 and below) by row position, not by their published band.
  Those ranks are taken from the "2023 RANK" column of the QS 2024 file instead.
- The THE file numbers every row 1..N by score. THE publishes exact ranks only for the top 200 and bands below
  that, so ranks past 200 are put back into THE's bands (THE_BANDS).

Schools are matched by normalized name (see norm) to the national-universities spreadsheet, then keyed by
IPEDS ID. Names the two lists spell differently go in ALIASES.
"""
import csv
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_data import read_xlsx  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent

# Normalized source name -> our spreadsheet name.
ALIASES = {
    "arizona state university": "Arizona State University-Tempe",
    "binghamton university": "Binghamton University",
    "city college of new york": "CUNY-City College",
    "colorado state university fort collins": "Colorado State University",
    "indiana university": "Indiana University-Bloomington",
    "indiana university bloomington": "Indiana University-Bloomington",
    "iowa state university": "Iowa State University of Science and Technology",
    "louisiana state university": "Louisiana State University-Baton Rouge",
    "miami university": "Miami University-Oxford",
    "new school new york city and paris": "The New School",
    "northeastern university us": "Northeastern University",
    "purdue university west lafayette": "Purdue University",
    "university of arkansas fayetteville": "University of Arkansas",
    "university of cincinnati uptown": "University of Cincinnati",
    "university of pittsburgh pittsburgh campus": "University of Pittsburgh",
    "university of south carolina columbia": "University of South Carolina",
    "virginia polytechnic institute": "Virginia Polytechnic Institute and State University",
    "mizzou university of missouri": "University of Missouri-Columbia",
    "university of missouri": "University of Missouri-Columbia",
    "university of missouri columbia": "University of Missouri-Columbia",
    "ohio state university": "Ohio State University-Columbus",
    "penn state": "Pennsylvania State University-University Park",
    "pennsylvania state university": "Pennsylvania State University-University Park",
    "rutgers university": "Rutgers University-New Brunswick",
    "rutgers state university of new jersey": "Rutgers University-New Brunswick",
    "rutgers state university of new jersey camden": "Rutgers University-Camden",
    "texas a and m university": "Texas A&M University-College Station",
    "university buffalo": "University of Buffalo",
    "university of buffalo": "University of Buffalo",
    "university albany": "University at Albany",
    "university of massachusetts": "University of Massachusetts-Amherst",  # THE's profile is the Amherst campus
    "university of michigan": "University of Michigan-Ann Arbor",
    "university of minnesota twin cities": "University of Minnesota",
    "university of tennessee": "University of Tennessee-Knoxville",
    "william and mary": "College of William and Mary",
}

# THE bands below the top 200 (the same in every edition since 2016).
THE_BANDS = [(201, 250), (251, 300), (301, 350), (351, 400), (401, 500), (501, 600), (601, 800),
             (801, 1000), (1001, 1200), (1201, 1500)]


def norm(name):
    """'The University of Texas at Austin' -> 'university of texas austin'; drops '(MIT)', 'SUNY', etc."""
    s = name.lower().replace("&", " and ").replace("’", "'")
    s = re.sub(r"\(.*?\)", " ", s)
    s = s.replace("state university of new york", " ")
    s = re.sub(r"\bsaint\b", "st", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\b(the|at|suny|cuny)\b", " ", s)
    return " ".join(s.split())


def rank(v):
    """'12' / '=12' / '12.0' -> 12; '601-650' -> '601–650'; '1401+' stays; '' -> None."""
    v = v.strip().lstrip("=").replace("-", "–")
    if not v or v == "–":
        return None
    if re.fullmatch(r"\d+(\.0)?", v):
        return int(float(v))
    return v


def the_band(n):
    if n <= 200:
        return n
    for lo, hi in THE_BANDS:
        if n <= hi:
            return f"{lo}–{hi}"
    return "1501+"


def read(name):
    path = ROOT / name
    for enc in ("utf-8-sig", "cp1252"):
        try:
            with open(path, encoding=enc) as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    raise ValueError(f"cannot decode {path}")


def qs_rows():
    """Yield (edition, name, rank) for U.S. rows of every QS file."""
    for r in read("qs-world-university-rankings-2017-to-2022-V2.csv"):
        if r["country"] == "United States":
            yield r["year"], r["university"], rank(r["rank_display"])
    qs24 = [r for r in read("2024 QS World University Rankings 1.1 (For qs.com).csv")
            if r["Country Code"] == "US"]
    rank23 = {norm(r["Institution Name"]): rank(r["2023 RANK"]) for r in qs24}
    for r in read("2023 QS World University Rankings.csv"):
        if r["location code"].strip() == "US":
            # Rows past 500 have no score and a made-up rank; use the published one from the 2024 file.
            scored = r["score scaled"].strip() not in ("", "-")
            yield "2023", r["institution"], rank(r["Rank"]) if scored else rank23.get(norm(r["institution"]))
    for r in qs24:
        yield "2024", r["Institution Name"], rank(r["2024 RANK"])
    for r in read("QS World University Rankings 2025 (Top global universities).csv"):
        if r["Location"] == "United States":
            yield "2025", r["Institution_Name"], rank(r["RANK_2025"])
    for r in read("2026 QS World University Rankings.csv"):
        if r["Country/Territory"] == "United States of America":
            yield "2026", r["Institution Name"], rank(r["2026 Rank"])


def the_rows():
    for r in read("THE World University Rankings 2016-2026.csv"):
        if r["Country"] == "United States":
            n = rank(r["Rank"])
            yield r["Year"], r["Name"], the_band(n) if isinstance(n, int) else n


def main(xlsx_path):
    rows = read_xlsx(xlsx_path)
    header = rows[0]
    schools = [dict(zip(header, r)) for r in rows[1:] if r]
    ours = {norm(s["University Name"]): s["IPEDS"] for s in schools}
    by_name = {s["University Name"]: s["IPEDS"] for s in schools}
    names = {s["IPEDS"]: s["University Name"] for s in schools}

    out, unmatched, editions = {}, {}, {"qs": set(), "the": set()}
    for system, source in (("qs", qs_rows()), ("the", the_rows())):
        for year, name, r in source:
            if r is None:
                continue
            editions[system].add(year)
            key = norm(name)
            ipeds = by_name[ALIASES[key]] if key in ALIASES else ours.get(key)
            if not ipeds:
                unmatched.setdefault(name.strip(), set()).add(f"{system} {year}")
                continue
            ranks = out.setdefault(ipeds, {}).setdefault(system, {})
            if year in ranks and ranks[year] != r:
                print(f"conflict: {names[ipeds]} {system} {year}: {ranks[year]} vs {r} ({name})", file=sys.stderr)
            ranks.setdefault(year, r)

    for system in ("qs", "the"):
        n = sum(system in v for v in out.values())
        print(f"{system}: {n} of {len(schools)} schools ranked in at least one edition", file=sys.stderr)
    print(f"never ranked: {sorted(names[i] for i in names if i not in out)}", file=sys.stderr)
    print(f"{len(unmatched)} U.S. source names not on the site (not in our list)", file=sys.stderr)
    if "-v" in sys.argv:
        for name in sorted(unmatched):
            print(f"  {name}: {', '.join(sorted(unmatched[name]))}", file=sys.stderr)

    dest = ROOT / "data" / "sources" / "world_ranks.json"
    dest.write_text(json.dumps({
        "editions": {k: sorted(v, reverse=True) for k, v in editions.items()},
        "schools": {k: {s: dict(sorted(v.items(), reverse=True)) for s, v in out[k].items()} for k in sorted(out)},
    }, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {dest}", file=sys.stderr)


if __name__ == "__main__":
    main(sys.argv[1])
