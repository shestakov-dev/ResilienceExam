#!/usr/bin/env bash

set -u

BASE_URL="${BASE_URL:-http://localhost:3000}"
ROUNDS="${ROUNDS:-40}"
MAX_BURST="${MAX_BURST:-4}"
MIN_DELAY_MS="${MIN_DELAY_MS:-300}"
MAX_DELAY_MS="${MAX_DELAY_MS:-2400}"
FAIL_PROBABILITY="${FAIL_PROBABILITY:-70}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-8}"

if [[ "$ROUNDS" -lt 1 ]]; then
  echo "ROUNDS must be >= 1"
  exit 1
fi

if [[ "$MAX_BURST" -lt 1 ]]; then
  echo "MAX_BURST must be >= 1"
  exit 1
fi

if [[ "$MIN_DELAY_MS" -lt 0 || "$MAX_DELAY_MS" -lt "$MIN_DELAY_MS" ]]; then
  echo "Delay bounds are invalid. Ensure MIN_DELAY_MS >= 0 and MAX_DELAY_MS >= MIN_DELAY_MS"
  exit 1
fi

if [[ "$FAIL_PROBABILITY" -lt 0 || "$FAIL_PROBABILITY" -gt 100 ]]; then
  echo "FAIL_PROBABILITY must be between 0 and 100"
  exit 1
fi

request_path="${BASE_URL%/}/todos"

echo "Starting randomish load: rounds=$ROUNDS max_burst=$MAX_BURST fail_probability=${FAIL_PROBABILITY}%"
echo "Target: $request_path"

for ((round = 1; round <= ROUNDS; round++)); do
  burst_size=$((RANDOM % MAX_BURST + 1))
  echo "Round $round/$ROUNDS -> burst size: $burst_size"

  for ((req = 1; req <= burst_size; req++)); do
    random_percent=$((RANDOM % 100))

    target_url="$request_path"
    mode="primary"

    if [[ "$random_percent" -lt "$FAIL_PROBABILITY" ]]; then
      target_url+="?failPrimary=true"
      mode="forced-fallback"
    fi

    # Keep output compact while exposing status and latency for quick visibility.
    curl_output="$(
      curl --silent --show-error \
        --output /dev/null \
        --max-time "$TIMEOUT_SECONDS" \
        --write-out "status=%{http_code} time=%{time_total}" \
        "$target_url" 2>&1
    )"

    printf '[%(%H:%M:%S)T] request=%d mode=%s %s\n' -1 "$req" "$mode" "$curl_output"
  done

  delay_ms=$((MIN_DELAY_MS + RANDOM % (MAX_DELAY_MS - MIN_DELAY_MS + 1)))
  delay_seconds="$(awk -v ms="$delay_ms" 'BEGIN { printf "%.3f", ms / 1000 }')"
  echo "Sleeping ${delay_seconds}s"
  sleep "$delay_seconds"
done

echo "Load run complete. Check fallback_trigger_total in Prometheus graph."