#!/bin/zsh
# One hot-path reading on a fresh birka_perf. Usage: perf-ab.sh <old|new> <outfile>
S=/private/tmp/claude-501/-Users-nikitahlushak-birka/d18c0c2c-ab71-4718-a82f-7a7e8cd503ae/scratchpad
source $S/unit-env.sh
cd /Users/nikitahlushak/birka/backend
export BIRKA_APP_ENV=ci \
  BIRKA_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55446/birka_perf \
  BIRKA_PERF_DATABASE_URL=postgresql+asyncpg://birka_review@127.0.0.1:55446/birka_perf \
  BIRKA_PERF_API_URL=http://127.0.0.1:58043 \
  BIRKA_TELEGRAM_BOT_TOKEN="123456:ci-placeholder-token" \
  BIRKA_SESSION_SECRET=ci-session-secret-that-is-long-enough-32 \
  BIRKA_LOG_LEVEL=WARNING BIRKA_PERF_GATE=all
unset BIRKA_TEST_DATABASE_URL
psqlu -d postgres -q -c "DROP DATABASE IF EXISTS birka_perf WITH (FORCE)" -c "CREATE DATABASE birka_perf"
$PY -m alembic upgrade head >/dev/null 2>&1 || { echo "migrate failed"; exit 1; }
if [ "$1" = old ]; then
  PYTHONPATH=$S:/Users/nikitahlushak/birka/backend nohup $PY -m uvicorn old_lock_app:app --host 127.0.0.1 --port 58043 --no-access-log > $S/perf-api-ab.log 2>&1 &
else
  nohup $PY -m uvicorn app.main:app --host 127.0.0.1 --port 58043 --no-access-log > $S/perf-api-ab.log 2>&1 &
fi
API_PID=$!
for i in $(seq 30); do curl -fsS http://127.0.0.1:58043/api/v1/health >/dev/null 2>&1 && break; sleep 1; done
echo "lock: $1" > $2
$PY -m scripts.measure_hot_path 2>&1 | grep -E "^(GET|POST)|gate" >> $2; echo "exit $?" >> $2
kill $API_PID; wait $API_PID 2>/dev/null
psqlu -d postgres -q -c "DROP DATABASE IF EXISTS birka_perf WITH (FORCE)"
