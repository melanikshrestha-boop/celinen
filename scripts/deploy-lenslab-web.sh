#!/bin/zsh
# Publish Celinen to Cloudflare Worker lenslab-web on lenslab.dev.
# Run from anywhere: zsh ~/Projects/intelligent-image-aid/scripts/deploy-lenslab-web.sh
# Do not skip --keep-vars. Do not deploy wrangler.json until routes are patched —
# a naked deploy wipes the lenslab.dev custom domains.
set -euo pipefail
cd "$(dirname "$0")/.."
bun run build:workers
python3 - <<'PY'
import json
from pathlib import Path
p = Path(".output/server/wrangler.json")
d = json.loads(p.read_text())
d["name"] = "lenslab-web"
d["keep_vars"] = True
d["routes"] = [
    {"pattern": "lenslab.dev", "zone_name": "lenslab.dev", "custom_domain": True},
    {"pattern": "www.lenslab.dev", "zone_name": "lenslab.dev", "custom_domain": True},
]
vars = d.get("vars") if isinstance(d.get("vars"), dict) else {}
vars["LENSLAB_CULTURE_API"] = "https://lenslab.dev/api/culture"
d["vars"] = vars
d["triggers"] = {"crons": ["* * * * *"]}
p.write_text(json.dumps(d, indent=2) + "\n")
print("patched", d["name"], "keep_vars", d["keep_vars"], "routes", d["routes"], "cron", d["triggers"], "culture", vars["LENSLAB_CULTURE_API"])
PY
bunx wrangler@4.131.1 deploy --config .output/server/wrangler.json --name lenslab-web --keep-vars
echo "Live: https://lenslab.dev"
