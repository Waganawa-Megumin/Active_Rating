#!/usr/bin/env bash
# One-shot offline end-to-end verification of the Active Rating pipeline.
# Boots wrangler dev (local D1/R2), registers targets, runs an offline scan,
# and inspects the resulting diff + rating via the read API. No network.
set -uo pipefail
cd "$(dirname "$0")/.."
export WRANGLER_SEND_METRICS=false CI=1
export INGEST_HMAC_SECRET=dev-secret-local
export ADMIN_TOKEN=dev-admin-local
export AR_INGEST_URL=http://localhost:8787/ingest

echo "== reset local D1 (schema + baseline seed) =="
( cd worker
  npx wrangler d1 execute active_rating --local --persist-to .wrangler/state --file=./schema.sql >/dev/null 2>&1
  npx wrangler d1 execute active_rating --local --persist-to .wrangler/state --file=./seed/seed.sql >/dev/null 2>&1 )

echo "== start wrangler dev =="
( cd worker && npx wrangler dev --local --persist-to .wrangler/state --port 8787 ) >/tmp/ar-wrangler.log 2>&1 &
WPID=$!
trap 'kill $WPID 2>/dev/null; pkill -f workerd 2>/dev/null' EXIT

for i in $(seq 1 60); do
  curl -s --max-time 2 http://localhost:8787/api/health >/dev/null 2>&1 && { echo "ready after ${i}s"; break; }
  sleep 1
done
if ! curl -s --max-time 2 http://localhost:8787/api/health >/dev/null 2>&1; then
  echo "WORKER FAILED TO START"; tail -30 /tmp/ar-wrangler.log; exit 1
fi

echo; echo "== /api/health =="; curl -s http://localhost:8787/api/health; echo
echo; echo "== seeded organizations =="; curl -s http://localhost:8787/api/organizations | node -e 'const d=JSON.parse(require("fs").readFileSync(0));for(const o of d)console.log(`  ${o.name} [${o.relation_type}] profile=${o.profile} active=${o.active_confirmed}`)'

echo; echo "== register targets.yaml via Admin API (idempotent upsert) =="
npm run register -w scanner -- --file ../targets.yaml --api http://localhost:8787 2>&1 | sed 's/^/  /'

echo; echo "== offline scan (fixtures -> signed /ingest -> diff) =="
npm run scan -w scanner -- --offline 2>&1 | sed 's/^/  /'

echo; echo "== resulting changes (by type) =="
curl -s 'http://localhost:8787/api/changes?limit=500' | node -e 'const d=JSON.parse(require("fs").readFileSync(0));const b={};for(const c of d)b[c.change_type]=(b[c.change_type]||0)+1;console.log("  ",JSON.stringify(b),"total",d.length)'

echo; echo "== provisional rating for ACME (org-acme) =="
curl -s http://localhost:8787/api/rating/org-acme | node -e 'const r=JSON.parse(require("fs").readFileSync(0));console.log(`  score=${r.score} grade=${r.grade} assets=${r.assets.confirmed}/${r.assets.total} csf=`,r.csf)'

echo; echo "== re-run scan (debounce: expect 0 new changes) =="
npm run scan -w scanner -- --offline 2>&1 | grep -E 'total|ok' | sed 's/^/  /'

echo; echo "== fp-rate KPI =="; curl -s http://localhost:8787/api/fp-rate; echo
echo; echo "== DONE =="
