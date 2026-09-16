<#
Local development helper (Windows PowerShell 5.1 compatible).

  .\infra\dev.ps1 up        start the dev PostgreSQL and wait until it is healthy
  .\infra\dev.ps1 down      stop it (data is kept)
  .\infra\dev.ps1 reset     stop it and DELETE the dev volume
  .\infra\dev.ps1 migrate   alembic upgrade head on the test database
  .\infra\dev.ps1 test      the CI backend pipeline against the dev database
  .\infra\dev.ps1 psql      interactive psql in the container (birka_test)

Environment variables are set for this process only and mirror CI.
#>
param(
    [Parameter(Position = 0)]
    [ValidateSet('up', 'down', 'reset', 'migrate', 'test', 'psql')]
    [string]$Command = 'up'
)

# Not 'Stop': in PowerShell 5.1 that turns any native stderr line (docker
# compose writes progress there) into a terminating error. Failures are
# detected through $LASTEXITCODE in Invoke-Step and raised with `throw`.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$compose = Join-Path $PSScriptRoot 'docker-compose.dev.yml'
$backend = Join-Path $root 'backend'
$py = Join-Path $backend '.venv\Scripts\python.exe'

$testUrl = 'postgresql+asyncpg://birka:birka@localhost:5432/birka_test'
$env:BIRKA_APP_ENV = 'local'
$env:BIRKA_DATABASE_URL = $testUrl
$env:BIRKA_TEST_DATABASE_URL = $testUrl
$env:BIRKA_SESSION_SECRET = 'local-session-secret-that-is-long-enough-32'
$env:BIRKA_TELEGRAM_BOT_TOKEN = '123456:local-placeholder-token'

function Invoke-Step([string]$name, [scriptblock]$block) {
    Write-Host "==> $name" -ForegroundColor Cyan
    & $block
    if ($LASTEXITCODE -ne 0) { throw "step failed: $name (exit $LASTEXITCODE)" }
}

function Wait-Healthy {
    for ($i = 0; $i -lt 60; $i++) {
        $id = docker compose -f $compose ps -q db
        if ($id) {
            $state = docker inspect -f '{{.State.Health.Status}}' $id
            if ($state -eq 'healthy') { Write-Host 'db is healthy'; return }
        }
        Start-Sleep -Seconds 1
    }
    throw 'db did not become healthy in 60s (docker compose -f infra/docker-compose.dev.yml logs db)'
}

function Invoke-Alembic([string[]]$alembicArgs) {
    Push-Location $backend
    try { & $py -m alembic @alembicArgs } finally { Pop-Location }
}

switch ($Command) {
    'up' {
        Invoke-Step 'docker compose up' { docker compose -f $compose up -d }
        Wait-Healthy
    }
    'down' { Invoke-Step 'docker compose down' { docker compose -f $compose down } }
    'reset' { Invoke-Step 'docker compose down -v' { docker compose -f $compose down -v } }
    'migrate' { Invoke-Step 'alembic upgrade head' { Invoke-Alembic @('upgrade', 'head') } }
    'psql' { docker compose -f $compose exec db psql -U birka -d birka_test }
    'test' {
        Invoke-Step 'docker compose up' { docker compose -f $compose up -d }
        Wait-Healthy
        Push-Location $backend
        try {
            Invoke-Step 'ruff check' { & $py -m ruff check . }
            Invoke-Step 'ruff format --check' { & $py -m ruff format --check . }
            Invoke-Step 'mypy' { & $py -m mypy app scripts }
            Invoke-Step 'import contracts' { & (Join-Path $backend '.venv\Scripts\lint-imports.exe') --config pyproject.toml }
            Invoke-Step 'alembic upgrade head' { & $py -m alembic upgrade head }
            Invoke-Step 'alembic check (drift)' { & $py -m alembic check }
            Invoke-Step 'alembic downgrade base' { & $py -m alembic downgrade base }
            Invoke-Step 'alembic upgrade head' { & $py -m alembic upgrade head }
            # Same coverage as CI's `pytest -q` + integration re-run, but each
            # test runs once: the integration suite takes minutes on Windows.
            Invoke-Step 'pytest (unit)' { & $py -m pytest -q -m 'not integration' }

            # A fully skipped integration suite exits 0; assert it really ran.
            Write-Host '==> pytest (integration)' -ForegroundColor Cyan
            $out = & $py -m pytest -m integration -q --no-header 2>&1 | Out-String
            Write-Host $out
            if ($LASTEXITCODE -ne 0) { throw "step failed: pytest (integration) (exit $LASTEXITCODE)" }
            if ($out -notmatch '\d+ passed') { throw 'no integration test passed - the database suite did not run' }
            if ($out -match '\d+ skipped') { throw 'integration tests were skipped (database unreachable?)' }
            Write-Host 'ALL CHECKS PASSED' -ForegroundColor Green
        }
        finally { Pop-Location }
    }
}
