import json
import pathlib
import urllib.request

script = pathlib.Path("_figma_scripts/build_empty_hero.js").read_text(encoding="utf-8")
payload = {
    "fileKey": "L3F3rn5AKtB4n1TQ0OlTYm",
    "code": script,
    "description": "Build Empty Hero screen in Figma",
    "skillNames": "figma-use",
}
print(json.dumps(payload))
