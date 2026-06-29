# data/ — the OSHA data spine

Everything here is produced by `osha_pipeline.py`. The app reads **`osha_trade_stats.json`**
for safety-flag context (e.g. "Roofing — 57.8% cited") and the trade-risk dashboard.

| file | what it is |
|---|---|
| `osha_pipeline.py` | the sourcing + analysis pipeline (live API **or** offline cache) |
| `osha_trade_stats.json` | per-trade stats the app consumes (generated) |
| `inspections_msa.csv` | the in-MSA construction inspections (generated) |
| `violations_msa.csv` | the joined violations for those inspections (generated) |

See `../docs/OSHA_DATA_METHODOLOGY.md` for source, method, verification, and caveats.

## Get a free DOL API key (for live refresh)

1. Register at <https://dataportal.dol.gov/registration> and complete the questionnaire.
2. Your key appears under <https://dataportal.dol.gov/api-keys> (may take a few minutes).
3. Never commit the key. Pass it via env: `export DOL_API_KEY=...`.

## Run

```bash
# live pull (fresh):
export DOL_API_KEY=xxxxxxxx
python osha_pipeline.py --live --out . --raw-out ./raw

# or recompute offline from a collected pull:
python osha_pipeline.py --from-cache /path/to/response_jsons --out .
```

> Note on the live endpoint: the table slug (`inspection` / `violation`) and field names are
> confirmed against the dataset metadata at `https://apiprod.dol.gov/v4/datasets` (no key needed).
> If a future API change renames them, adjust `INSPECTION_TABLE` / `VIOLATION_TABLE` at the top
> of `osha_pipeline.py`.

---
*Part of the public repo [L2-C2-Solution](https://github.com/raphaelribot-pursuit/L2-C2-Solution) — built by [@aislingld-pursuit](https://github.com/aislingld-pursuit) and [@raphaelribot-pursuit](https://github.com/raphaelribot-pursuit).*
