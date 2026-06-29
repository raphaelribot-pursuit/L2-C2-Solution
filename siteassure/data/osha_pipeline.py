#!/usr/bin/env python3
"""
SiteAssure — OSHA enforcement data pipeline (the data spine).

Sources OSHA construction enforcement data ourselves, reproducibly, and produces
the trade-risk stats the app uses for safety-flag context (e.g. "Roofing — 57.8%
of inspections cited"). Two modes:

  LIVE   : pulls fresh from the DOL Open Data API (needs a free API key).
  CACHE  : recomputes from already-collected response_*.json (no key, fully offline).

The headline this reproduces (NY-Newark-Jersey City MSA, NAICS 23, 2-yr window):
  3,113 in-MSA construction inspections | 1,248 cited (40.1%) | ~$15.06M penalties.

--------------------------------------------------------------------------------
USAGE
  # recompute from the collected data (the verified pull):
  python osha_pipeline.py --from-cache ../../osha_data --out .

  # source fresh from the DOL API (register a free key first, see data/README.md):
  export DOL_API_KEY=xxxxxxxx
  python osha_pipeline.py --live --out . --raw-out ./raw

OUTPUTS (in --out)
  osha_trade_stats.json   the app reads this for per-trade flag context
  inspections_msa.csv     the in-MSA construction inspections (denominator)
  violations_msa.csv      the joined violations for those inspections
--------------------------------------------------------------------------------
"""
from __future__ import annotations
import argparse, csv, glob, json, os, sys, time, urllib.parse, urllib.request
from collections import defaultdict
from datetime import datetime, timezone

# ----------------------------------------------------------------------------- config
AGENCY            = "OSHA"
INSPECTION_TABLE  = "inspection"   # confirm exact api_url slug via /v4/datasets metadata
VIOLATION_TABLE   = "violation"
API_BASE          = "https://apiprod.dol.gov/v4/get"
DATASETS_META     = "https://apiprod.dol.gov/v4/datasets"   # no key required

NAICS_PREFIX = "23"                       # construction (236/237/238)
STATES       = ("NY", "NJ")
DATE_CUTOFF  = "2024-06-24"                # open_date strictly greater than this (2-yr window)

# Trades = 6-digit NAICS. These five are the headline categories in the deck/PRD.
TRADES = {
    "238160": "Roofing",
    "238130": "Framing",
    "238140": "Masonry",
    "237310": "Highway/Bridge",
    "236220": "Commercial Bldg",
}

# --- NY-Newark-Jersey City, NY-NJ MSA: 22 counties (10 NY + 12 NJ, zero PA, post-2023 OMB).
# OSHA data has no county field, so we classify by ZIP prefix + state, disambiguating a few
# shared-prefix edge cases by city. This is a reproducible approximation of the OMB boundary;
# expect ~3% disagreement with a hand-curated city list at the county edges (Orange NY, Warren NJ).
NY_MSA_ZIP3 = {f"{p:03d}" for p in range(100, 120)}   # 100-119: all 10 NY MSA counties
NJ_MSA_ZIP3 = {"070", "071", "072", "073", "074", "075",
               "076", "077", "078", "079", "087", "088", "089"}
# 109xx is shared by Rockland (in MSA) and Orange (out). Exclude obvious Orange County cities:
ORANGE_NY = {"MIDDLETOWN", "MONROE", "GOSHEN", "WARWICK", "CHESTER", "FLORIDA", "PINE ISLAND",
             "SLATE HILL", "NEW HAMPTON", "WASHINGTONVILLE", "WALDEN", "MAYBROOK", "CAMPBELL HALL",
             "CIRCLEVILLE", "BLOOMING GROVE", "HIGHLAND MILLS", "HIGHLAND FALLS", "CORNWALL",
             "MONTGOMERY", "PORT JERVIS", "GREENWOOD LAKE", "HARRIMAN"}
# 078xx / 088xx are shared by MSA counties and Warren (out). Exclude obvious Warren County cities:
WARREN_NJ = {"PHILLIPSBURG", "HACKETTSTOWN", "WASHINGTON", "BELVIDERE", "BLAIRSTOWN",
             "OXFORD", "ALPHA", "GREAT MEADOWS", "STEWARTSVILLE", "BROADWAY"}
