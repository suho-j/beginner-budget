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
set application_name = 'preview-v2-seed-session';
update public.preview_v2_runtime_barrier
set ready = true, backend_pid = pg_backend_pid()
where participant = 'seed';
do $wait$
declare v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while not (select release_seed from public.preview_v2_runtime_barrier where participant = 'seed') loop
    if clock_timestamp() >= v_deadline then raise exception 'seed release timeout'; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$wait$;
update public.preview_v2_runtime_barrier set seed_started = true where participant = 'seed';
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
set application_name = 'preview-v2-rpc-session';
update public.preview_v2_runtime_barrier
set ready = true, backend_pid = pg_backend_pid()
where participant = 'rpc';
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
do $wait$
declare v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
begin
  while not (select release_rpc from public.preview_v2_runtime_barrier where participant = 'rpc') loop
    if clock_timestamp() >= v_deadline then raise exception 'RPC release timeout'; end if;
    perform pg_sleep(0.05);
  end loop;
end;
$wait$;
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

  $lockController = @'
\set ON_ERROR_STOP on
set statement_timeout = '12s';
do $observe_rpc_lock$
declare
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
  v_rpc_pid integer;
begin
  loop
    select max(backend_pid) filter (where participant = 'rpc')
    into v_rpc_pid
    from public.preview_v2_runtime_barrier
    where ready;

    exit when v_rpc_pid is not null
      and exists (
        select 1 from pg_catalog.pg_locks
        where pid = v_rpc_pid
          and relation = 'public.preview_v2_transactions'::regclass
          and mode = 'ShareRowExclusiveLock'
          and granted
      );
    if clock_timestamp() >= v_deadline then
      raise exception 'RPC lock acquisition was not observed';
    end if;
    perform pg_sleep(0.05);
  end loop;
end;
$observe_rpc_lock$;

-- Phase 1 has committed, so session A can now see this release flag.
update public.preview_v2_runtime_barrier
set release_seed = true
where participant = 'seed';

do $observe_seed_wait$
declare
  v_deadline timestamptz := clock_timestamp() + interval '10 seconds';
  v_seed_pid integer;
  v_rpc_pid integer;
begin
  select max(backend_pid) filter (where participant = 'seed'),
         max(backend_pid) filter (where participant = 'rpc')
  into v_seed_pid, v_rpc_pid
  from public.preview_v2_runtime_barrier
  where ready;

  if v_seed_pid is null or v_rpc_pid is null then
    raise exception 'concurrency backend PIDs disappeared before lock observation';
  end if;
  loop
    exit when exists (
      select 1
      from public.preview_v2_runtime_barrier
      where participant = 'seed' and seed_started
    ) and exists (
      select 1
      from pg_catalog.pg_locks as waiting_lock
      join pg_catalog.pg_stat_activity as waiting_activity
        on waiting_activity.pid = waiting_lock.pid
      where waiting_lock.pid = v_seed_pid
        and waiting_lock.relation = 'public.preview_v2_transactions'::regclass
        and waiting_lock.mode = 'ShareRowExclusiveLock'
        and not waiting_lock.granted
        and waiting_lock.waitstart is not null
        and waiting_activity.wait_event_type = 'Lock'
        and exists (
          select 1
          from pg_catalog.pg_locks as holder_lock
          where holder_lock.pid = v_rpc_pid
            and holder_lock.relation = waiting_lock.relation
            and holder_lock.mode = 'ShareRowExclusiveLock'
            and holder_lock.granted
        )
    );
    if clock_timestamp() >= v_deadline then
      raise exception 'seed relation-lock wait was not observed';
    end if;
    perform pg_sleep(0.05);
  end loop;
end;
$observe_seed_wait$;

-- Phase 2 has committed; this one autocommit statement records the evidence and
-- releases session B without hiding either change inside a procedural block.
update public.preview_v2_runtime_barrier
set observed_wait = case when participant = 'seed' then true else observed_wait end,
    release_rpc = case when participant = 'rpc' then true else release_rpc end
where participant in ('seed', 'rpc');
'@

  $finalAssertions = @'
\set ON_ERROR_STOP on
select public.preview_v2_assert(
  (select count(*) = 2 from public.preview_v2_runtime_barrier where ready and finished and duplicate_ready)
    and (select observed_wait from public.preview_v2_runtime_barrier where participant = 'seed'),
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
  (select observed_wait from public.preview_v2_runtime_barrier where participant = 'seed'),
  'controller must observe seed waiting on the RPC relation lock'
);
select public.preview_v2_assert_fixture_snapshot('post-deliberate', 'concurrent seed and RPC');
select public.preview_v2_assert(
  exists (select 1 from public.preview_v2_seed_metadata where seed_key = 'production_snapshot_v2'),
  'concurrent seed must commit its marker'
);
'@

  $sessionAPath = Join-Path $runDirectory 'session-a.sql'
  $sessionBPath = Join-Path $runDirectory 'session-b.sql'
  $lockControllerPath = Join-Path $runDirectory 'lock-controller.sql'
  $finalPath = Join-Path $runDirectory 'final.sql'
  Write-Utf8NoBom -Path $sessionAPath -Content $sessionA
  Write-Utf8NoBom -Path $sessionBPath -Content $sessionB
  Write-Utf8NoBom -Path $lockControllerPath -Content $lockController
  Write-Utf8NoBom -Path $finalPath -Content $finalAssertions
  Invoke-Docker @('cp', $seedConcurrencyPath, "${containerId}:/tmp/seed-concurrency.sql") | Out-Null
  Invoke-Docker @('cp', $sessionAPath, "${containerId}:/tmp/session-a.sql") | Out-Null
  Invoke-Docker @('cp', $sessionBPath, "${containerId}:/tmp/session-b.sql") | Out-Null
  Invoke-Docker @('cp', $lockControllerPath, "${containerId}:/tmp/lock-controller.sql") | Out-Null
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

  # The controller proves real lock overlap through pg_locks/pg_stat_activity before
  # it releases the RPC transaction. No timing sleep is accepted as overlap evidence.
  Invoke-Docker @(
    'exec', $containerId, 'psql', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', $database, '-f', '/tmp/lock-controller.sql'
  ) | Out-Null

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
