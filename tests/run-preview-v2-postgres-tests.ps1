[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$image = 'postgres:17.6-alpine'
$database = 'beginner_budget_v2_test'
$containerName = 'beginner-budget-preview-v2-pg17-{0}-{1}' -f $PID, ([guid]::NewGuid().ToString('N').Substring(0, 8))
$containerId = $null
$cleanupTarget = $null
$createdByThisRun = $false
$sessionProcesses = @()
$tempRoot = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'Temp'
$runDirectory = Join-Path $tempRoot ('beginner-budget-preview-v2-pg17-' + [guid]::NewGuid().ToString('N'))
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path

function Invoke-Docker {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $oldPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $output = & docker @Arguments 2>&1
    $dockerExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $oldPreference
  }
  if ($dockerExitCode -ne 0) {
    throw "docker $($Arguments -join ' ') failed:`n$($output -join [Environment]::NewLine)"
  }
  return @($output)
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Content
  )
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

New-Item -ItemType Directory -Path $runDirectory | Out-Null

try {
  $runOutput = Invoke-Docker @(
    'run', '--detach', '--name', $containerName,
    '--env', 'POSTGRES_PASSWORD=preview-v2-runtime-only',
    '--env', "POSTGRES_DB=$database",
    $image
  )
  $createdByThisRun = $true
  $cleanupTarget = $containerName
  $runLines = @($runOutput)
  $containerId = ([string]$runLines[-1]).Trim()
  if ($containerId -notmatch '^[a-f0-9]{12,64}$') {
    throw "docker run returned an invalid container ID: $containerId"
  }
  $cleanupTarget = $containerId

  $ready = $false
  $readyDeadline = [DateTime]::UtcNow.AddSeconds(30)
  while ([DateTime]::UtcNow -lt $readyDeadline) {
    & docker exec $containerId pg_isready -U postgres -d $database *> $null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 250
  }
  if (-not $ready) { throw 'PostgreSQL container did not become ready within 30 seconds.' }

  Invoke-Docker @('exec', $containerId, 'mkdir', '-p', '/work/tests', '/work/docs') | Out-Null
  Invoke-Docker @('cp', (Join-Path $PSScriptRoot 'postgres-preview-v2-runtime.sql'), "${containerId}:/work/tests/runtime.sql") | Out-Null
  Invoke-Docker @('cp', (Join-Path $repoRoot 'docs/supabase-preview-v2-setup.sql'), "${containerId}:/work/docs/supabase-preview-v2-setup.sql") | Out-Null
  Invoke-Docker @(
    'exec', $containerId, 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', $database, '-f', '/work/tests/runtime.sql'
  ) | Out-Null

  $setupSql = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $repoRoot 'docs/supabase-preview-v2-setup.sql')
  $seedStart = $setupSql.IndexOf('-- Atomic one-time V2 production snapshot.', [System.StringComparison]::Ordinal)
  $seedEnd = $setupSql.IndexOf('-- Atomically replace one authenticated user''s V2 preview settings and transactions.', $seedStart, [System.StringComparison]::Ordinal)
  if ($seedStart -lt 0 -or $seedEnd -le $seedStart) {
    throw 'Could not isolate the exact V2 seed transaction from the setup SQL.'
  }
  $seedConcurrencyPath = Join-Path $runDirectory 'seed-concurrency.sql'
  Write-Utf8NoBom -Path $seedConcurrencyPath -Content ("\set ON_ERROR_STOP on`nset statement_timeout = '12s';`n" + $setupSql.Substring($seedStart, $seedEnd - $seedStart))

  $sessionA = @'
\set ON_ERROR_STOP on
set statement_timeout = '12s';
update public.preview_v2_runtime_barrier set ready = true where participant = 'seed';
do $wait$
declare v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while (select count(*) from public.preview_v2_runtime_barrier where ready) <> 2 loop
    if clock_timestamp() >= v_deadline then raise exception 'barrier ready timeout'; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$wait$;
select pg_sleep(0.25);
\ir /tmp/seed-concurrency.sql
update public.preview_v2_runtime_barrier set finished = true where participant = 'seed';
do $wait$
declare v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while (select count(*) from public.preview_v2_runtime_barrier where finished) <> 2 loop
    if clock_timestamp() >= v_deadline then raise exception 'barrier finish timeout'; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$wait$;