# 080xx / 085xx are mostly South Jersey + Trenton/Mercer (out), but include the southern/rural
# reaches of four MSA counties: Ocean (Long Beach Island, Barnegat, Manahawkin), Monmouth
# (Allentown, Millstone), Hunterdon (Lambertville, Ringoes), Somerset/Middlesex (Skillman, Plainsboro).
NJ_080_085_MSA = {"ALLENTOWN", "BARNEGAT", "BARNEGAT LIGHT", "BEACH HAVEN", "CREAM RIDGE",
                  "HARVEY CEDARS", "JACKSON", "KINGSTON", "LAMBERTVILLE", "LITTLE EGG HARBOR TWP",
                  "LONG BEACH", "LONG BEACH TOWNSHIP", "MANAHAWKIN", "MILLSTONE TOWNSHIP",
                  "PLAINSBORO", "RINGOES", "SHIP BOTTOM", "SKILLMAN", "STAFFORD TOWNSHIP",
                  "STOCKTON", "SURF CITY"}


# ----------------------------------------------------------------------------- helpers
def zip3(z) -> str:
    z = str(z or "").strip()
    return z[:3] if len(z) >= 3 else ""


def in_msa(rec: dict) -> bool:
    """True if the inspection site falls in the 22-county NY-Newark-Jersey City MSA."""
    st = rec.get("site_state")
    z = zip3(rec.get("site_zip"))
    city = (rec.get("site_city") or "").upper().strip()
    if st == "NY":
        return z in NY_MSA_ZIP3 and not (z == "109" and city in ORANGE_NY)
    if st == "NJ":
        if z in ("080", "085"):
            return city in NJ_080_085_MSA
        return z in NJ_MSA_ZIP3 and not (z in ("078", "088") and city in WARREN_NJ)
    return False


def naics_to_trade(code) -> tuple[str, str] | tuple[None, None]:
    code = str(code or "")
    return (code, TRADES[code]) if code in TRADES else (code, None)


def passes_filter(rec: dict) -> bool:
    return (str(rec.get("naics_code", "")).startswith(NAICS_PREFIX)
            and rec.get("site_state") in STATES
            and rec.get("open_date", "")[:10] > DATE_CUTOFF)


def to_penalty(v) -> float:
    try:
        return float(v if v is not None else 0)
    except (TypeError, ValueError):
        return 0.0


