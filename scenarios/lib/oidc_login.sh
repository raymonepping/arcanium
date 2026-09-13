# scenarios/lib/oidc_login.sh — Prompt 29
#
# Shared OIDC Authorization Code + PKCE login helper. Extracted after this
# exact ~30-line block was independently copy-pasted into three scenario
# scripts (01_onboarding/run.sh, 06_supplier_isolation/provision.sh,
# 05_approval/provision.sh) during the same live incident — each patched
# separately, each carrying its own drift risk. Source this file; do not
# execute it directly.
#
# Usage:
#   source "$(dirname "$0")/../lib/oidc_login.sh"
#   if [ "$(auth_enabled)" = "true" ]; then
#     oidc_login "demo-architect" "Arcanium-arch-2026" || exit 1
#     trap 'rm -f "$OIDC_JAR"' EXIT
#     CURL_AUTH=(-b "$OIDC_JAR")
#   fi
#
# oidc_login sets $OIDC_JAR (a fresh cookie-jar tempfile) on success and
# returns nonzero on any failure, printing a FATAL line to stderr. The
# caller owns cleanup (trap) and owns building CURL_AUTH — this file only
# authenticates, so scripts that need a different credential shape are
# free to use $OIDC_JAR however they need.

oidc_login() {
  local username="$1" password="$2" api_base="${3:-${ARCANIUM_API:-http://localhost:3001}}"
  local tag="${OIDC_LOGIN_TAG:-oidc_login}"
  OIDC_JAR=$(mktemp)
  local login_headers auth_url form_html form_action cb_headers cb_url

  login_headers=$(curl -sD - -o /dev/null -c "$OIDC_JAR" "${api_base}/api/v1/auth/login?next=/")
  auth_url=$(echo "$login_headers" | grep -i '^location:' | awk '{print $2}' | tr -d '\r\n')
  if [ -z "$auth_url" ]; then
    echo "[$tag] FATAL: no OIDC redirect from /auth/login" >&2
    return 1
  fi

  form_html=$(curl -s -c "$OIDC_JAR" -b "$OIDC_JAR" "$auth_url")
  form_action=$(echo "$form_html" | grep -oE 'action="[^"]*"' | head -1 |
    sed -e 's/^action="//' -e 's/"$//' -e 's/&amp;/\&/g')
  if [ -z "$form_action" ]; then
    echo "[$tag] FATAL: no Keycloak login form found" >&2
    return 1
  fi

  cb_headers=$(curl -sD - -o /dev/null -c "$OIDC_JAR" -b "$OIDC_JAR" \
    --data-urlencode "username=${username}" --data-urlencode "password=${password}" \
    "$form_action")
  cb_url=$(echo "$cb_headers" | grep -i '^location:' | awk '{print $2}' | tr -d '\r\n')
  case "$cb_url" in
  *auth/callback*) ;;
  *)
    echo "[$tag] FATAL: Keycloak login rejected" >&2
    return 1
    ;;
  esac

  curl -s -o /dev/null -c "$OIDC_JAR" -b "$OIDC_JAR" "${api_base}/api/v1/auth/callback?${cb_url#*\?}"
  if ! grep -q arc_session "$OIDC_JAR"; then
    echo "[$tag] FATAL: no session cookie after callback" >&2
    return 1
  fi
}

# auth_enabled [api_base] -> prints "true" or "false" on stdout.
#
# Deliberately no -f/--fail on the curl call: /auth/me correctly returns a
# non-2xx status (401) with a meaningful JSON body
# ({"enabled":true,"error":"not authenticated"}) when auth is enabled but
# there is no session yet. -f discards the body on any non-2xx status,
# which silently inverts this check to "auth is disabled" — found live,
# 2026-09-13, while fixing scenarios/01_onboarding/run.sh.
auth_enabled() {
  local api_base="${1:-${ARCANIUM_API:-http://localhost:3001}}"
  curl -s "${api_base}/api/v1/auth/me" 2>/dev/null | jq -r '.enabled' 2>/dev/null || echo "false"
}
