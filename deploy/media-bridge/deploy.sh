#!/usr/bin/env bash
# Deploys deploy/media-bridge/worker.js to the existing Cloudflare Worker via the API.
# Uses PUT /content, which replaces code only: bindings, secrets, variables and settings are not modified.
set -uo pipefail
: "${CF_TOKEN:?missing}"; SCRIPT_NAME="${SCRIPT_NAME:-media-bridge}"; EXPECT_VERSION="${EXPECT_VERSION:-2.2.0}"
CF_API="${CF_API:-https://api.cloudflare.com/client/v4}"; SRC="${SRC:-deploy/media-bridge/worker.js}"
W="$(mktemp -d)"
fail() { echo "::error title=$1::$2"; exit 1; }
notice() { echo "::notice title=$1::$2"; }
cf() { # method path [extra curl args]
  local out="$W/resp.json" code
  code=$(curl -sS -o "$out" -w '%{http_code}' -X "$1" -H "Authorization: Bearer $CF_TOKEN" "${@:3}" "$CF_API$2") \
    || fail "curl failed" "$2"
  if [ "$code" -ge 400 ]; then fail "Cloudflare API HTTP $code" "$2 -> $(jq -c '.errors // .' "$out" 2>/dev/null | head -c 600)"; fi
  cat "$out"
}

grep -q "const VERSION = \"$EXPECT_VERSION\"" "$SRC" || fail "Guard" "source is not v$EXPECT_VERSION"
grep -q 'resolve_pinterest' "$SRC" || fail "Guard" "resolve_pinterest missing from source"

cf GET /user/tokens/verify > "$W/verify.json"; st=$(jq -r '.result.status' "$W/verify.json"); notice "Token" "status=$st"
[ "$st" = "active" ] || fail "Token" "token not active"

if [ -n "${CF_ACCOUNT_OVERRIDE:-}" ]; then ACCOUNT_ID="$CF_ACCOUNT_OVERRIDE"
else
  cf GET /accounts > "$W/acc.json"
  n=$(jq '.result | length' "$W/acc.json"); [ "$n" = "1" ] || fail "Account" "expected 1 account, found $n"
  ACCOUNT_ID=$(jq -r '.result[0].id' "$W/acc.json")
fi
BASE="/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME"

cf GET "$BASE/settings" > "$W/before.json"
jq -c '[.result.bindings[]? | {name,type}] | sort_by(.name)' "$W/before.json" > "$W/b_before.json"
jq -c '{d: .result.compatibility_date, f: .result.compatibility_flags}' "$W/before.json" > "$W/c_before.json"
notice "Bindings BEFORE" "$(jq -r 'map(.name+":"+.type)|join(", ")' "$W/b_before.json")"

cf GET "$BASE/content/v2" > "$W/live_before.js"
notice "Live version BEFORE" "$(grep -o 'const VERSION = "[^"]*"' "$W/live_before.js" | head -1)"

cf PUT "$BASE/content" \
  -F 'metadata={"main_module":"worker.js"};type=application/json' \
  -F "worker.js=@$SRC;filename=worker.js;type=application/javascript+module" > "$W/put.json"
[ "$(jq -r '.success' "$W/put.json")" = "true" ] || fail "Upload" "$(jq -c '.errors' "$W/put.json")"
notice "Upload" "success, modified_on=$(jq -r '.result.modified_on' "$W/put.json")"

cf GET "$BASE/settings" > "$W/after.json"
jq -c '[.result.bindings[]? | {name,type}] | sort_by(.name)' "$W/after.json" > "$W/b_after.json"
jq -c '{d: .result.compatibility_date, f: .result.compatibility_flags}' "$W/after.json" > "$W/c_after.json"
notice "Bindings AFTER" "$(jq -r 'map(.name+":"+.type)|join(", ")' "$W/b_after.json")"
cmp -s "$W/b_before.json" "$W/b_after.json" || fail "Bindings changed" "before/after differ"
cmp -s "$W/c_before.json" "$W/c_after.json" || fail "Compatibility settings changed" "before/after differ"
notice "Preservation" "bindings and compatibility settings identical before and after"

sleep 5
cf GET "$BASE/content/v2" > "$W/live_after.js"
grep -q "const VERSION = \"$EXPECT_VERSION\"" "$W/live_after.js" || fail "Verify" "live code is not v$EXPECT_VERSION"
grep -q 'resolve_pinterest' "$W/live_after.js" || fail "Verify" "live code lacks resolve_pinterest"
notice "RESULT" "LIVE CODE IS v$EXPECT_VERSION WITH resolve_pinterest"
