#!/usr/bin/env bash
# Deploys deploy/media-bridge/worker.js (v2.4.1) to the existing Cloudflare Worker via the API.
# PUT /content replaces code only: bindings, secrets, variables and settings are not modified.
# Safety: guards before the upload; bindings/settings compared before and after; live code verified afterwards;
# automatic rollback to the known-good previous version (rollback-v2.4.0.js) if anything fails after the upload starts.
set -uo pipefail
: "${CF_TOKEN:?missing}"
SCRIPT_NAME="${SCRIPT_NAME:-media-bridge}"
EXPECT_VERSION="${EXPECT_VERSION:-2.4.1}"
ROLLBACK_VERSION="${ROLLBACK_VERSION:-2.4.0}"
CF_API="${CF_API:-https://api.cloudflare.com/client/v4}"
SRC="${SRC:-deploy/media-bridge/worker.js}"
ROLLBACK_SRC="${ROLLBACK_SRC:-deploy/media-bridge/rollback-v2.4.0.js}"
SETTLE_SECONDS="${SETTLE_SECONDS:-5}"
OLD_TOOLS="hello search_commons commons_info search_archive archive_files search_pexels search_pixabay probe_media fetch_chunk relay_media relay_cleanup resolve_pinterest generate_image"
NEW_TOOLS=""
W="$(mktemp -d)"; BASE=""; UPLOADED=0; ROLLED_BACK=0
META='metadata={"main_module":"worker.js"};type=application/json'

fail() { echo "::error title=$1::$2"; exit 1; }
notice() { echo "::notice title=$1::$2"; }
cf() { # method path [extra curl args]
  local out="$W/resp.json" code
  code=$(curl -sS -o "$out" -w '%{http_code}' -X "$1" -H "Authorization: Bearer $CF_TOKEN" "${@:3}" "$CF_API$2") \
    || fail "curl failed" "$2"
  if [ "$code" -ge 400 ]; then fail "Cloudflare API HTTP $code" "$2 -> $(jq -c '.errors // .' "$out" 2>/dev/null | head -c 600)"; fi
  cat "$out"
}
version_of() { grep -o 'const VERSION = "[^"]*"' "$1" | head -1 | sed 's/.*"\(.*\)"/\1/'; }
missing_tools() { local f="$1" t; shift; for t in "$@"; do grep -q "name: \"$t\"" "$f" || echo -n "$t "; done; }

rollback() {
  [ "$ROLLED_BACK" = 1 ] && return; ROLLED_BACK=1
  echo "::warning title=ROLLBACK::deployment failed after upload started; restoring v$ROLLBACK_VERSION from $ROLLBACK_SRC"
  local code
  code=$(curl -sS -o "$W/rb.json" -w '%{http_code}' -X PUT -H "Authorization: Bearer $CF_TOKEN" \
    -F "$META" -F "worker.js=@$ROLLBACK_SRC;filename=worker.js;type=application/javascript+module" "$CF_API$BASE/content") || code=000
  if [ "$code" -lt 400 ] && [ "$(jq -r '.success' "$W/rb.json" 2>/dev/null)" = "true" ]; then
    sleep "$SETTLE_SECONDS"
    curl -sS -H "Authorization: Bearer $CF_TOKEN" "$CF_API$BASE/content/v2" > "$W/rb_live.js" 2>/dev/null
    echo "::warning title=ROLLBACK DONE::live code is now v$(version_of "$W/rb_live.js")"
  else
    echo "::error title=ROLLBACK FAILED::HTTP $code $(head -c 300 "$W/rb.json" 2>/dev/null)"
  fi
}
on_exit() { local rc=$?; if [ "$rc" -ne 0 ] && [ "$UPLOADED" = 1 ]; then rollback; fi; exit "$rc"; }
trap on_exit EXIT

# ---- guards on the files (before touching Cloudflare) ----
[ "$(version_of "$SRC")" = "$EXPECT_VERSION" ] || fail "Guard" "source is not v$EXPECT_VERSION"
m=$(missing_tools "$SRC" $OLD_TOOLS $NEW_TOOLS); [ -z "$m" ] || fail "Guard" "tools missing from new source: $m"
[ "$(version_of "$ROLLBACK_SRC")" = "$ROLLBACK_VERSION" ] || fail "Guard" "rollback file is not v$ROLLBACK_VERSION"
m=$(missing_tools "$ROLLBACK_SRC" $OLD_TOOLS); [ -z "$m" ] || fail "Guard" "tools missing from rollback source: $m"

# ---- Cloudflare: token, account, current state ----
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
live_ver=$(version_of "$W/live_before.js"); notice "Live version BEFORE" "v${live_ver:-unknown}"
case "$live_ver" in "$ROLLBACK_VERSION"|"$EXPECT_VERSION") ;; *) fail "Guard" "live worker is v${live_ver:-unknown}, expected v$ROLLBACK_VERSION or v$EXPECT_VERSION; refusing to overwrite unknown code";; esac
m=$(missing_tools "$W/live_before.js" $OLD_TOOLS); [ -z "$m" ] || fail "Guard" "live worker is missing known tools ($m); refusing to overwrite unknown code"

# ---- upload (code only) ----
UPLOADED=1
cf PUT "$BASE/content" -F "$META" -F "worker.js=@$SRC;filename=worker.js;type=application/javascript+module" > "$W/put.json"
[ "$(jq -r '.success' "$W/put.json")" = "true" ] || fail "Upload" "$(jq -c '.errors' "$W/put.json")"
notice "Upload" "success, modified_on=$(jq -r '.result.modified_on' "$W/put.json")"

# ---- verify: bindings/settings untouched, live code is the new one with ALL tools ----
cf GET "$BASE/settings" > "$W/after.json"
jq -c '[.result.bindings[]? | {name,type}] | sort_by(.name)' "$W/after.json" > "$W/b_after.json"
jq -c '{d: .result.compatibility_date, f: .result.compatibility_flags}' "$W/after.json" > "$W/c_after.json"
notice "Bindings AFTER" "$(jq -r 'map(.name+":"+.type)|join(", ")' "$W/b_after.json")"
cmp -s "$W/b_before.json" "$W/b_after.json" || fail "Bindings changed" "before/after differ"
cmp -s "$W/c_before.json" "$W/c_after.json" || fail "Compatibility settings changed" "before/after differ"
notice "Preservation" "bindings and compatibility settings identical before and after"

sleep "$SETTLE_SECONDS"
cf GET "$BASE/content/v2" > "$W/live_after.js"
[ "$(version_of "$W/live_after.js")" = "$EXPECT_VERSION" ] || fail "Verify" "live code is not v$EXPECT_VERSION"
m=$(missing_tools "$W/live_after.js" $OLD_TOOLS $NEW_TOOLS); [ -z "$m" ] || fail "Verify" "live code lacks tools: $m"
notice "RESULT" "LIVE CODE IS v$EXPECT_VERSION; all 13 tools present; bindings unchanged"