# ----------------------------------------------------------------------------- live fetch
def _dol_get(endpoint: str, filter_object: dict, fields: list[str], api_key: str,
             offset: int = 0, limit: int = 1000, sort_by: str = "open_date") -> list[dict]:
    """One page from the DOL v4 data API. Format:
       https://apiprod.dol.gov/v4/get/<agency>/<endpoint>/json?limit&offset&sort&sort_by&filter_object&X-API-KEY
    """
    qs = urllib.parse.urlencode({
        "limit": limit, "offset": offset, "sort": "desc", "sort_by": sort_by,
        "fields": ",".join(fields),
        "filter_object": json.dumps(filter_object),
        "X-API-KEY": api_key,
    })
    url = f"{API_BASE}/{AGENCY}/{endpoint}/json?{qs}"
    req = urllib.request.Request(url, headers={"X-API-KEY": api_key, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        if r.status == 204:                 # 204 No Content => zero matching rows (a real zero)
            return []
        return (json.loads(r.read().decode("utf-8")) or {}).get("data", []) or []


def fetch_live(api_key: str, raw_out: str | None = None):
    """Pull inspections (paginated) + the joined violations (batched by activity_nr)."""
    insp_fields = ["activity_nr", "estab_name", "site_city", "site_state",
                   "site_zip", "naics_code", "insp_type", "open_date"]
    insp_filter = {"and": [
        {"field": "naics_code",  "operator": "like", "value": f"{NAICS_PREFIX}%"},
        {"field": "site_state",  "operator": "in",   "value": list(STATES)},
        {"field": "open_date",   "operator": "gt",   "value": DATE_CUTOFF},
    ]}
    inspections: dict[int, dict] = {}
    offset = 0
    while True:
        page = _dol_get(INSPECTION_TABLE, insp_filter, insp_fields, api_key, offset=offset)
        for r in page:
            inspections[r["activity_nr"]] = r
        print(f"  inspections offset {offset}: +{len(page)} (total {len(inspections)})")
        if len(page) < 1000:
            break
        offset += 1000
        time.sleep(0.3)

    # in-MSA subset -> the activity numbers we need violations for
    msa_ids = [a for a, r in inspections.items() if passes_filter(r) and in_msa(r)]
    print(f"  in-MSA inspections: {len(msa_ids)}")

    viol_fields = ["activity_nr", "citation_id", "standard", "viol_type",
                   "issuance_date", "current_penalty", "initial_penalty"]
    violations: list[dict] = []
    BATCH = 100
    for i in range(0, len(msa_ids), BATCH):
        chunk = msa_ids[i:i + BATCH]
        vfilter = {"and": [{"field": "activity_nr", "operator": "in", "value": chunk}]}
        rows = _dol_get(VIOLATION_TABLE, vfilter, viol_fields, api_key, sort_by="issuance_date")
        violations.extend(rows)
        print(f"  violations batch {i // BATCH + 1}: +{len(rows)}")
        time.sleep(0.3)

    if raw_out:                              # cache the raw pull so CACHE mode can reuse it
        os.makedirs(raw_out, exist_ok=True)
        json.dump({"data": list(inspections.values())}, open(f"{raw_out}/inspections_raw.json", "w"))
        json.dump({"data": violations}, open(f"{raw_out}/violations_raw.json", "w"))
    return list(inspections.values()), violations


# ----------------------------------------------------------------------------- cache load
def load_cache(cache_dir: str):
    """Read collected response_*.json (and *_raw.json), splitting inspections vs violations."""
    inspections, violations = [], []
    files = sorted(glob.glob(os.path.join(cache_dir, "response_*.json")) +
                   glob.glob(os.path.join(cache_dir, "*_raw.json")))
    for f in files:
        data = (json.load(open(f)) or {}).get("data") or []
        if not data:
            continue
        (violations if "citation_id" in data[0] else inspections).extend(data)
    return inspections, violations


# ----------------------------------------------------------------------------- analyze
def analyze(inspections: list[dict], violations: list[dict]) -> dict:
    # dedup inspections by activity_nr, apply documented filter, keep in-MSA
    uniq = {r["activity_nr"]: r for r in inspections}
    msa = {a: r for a, r in uniq.items() if passes_filter(r) and in_msa(r)}

    # dedup violations and index by inspection
    seen, by_insp = set(), defaultdict(list)
    for v in violations:
        k = (v["activity_nr"], v.get("citation_id"))
        if k in seen:
            continue
        seen.add(k)
        by_insp[v["activity_nr"]].append(v)

    cited = sum(1 for a in msa if by_insp.get(a))
    total_pen = sum(to_penalty(v.get("current_penalty")) for a in msa for v in by_insp.get(a, []))
    dates = sorted(r["open_date"][:10] for r in msa.values())

    trades = {}
    by_naics = defaultdict(list)
    for a, r in msa.items():
        by_naics[str(r.get("naics_code"))].append(a)
    for code, ids in by_naics.items():
        c = sum(1 for a in ids if by_insp.get(a))
        pen = sum(to_penalty(v.get("current_penalty")) for a in ids for v in by_insp.get(a, []))
        reps = sum(1 for a in ids for v in by_insp.get(a, []) if v.get("viol_type") == "R")
        trades[code] = {
            "name": TRADES.get(code),
            "inspections": len(ids),
            "cited": c,
            "cited_rate": round(c / len(ids), 4) if ids else 0.0,
            "total_penalty": round(pen),
            "avg_penalty_per_cited": round(pen / c) if c else 0,
            "repeat_citations": reps,
            "small_sample": len(ids) < 20,
        }

    return {
        "meta": {
            "source": "DOL Open Data API — OSHA enforcement (inspection + violation, joined on activity_nr)",
            "naics": f"{NAICS_PREFIX}x (construction)",
            "states": list(STATES),
            "msa": "New York-Newark-Jersey City, NY-NJ (22 counties, post-2023 OMB)",
            "window": [dates[0] if dates else None, dates[-1] if dates else None],
            "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "in_msa_inspections": len(msa),
            "cited": cited,
            "cited_rate": round(cited / len(msa), 4) if msa else 0.0,
            "total_penalty": round(total_pen),
            "caveat": ("Citation rate is depressed by recency: citations lag inspections by months, "
                       "so recently-opened inspections read as not-yet-cited. Mature inspections "
                       "(opened > ~1yr ago) run materially higher. Treat the rate as a floor. "
                       "Rates are event counts (% of inspections cited), not normalized by workforce."),
        },
        "trades": dict(sorted(trades.items(), key=lambda kv: -kv[1]["inspections"])),
        "_index": {"msa": msa, "by_insp": by_insp},   # internal, stripped before writing
    }


# ----------------------------------------------------------------------------- outputs
def write_outputs(out_dir: str, result: dict):
    os.makedirs(out_dir, exist_ok=True)
    idx = result.pop("_index")
    json.dump(result, open(os.path.join(out_dir, "osha_trade_stats.json"), "w"), indent=2)

    with open(os.path.join(out_dir, "inspections_msa.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["activity_nr", "estab_name", "site_city", "site_state", "site_zip",
                    "naics_code", "trade", "open_date"])
        for a, r in idx["msa"].items():
            _, trade = naics_to_trade(r.get("naics_code"))
            w.writerow([a, r.get("estab_name"), r.get("site_city"), r.get("site_state"),
                        r.get("site_zip"), r.get("naics_code"), trade or "", r.get("open_date", "")[:10]])

    with open(os.path.join(out_dir, "violations_msa.csv"), "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["activity_nr", "citation_id", "standard", "viol_type",
                    "issuance_date", "current_penalty", "initial_penalty"])
        for a in idx["msa"]:
            for v in idx["by_insp"].get(a, []):
                w.writerow([a, v.get("citation_id"), v.get("standard"), v.get("viol_type"),
                            v.get("issuance_date", "")[:10], v.get("current_penalty"),
                            v.get("initial_penalty")])


def print_summary(result: dict):
    m = result["meta"]
    print(f"\n  window {m['window'][0]} -> {m['window'][1]}")
    print(f"  in-MSA inspections : {m['in_msa_inspections']:>6}")
    print(f"  cited (>=1 viol)   : {m['cited']:>6}  ({m['cited_rate']*100:.1f}%)")
    print(f"  total penalties    : ${m['total_penalty']:>12,.0f}")
    print(f"\n  {'trade':16}{'insp':>6}{'cited':>7}{'%cited':>8}{'penalty':>13}{'avg/cited':>11}{'repeat':>8}")
    for code, t in result["trades"].items():
        if t["name"]:
            print(f"  {t['name']:16}{t['inspections']:>6}{t['cited']:>7}"
                  f"{t['cited_rate']*100:>7.1f}%${t['total_penalty']:>12,.0f}"
                  f"${t['avg_penalty_per_cited']:>10,.0f}{t['repeat_citations']:>8}")


# ----------------------------------------------------------------------------- cli
def main():
    ap = argparse.ArgumentParser(description="SiteAssure OSHA data pipeline")
    ap.add_argument("--from-cache", metavar="DIR", help="recompute from collected response_*.json")
    ap.add_argument("--live", action="store_true", help="pull fresh from the DOL API (needs DOL_API_KEY)")
    ap.add_argument("--out", default=".", help="output directory")
    ap.add_argument("--raw-out", help="(live) directory to cache the raw pull")
    args = ap.parse_args()

    if args.live:
        key = os.environ.get("DOL_API_KEY")
        if not key:
            sys.exit("error: set DOL_API_KEY (register free at https://dataportal.dol.gov/registration)")
        print("Sourcing live from the DOL OSHA Enforcement API ...")
        inspections, violations = fetch_live(key, raw_out=args.raw_out)
    elif args.from_cache:
        print(f"Recomputing from cache: {args.from_cache}")
        inspections, violations = load_cache(args.from_cache)
    else:
        ap.error("choose --from-cache DIR or --live")

    result = analyze(inspections, violations)
    write_outputs(args.out, result)
    print_summary(result)
    print(f"\nWrote osha_trade_stats.json, inspections_msa.csv, violations_msa.csv -> {args.out}/")


if __name__ == "__main__":
    main()