update public.preview_v2_runtime_barrier set duplicate_ready = true where participant = 'seed';
do $wait$
declare v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while (select count(*) from public.preview_v2_runtime_barrier where duplicate_ready) <> 2 loop
    if clock_timestamp() >= v_deadline then raise exception 'duplicate barrier timeout'; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$wait$;
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $duplicate$
begin
  begin
    insert into public.preview_v2_transactions (id, user_id, date, type, category, amount, memo, source)
    values ('tx-recurring-concurrent-2026-08', auth.uid(), '2026-08-26', 'expense', 'living', 1000, '', 'user');
    perform set_config('preview_v2.duplicate_result', 'inserted', false);
  exception when unique_violation then
    perform set_config('preview_v2.duplicate_result', '23505', false);
  end;
end;
$duplicate$;
commit;
update public.preview_v2_runtime_barrier
set duplicate_result = current_setting('preview_v2.duplicate_result')
where participant = 'seed';
'@

  $sessionB = @'
\set ON_ERROR_STOP on
set statement_timeout = '12s';
update public.preview_v2_runtime_barrier set ready = true where participant = 'rpc';
select set_config(
  'preview_v2.proposed_budget',
  (select monthly_budget::text from public.budget_settings
   where user_id = '00000000-0000-0000-0000-0000000000a1'),
  false
);
select set_config(
  'preview_v2.proposed_categories',
  (select category_budgets::text from public.budget_settings
   where user_id = '00000000-0000-0000-0000-0000000000a1'),
  false
);
begin;
lock table public.preview_v2_transactions in share row exclusive mode;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
select * from public.replace_preview_v2_budget_state(
  current_setting('preview_v2.proposed_budget')::integer,
  current_setting('preview_v2.proposed_categories')::jsonb,
  '[]'::jsonb,
  null,
  '[]'::jsonb
);
commit;
update public.preview_v2_runtime_barrier set finished = true where participant = 'rpc';
do $wait$
declare v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while (select count(*) from public.preview_v2_runtime_barrier where finished) <> 2 loop
    if clock_timestamp() >= v_deadline then raise exception 'barrier finish timeout'; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$wait$;
update public.preview_v2_runtime_barrier set duplicate_ready = true where participant = 'rpc';
do $wait$
declare v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while (select count(*) from public.preview_v2_runtime_barrier where duplicate_ready) <> 2 loop
    if clock_timestamp() >= v_deadline then raise exception 'duplicate barrier timeout'; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$wait$;
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
set local role authenticated;
do $duplicate$
begin
  begin
    insert into public.preview_v2_transactions (id, user_id, date, type, category, amount, memo, source)
    values ('tx-recurring-concurrent-2026-08', auth.uid(), '2026-08-26', 'expense', 'living', 1000, '', 'user');
    perform set_config('preview_v2.duplicate_result', 'inserted', false);
  exception when unique_violation then
    perform set_config('preview_v2.duplicate_result', '23505', false);
  end;
end;
$duplicate$;
commit;
update public.preview_v2_runtime_barrier
set duplicate_result = current_setting('preview_v2.duplicate_result')
where participant = 'rpc';
'@

  $finalAssertions = @'
