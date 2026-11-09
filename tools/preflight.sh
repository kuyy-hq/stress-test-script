#!/usr/bin/env bash
# Stops a run before it sends a request when a target is not the stress-test environment.
#
# Every host in BASE_URL, WEB_URL and TEST_DB_URL must be localhost or listed in ALLOWED_HOSTS
# (comma separated). KUYY hosts are refused except for the explicit public-detail production tiers below.
# Dev, beta and prod share the production database, Redis and message queue, so normal load tests stay refused.
set -euo pipefail

host_of() {
  # Host part of a URL, without credentials, port, path or query.
  printf '%s' "$1" | sed -E 's#^[a-zA-Z0-9+.-]+://([^/@]*@)?(\[[^]]+\]|[^/:?]+).*#\2#'
}

hard_deny='(^|\.)kuyy\.(id|app)$|(^|\.)kuyy-?(internal|web|api)'
allowed=" localhost 127.0.0.1 ::1 [::1] host.docker.internal ${ALLOWED_HOSTS//,/ } "
failed=0

production_read_only() {
  [ "${ALLOW_PRODUCTION_READ_ONLY:-false}" = true ] || return 1
  case "${S:-}" in event_detail|a1|a4|prod_read|f1) ;; *) return 1 ;; esac
  [ "${S:-}" != prod_read ] || [ "${PROFILE:-}" = load ] || return 1
  [ "${S:-}" != f1 ] || [ -z "${TARGET_WEB_RPS:-}" ] || return 1
  [ "${SPREAD_IP:-true}" = false ] || return 1
  case "${PROFILE:-}:${TARGET_RPS:-}:${SCALE:-1}" in
    smoke:1:*|load:10:0.05|load:100:0.05|load:500:0.05|load:10:0.5|load:100:0.5|load:500:0.5) return 0 ;;
  esac
  [ "${S:-}" = f1 ] || return 1
  case "${PROFILE:-}:${TARGET_RPS:-}:${SCALE:-1}" in
    load:1000:0.05|load:2500:0.05|load:5000:0.05|load:10000:0.05) return 0 ;;
    *) return 1 ;;
  esac
}

production_label_allowed() {
  [ "$1" = BASE_URL ] && return 0
  [ "$1" = WEB_URL ] && [ "${S:-}" = f1 ]
}

check_host() {
  local label="$1" url="$2" host
  [ -z "$url" ] && return 0
  host="$(host_of "$url" | tr '[:upper:]' '[:lower:]')"
  host="${host%.}"
  if printf '%s' "$host" | grep -Eq "$hard_deny"; then
    if production_read_only && production_label_allowed "$label"; then
      echo "WARNING  $label -> $host: production read-only $PROFILE, TARGET_RPS=$TARGET_RPS"
    else
      echo "REFUSED: $label points at $host, a KUYY host." >&2
      failed=1
    fi
  elif [[ "$allowed" == *" $host "* ]]; then
    echo "ok       $label -> $host"
  else
    echo "REFUSED: $label points at $host, which is not localhost and not in ALLOWED_HOSTS." >&2
    failed=1
  fi
}

check_host BASE_URL "${BASE_URL:-}"
check_host WEB_URL "${WEB_URL:-}"
check_host TEST_DB_URL "${TEST_DB_URL:-}"

if [ -n "${TEST_DB_URL:-}" ]; then
  db="${TEST_DB_URL##*/}"
  db="${db%%\?*}"
  if ! printf '%s' "$db" | grep -Eq 'stress|loadtest'; then
    echo "REFUSED: database name \"$db\" does not contain \"stress\" or \"loadtest\"." >&2
    failed=1
  else
    echo "ok       database -> $db"
  fi
fi

rps="${TARGET_RPS:-0}"
if [ "$rps" -ge 200 ] 2>/dev/null; then
  target_url="${BASE_URL:-}"
  [ "${S:-}" != f1 ] || target_url="${WEB_URL:-}"
  case "$(host_of "$target_url")" in
    localhost|127.0.0.1|host.docker.internal)
      echo "WARNING  TARGET_RPS=$rps against a local target: k6, the API and the database share one machine, so the run measures this machine, not production." >&2 ;;
  esac
fi

if [ "$failed" -ne 0 ]; then
  echo "Nothing was sent. Fix the targets in .env, or add the stress environment host to ALLOWED_HOSTS." >&2
  exit 1
fi