\set ON_ERROR_STOP on
select public.preview_v2_assert(
  (select count(*) = 2 from public.preview_v2_runtime_barrier where ready and finished and duplicate_ready),
  'both concurrency sessions must complete'
);
select public.preview_v2_assert(
  (select array_agg(duplicate_result order by duplicate_result) = array['23505', 'inserted']
   from public.preview_v2_runtime_barrier),
  'concurrent same-user deterministic ID inserts must yield one success and one 23505'
);
select public.preview_v2_assert(
  (select count(*) = 1 from public.preview_v2_transactions
   where user_id = '00000000-0000-0000-0000-0000000000a1'
     and id = 'tx-recurring-concurrent-2026-08'),
  'same-user deterministic ID must exist exactly once'
);
select public.preview_v2_assert(
  (select value = public.preview_v2_test_hash('public.budget_settings')
   from public.preview_v2_test_invariants where name = 'production-settings')
  and (select value = public.preview_v2_test_hash('public.transactions')
       from public.preview_v2_test_invariants where name = 'production-transactions'),
  'production fixtures must remain invariant during concurrent seed/RPC'
);
select public.preview_v2_assert(
  (select value = public.preview_v2_test_hash('public.preview_budget_settings')
   from public.preview_v2_test_invariants where name = 'v1-settings')
  and (select value = public.preview_v2_test_hash('public.preview_transactions')
       from public.preview_v2_test_invariants where name = 'v1-transactions')
  and (select value = public.preview_v2_test_hash('public.preview_seed_metadata')
       from public.preview_v2_test_invariants where name = 'v1-marker'),
  'V1 fixtures must remain invariant during concurrent seed/RPC'
);
select public.preview_v2_assert(
  exists (select 1 from public.preview_v2_seed_metadata where seed_key = 'production_snapshot_v2'),
  'concurrent seed must commit its marker'
);
'@

  $sessionAPath = Join-Path $runDirectory 'session-a.sql'
  $sessionBPath = Join-Path $runDirectory 'session-b.sql'
  $finalPath = Join-Path $runDirectory 'final.sql'
  Write-Utf8NoBom -Path $sessionAPath -Content $sessionA
  Write-Utf8NoBom -Path $sessionBPath -Content $sessionB
  Write-Utf8NoBom -Path $finalPath -Content $finalAssertions
  Invoke-Docker @('cp', $seedConcurrencyPath, "${containerId}:/tmp/seed-concurrency.sql") | Out-Null
  Invoke-Docker @('cp', $sessionAPath, "${containerId}:/tmp/session-a.sql") | Out-Null
  Invoke-Docker @('cp', $sessionBPath, "${containerId}:/tmp/session-b.sql") | Out-Null
  Invoke-Docker @('cp', $finalPath, "${containerId}:/tmp/final.sql") | Out-Null

  $sessionALog = Join-Path $runDirectory 'session-a.log'
  $sessionAError = Join-Path $runDirectory 'session-a.error.log'
  $sessionBLog = Join-Path $runDirectory 'session-b.log'
  $sessionBError = Join-Path $runDirectory 'session-b.error.log'
  $dockerExecutable = (Get-Command docker -ErrorAction Stop).Source
  $commonArguments = @('exec', $containerId, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', $database)
  $sessionProcesses = @(
    (Start-Process -FilePath $dockerExecutable -ArgumentList ($commonArguments + @('-f', '/tmp/session-a.sql')) -RedirectStandardOutput $sessionALog -RedirectStandardError $sessionAError -PassThru -WindowStyle Hidden),
    (Start-Process -FilePath $dockerExecutable -ArgumentList ($commonArguments + @('-f', '/tmp/session-b.sql')) -RedirectStandardOutput $sessionBLog -RedirectStandardError $sessionBError -PassThru -WindowStyle Hidden)
  )
  foreach ($process in $sessionProcesses) { $null = $process.Handle }

  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline -and @($sessionProcesses | Where-Object { -not $_.HasExited }).Count -gt 0) {
    Start-Sleep -Milliseconds 100
  }
  $timedOut = @($sessionProcesses | Where-Object { -not $_.HasExited })
  foreach ($process in $timedOut) {
    Stop-Process -Id $process.Id -Force
  }
  foreach ($process in $sessionProcesses) {
    $process.WaitForExit()
    $process.Refresh()
  }
  if ($timedOut.Count -gt 0) {
    throw "PostgreSQL concurrency sessions exceeded the 15 second timeout: $($timedOut.Id -join ', ')"
  }

  $combinedLog = @(
    Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $sessionALog
    Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $sessionAError
    Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $sessionBLog
    Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $sessionBError
  ) -join [Environment]::NewLine
  $sessionExitReport = @($sessionProcesses | ForEach-Object {
    $displayCode = if ($null -eq $_.ExitCode) { '<unavailable>' } else { [string]$_.ExitCode }
    "PID=$($_.Id), HasExited=$($_.HasExited), ExitCode=$displayCode"
  })
  Write-Output ('PostgreSQL session exit codes: ' + ($sessionExitReport -join '; '))
  if (@($sessionProcesses | Where-Object { $null -eq $_.ExitCode -or $_.ExitCode -ne 0 }).Count -gt 0) {
    throw "PostgreSQL concurrency session failed ($($sessionExitReport -join '; ')):`n$combinedLog"
  }
  if ($combinedLog -match '(?i)40P01|statement timeout') {
    throw "PostgreSQL concurrency log contains a deadlock or statement timeout:`n$combinedLog"
  }

  Invoke-Docker @(
    'exec', $containerId, 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', $database, '-f', '/tmp/final.sql'
  ) | Out-Null

  Write-Output 'preview-v2 PostgreSQL runtime tests passed'
}
finally {
  foreach ($process in @($sessionProcesses)) {
    if ($null -ne $process -and -not $process.HasExited) {
      Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
  }
  if ($createdByThisRun -and $cleanupTarget) {
    & docker rm --force $cleanupTarget *> $null
  }
  if (Test-Path -LiteralPath $runDirectory) {
    $resolvedRunDirectory = (Resolve-Path -LiteralPath $runDirectory).Path
    $resolvedTempRoot = (Resolve-Path -LiteralPath $tempRoot).Path.TrimEnd('\')
    if ($resolvedRunDirectory.StartsWith($resolvedTempRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $resolvedRunDirectory -Recurse -Force
    }
  }
}
