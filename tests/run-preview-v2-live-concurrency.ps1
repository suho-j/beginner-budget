[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-z][a-z0-9-]{4,39}$')][string]$ProjectRef,
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')][string]$QaUserA,
  [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')][string]$QaUserB,
  [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$')][string]$RunId,
  [Parameter(Mandatory)][ValidatePattern('^QA-V2-RECURRING-[0-9]{8}-[0-9]{6}$')][string]$QaMarker,
  [Parameter(Mandatory)][ValidatePattern('^[a-z0-9.-]+$')][string]$PgHost,
  [Parameter(Mandatory)][ValidateSet('5432')][string]$PgPort,
  [Parameter(Mandatory)][ValidatePattern('^[a-z0-9._-]+$')][string]$PgDatabase,
  [Parameter(Mandatory)][ValidatePattern('^[a-z0-9._-]+$')][string]$PgUser,
  [Parameter(Mandatory)][ValidateSet('verify-full')][string]$PgSslMode,
  [Parameter(Mandatory)][string]$SslRootCertificate,
  [Parameter(Mandatory)][string]$EvidenceDirectory,
  [ValidateSet('Docker')][string]$ClientMode = 'Docker',
  [ValidateRange(3, 15)][int]$ObservationDeadlineSeconds = 8,
  [ValidateRange(15, 90)][int]$WorkerDeadlineSeconds = 30,
  [switch]$RecoveryOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Live execution is intentionally fail-closed. QA B must be fully absent from
# production, V1, and V2. QA A may contain real data; it is touched only by one
# exact marker transaction in cross-user-same-id and is then byte-restored.
# The runner never mutates auth.users, production, V1, or production_snapshot_v2.

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$dockerPath = $null
$dockerContextName = $null
$dockerContextEndpoint = $null
$dockerContextSnapshotSha256 = $null
$dockerContextSnapshotPath = $null
$dockerImageReference = 'postgres:17.6-alpine'
$dockerImageId = $null
$dockerRepoDigest = $null
$dockerImageSnapshotSha256 = $null
$dockerImageImmutableIdentitySha256 = $null
$dockerImageSnapshotPath = $null
$originalDockerImageSnapshotPath = $null
$dockerClientContainerId = $null
$dockerClientContainerName = $null
$dockerClientNonce = $null
$dockerClientPurpose = $null
$dockerIntentGeneration = $null
$dockerIntentOwnerRecordSha256 = $null
$dockerClientRemovalVerified = $false
$ownedProcesses = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$securePassword = $null
$credentialPointer = [IntPtr]::Zero
$ledgerPath = $null
$cleanupAttempted = $false
$cleanupVerified = $false
$committedFixturePossible = $false
$primaryError = $null
$cleanupError = $null
$fixtures = [ordered]@{}
$invariantBefore = $null
$userACanonicalBefore = $null
$activeWorkers = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$activeControllers = New-Object System.Collections.Generic.List[System.Diagnostics.Process]
$baselineInvariantPath = $null
$baselineUserAPath = $null
$recoverySqlPath = $null
$expectedCleanupSqlSha256 = $null
$cleanupAttemptNumber = 0
$preparedSqlFiles = @{}
$evidenceLeaseStream = $null
$sslRootCertificateResolvedPath = $null
$sslRootCertificateSha256 = $null
$sslRootCertificateLength = 0L
$dockerSslRootCertificatePath = '/tmp/preview-v2-supabase-root-ca.crt'
$dockerSslRootCertificateVerified = $false
$unsafeLibpqEnvironmentNames = @(
  'PGPASSWORD','PGPASSFILE','PGHOSTADDR','PGSERVICE','PGSERVICEFILE',
  'PGHOST','PGPORT','PGDATABASE','PGUSER','PGSSLMODE','PGCONNECT_TIMEOUT',
  'PGOPTIONS','PGTARGETSESSIONATTRS','PGAPPNAME','PGSSLROOTCERT'
)
$unsafeDockerEnvironmentNames = @(
  'DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','DOCKER_CONFIG'
)

function ConvertTo-PsqlLiteral {
  param([Parameter(Mandatory)][string]$Value)
  return "'" + $Value.Replace("'", "''") + "'"
}

function Write-Utf8NoBom {
  param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][AllowEmptyString()][string]$Content)
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Write-DurableNewFile {
  param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$Content)
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Content)
  $stream = [System.IO.FileStream]::new($Path,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::Read)
  try {
    $stream.Write($bytes,0,$bytes.Length)
    $stream.Flush($true)
  } finally { $stream.Dispose() }
}

function Get-Sha256Hex {
  param([Parameter(Mandatory)][AllowEmptyString()][string]$Content)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash([System.Text.UTF8Encoding]::new($false).GetBytes($Content)) }
  finally { $sha.Dispose() }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-FileSha256Hex {
  param([Parameter(Mandatory)][string]$Path)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try { $hash = $sha.ComputeHash($stream) }
  finally { $stream.Dispose(); $sha.Dispose() }
  return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Get-DockerImmutableIdentitySha256 {
  param([Parameter(Mandatory)][string]$ImageId,[Parameter(Mandatory)][string]$RepoDigest)
  return Get-Sha256Hex -Content (([ordered]@{imageId=$ImageId;repoDigest=$RepoDigest} | ConvertTo-Json -Compress))
}

function Initialize-SslRootCertificate {
  if (-not [System.IO.Path]::IsPathRooted($SslRootCertificate)) {
    throw 'SslRootCertificate must be an absolute local file path.'
  }
  $fullPath = [System.IO.Path]::GetFullPath($SslRootCertificate)
  $item = Get-Item -Force -LiteralPath $fullPath -ErrorAction Stop
  if ($item.PSProvider.Name -cne 'FileSystem' -or $item.PSIsContainer) {
    throw 'SslRootCertificate must be a regular local file.'
  }
  if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw 'SslRootCertificate must not be a reparse point.'
  }
  $repoPrefix = $repoRoot.TrimEnd('\') + '\'
  if ($item.FullName.Equals($repoRoot,[System.StringComparison]::OrdinalIgnoreCase) -or
      $item.FullName.StartsWith($repoPrefix,[System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'SslRootCertificate must be supplied from outside the Git repository.'
  }
  if ($item.Length -lt 512 -or $item.Length -gt 65536) {
    throw 'SslRootCertificate has an unsafe or implausible size.'
  }
  $pem = [System.IO.File]::ReadAllText($item.FullName,[System.Text.Encoding]::ASCII)
  $match = [System.Text.RegularExpressions.Regex]::Match(
    $pem,
    '\A\s*-----BEGIN CERTIFICATE-----\s*(?<body>[A-Za-z0-9+/=\r\n]+?)\s*-----END CERTIFICATE-----\s*\z',
    [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
  )
  if (-not $match.Success) { throw 'SslRootCertificate must contain exactly one PEM certificate.' }
  try {
    $der = [Convert]::FromBase64String(($match.Groups['body'].Value -replace '\s',''))
    $certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($der)
    try {
      $basicConstraints = @($certificate.Extensions | Where-Object { $_.Oid.Value -ceq '2.5.29.19' })
      if ($basicConstraints.Count -ne 1 -or
          -not ($basicConstraints[0] -is [System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]) -or
          -not $basicConstraints[0].CertificateAuthority) {
        throw 'SslRootCertificate is not an X.509 CA certificate.'
      }
      $now = [DateTime]::UtcNow
      if ($certificate.NotBefore.ToUniversalTime() -gt $now -or $certificate.NotAfter.ToUniversalTime() -le $now) {
        throw 'SslRootCertificate is not currently valid.'
      }
    } finally { $certificate.Dispose() }
  } catch {
    if ($_.Exception.Message -like 'SslRootCertificate *') { throw }
    throw 'SslRootCertificate is not a valid X.509 PEM certificate.'
  }
  $script:sslRootCertificateResolvedPath = $item.FullName
  $script:sslRootCertificateSha256 = Get-FileSha256Hex -Path $item.FullName
  $script:sslRootCertificateLength = [long]$item.Length
}

function Assert-NoInheritedLibpqEnvironment {
  foreach ($unsafeName in $unsafeLibpqEnvironmentNames) {
    if (-not [string]::IsNullOrEmpty([Environment]::GetEnvironmentVariable($unsafeName, 'Process'))) {
      throw "clear inherited libpq variable before running: $unsafeName"
    }
  }
  $unknown = @([Environment]::GetEnvironmentVariables('Process').Keys | Where-Object { ([string]$_) -match '^PG' })
  if ($unknown.Count -ne 0) {
    throw ('clear all inherited libpq variables before running: ' + (($unknown | Sort-Object) -join ','))
  }
}

function Assert-SafeEvidenceDirectory {
  param([Parameter(Mandatory)][string]$Path,[switch]$AllowExistingEvidence)
  $full = [System.IO.Path]::GetFullPath($Path)
  $repoPrefix = $repoRoot.TrimEnd('\') + '\'
  if ($full.Equals($repoRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
      $full.StartsWith($repoPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'EvidenceDirectory must be outside the Git repository.'
  }
  if (-not (Test-Path -LiteralPath $full)) { New-Item -ItemType Directory -Path $full | Out-Null }
  $resolved = (Resolve-Path -LiteralPath $full).Path
  if (-not $AllowExistingEvidence -and @(Get-ChildItem -Force -LiteralPath $resolved).Count -ne 0) {
    throw 'EvidenceDirectory must be new and empty.'
  }
  if ($AllowExistingEvidence -and @(Get-ChildItem -Force -LiteralPath $resolved).Count -eq 0) {
    throw 'RecoveryOnly requires an existing evidence bundle.'
  }
  return $resolved
}

function Acquire-EvidenceLease {
  param([Parameter(Mandatory)][string]$Directory)
  $leasePath = Join-Path $Directory '.preview-v2-live-runner.lease'
  try {
    $stream = [System.IO.FileStream]::new($leasePath,[System.IO.FileMode]::OpenOrCreate,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None)
  } catch {
    throw 'EvidenceDirectory is already owned by another live runner or RecoveryOnly process.'
  }
  try {
    $metadata = [ordered]@{projectRef=$ProjectRef;runId=$RunId;qaMarker=$QaMarker;recoveryOnly=[bool]$RecoveryOnly;processId=$PID;acquiredAtUtc=[DateTime]::UtcNow.ToString('o')}
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes(($metadata | ConvertTo-Json -Compress))
    $stream.SetLength(0)
    $stream.Write($bytes,0,$bytes.Length)
    $stream.Flush($true)
    $stream.Position = 0
    return $stream
  } catch {
    $stream.Dispose()
    throw
  }
}

function Get-DeterministicId {
  param([Parameter(Mandatory)][string]$Phase, [Parameter(Mandatory)][string]$Prefix)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$RunId`:$Phase")) }
  finally { $sha.Dispose() }
  $suffix = (($hash | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 20)
  return "$Prefix-live-$Phase-$suffix"
}

function Get-AdvisoryKey {
  param([Parameter(Mandatory)][string]$Phase)
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$RunId`:$Phase`:$QaMarker")) }
  finally { $sha.Dispose() }
  $value = [BitConverter]::ToInt64($hash, 0)
  if ($value -eq [Int64]::MinValue) { return 1L }
  return [Math]::Abs($value)
}

function Add-LedgerRecord {
  param(
    [Parameter(Mandatory)][ValidateSet('transactionIds', 'templateIds', 'events')][string]$Collection,
    [Parameter(Mandatory)][string]$UserId,
    [Parameter(Mandatory)][string]$Id,
    [Parameter(Mandatory)][string]$Memo,
    [Parameter(Mandatory)][string]$Purpose
  )
  $line = ([ordered]@{
    collection = $Collection
    userId = $UserId
    id = $Id
    memo = $Memo
    purpose = $Purpose
    recordedAtUtc = [DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Compress) + [Environment]::NewLine
  $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($line)
  $stream = [System.IO.FileStream]::new($ledgerPath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read)
  try { $stream.Write($bytes, 0, $bytes.Length); $stream.Flush() }
  finally { $stream.Dispose() }
}

function Stop-OwnedProcess {
  param([Parameter(Mandatory)][System.Diagnostics.Process]$Process)
  if ($null -eq $Process -or $Process.HasExited) { return }
  $owned = Get-Process -Id $Process.Id -ErrorAction SilentlyContinue
  if ($null -ne $owned -and $owned.Id -eq $Process.Id) {
    Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
  }
}

function Quote-ProcessArgument {
  param([Parameter(Mandatory)][string]$Value)
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ($Value -replace '(\\*)"', '$1$1\"' -replace '(\\+)$', '$1$1') + '"'
}

function Assert-NoInheritedDockerEnvironment {
  foreach ($unsafeName in $unsafeDockerEnvironmentNames) {
    $value = [Environment]::GetEnvironmentVariable($unsafeName, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      throw "unsafe inherited Docker endpoint override is set: $unsafeName"
    }
  }
}

function Invoke-DockerContextCapture {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Purpose,
    [int]$TimeoutSeconds = 10
  )
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $dockerPath
  $start.Arguments = (($Arguments | ForEach-Object { Quote-ProcessArgument ([string]$_) }) -join ' ')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($unsafeName in $unsafeDockerEnvironmentNames) {
    $null = $start.EnvironmentVariables.Remove($unsafeName)
  }
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $start
  if (-not $process.Start()) { throw "failed to start Docker context inspection: $Purpose" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-OwnedProcess -Process $process
    throw "bounded Docker context inspection deadline exceeded: $Purpose"
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
  $stderr = $stderrTask.GetAwaiter().GetResult().Trim()
  if ($process.ExitCode -ne 0) { throw "Docker context inspection failed: $Purpose exit=$($process.ExitCode) $stderr" }
  return [pscustomobject]@{Stdout=$stdout;Stderr=$stderr;ExitCode=$process.ExitCode}
}

function Initialize-LocalDockerContext {
  Assert-NoInheritedDockerEnvironment
  $shown = Invoke-DockerContextCapture -Purpose 'docker-context-show' -Arguments @('context','show')
  $contextName = $shown.Stdout.Trim()
  if ($contextName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$') {
    throw 'Docker context name is empty or unsafe.'
  }
  $inspected = Invoke-DockerContextCapture -Purpose 'docker-context-inspect' -Arguments @('context','inspect',$contextName)
  $parsed = ConvertFrom-Json -InputObject $inspected.Stdout
  $rows = @($parsed)
  if ($rows.Count -ne 1 -or [string]$rows[0].Name -cne $contextName) {
    throw 'Docker context show/inspect identity mismatch.'
  }
  $dockerEndpointProperty = $rows[0].Endpoints.PSObject.Properties['docker']
  if ($null -eq $dockerEndpointProperty) { throw 'Docker context has no Docker endpoint.' }
  $hostProperty = $dockerEndpointProperty.Value.PSObject.Properties['Host']
  if ($null -eq $hostProperty) { throw 'Docker context endpoint has no host.' }
  $endpoint = [string]$hostProperty.Value
  $allowedLocalEndpoints = @(
    'npipe:////./pipe/docker_engine',
    'npipe:////./pipe/dockerDesktopLinuxEngine'
  )
  if ($allowedLocalEndpoints -cnotcontains $endpoint) {
    throw 'Docker context must use an exact local Windows named-pipe endpoint; remote SSH/TCP daemons are forbidden.'
  }
  $snapshotContent = [ordered]@{contextName=$contextName;endpoint=$endpoint;localWindowsNamedPipe=$true} | ConvertTo-Json
  $snapshotName = if ($RecoveryOnly) { 'docker-context-snapshot-recovery-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'.json' } else { 'docker-context-snapshot.json' }
  $script:dockerContextSnapshotPath = Join-Path $EvidenceDirectory $snapshotName
  Write-DurableNewFile -Path $dockerContextSnapshotPath -Content $snapshotContent
  $script:dockerContextName = $contextName
  $script:dockerContextEndpoint = $endpoint
  $script:dockerContextSnapshotSha256 = Get-FileSha256Hex -Path $dockerContextSnapshotPath
}

function Invoke-DockerCapture {
  param(
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$Purpose,
    [int]$TimeoutSeconds = 15
  )
  if ([string]::IsNullOrWhiteSpace($dockerContextEndpoint)) {
    throw 'validated local Docker context is not initialized.'
  }
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $dockerPath
  $pinnedArguments = @('--host',$dockerContextEndpoint) + $Arguments
  $start.Arguments = (($pinnedArguments | ForEach-Object { Quote-ProcessArgument ([string]$_) }) -join ' ')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($unsafeName in @($start.EnvironmentVariables.Keys | Where-Object { ([string]$_) -match '^PG' })) {
    $null = $start.EnvironmentVariables.Remove($unsafeName)
  }
  foreach ($unsafeName in $unsafeDockerEnvironmentNames) {
    $null = $start.EnvironmentVariables.Remove($unsafeName)
  }
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $start
  if (-not $process.Start()) { throw "failed to start docker: $Purpose" }
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-OwnedProcess -Process $process
    throw "bounded docker deadline exceeded: $Purpose"
  }
  $stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
  $stderr = $stderrTask.GetAwaiter().GetResult().Trim()
  if ($process.ExitCode -ne 0) { throw "docker failed: $Purpose exit=$($process.ExitCode) $stderr" }
  return [pscustomobject]@{Stdout=$stdout;Stderr=$stderr;ExitCode=$process.ExitCode}
}

function Get-DockerClientContainerName {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$ProjectRef`:$RunId`:$QaMarker")) }
  finally { $sha.Dispose() }
  $suffix = (($hash | ForEach-Object { $_.ToString('x2') }) -join '').Substring(0, 20)
  return "pv2-live-$suffix"
}

function Get-DockerContainerIdsByExactName {
  param([Parameter(Mandatory)][ValidatePattern('^[a-z0-9-]{1,63}$')][string]$Name)
  $result = Invoke-DockerCapture -Purpose 'docker-container-exact-list' -Arguments @('container','ls','--all','--filter',"name=^/$Name`$",'--format','{{.ID}}')
  return @($result.Stdout -split '\r?\n' | Where-Object { $_ -match '^[0-9a-f]{12,64}$' })
}

function Assert-DockerContainerIdentity {
  param(
    [Parameter(Mandatory)][string]$ContainerId,
    [Parameter(Mandatory)][string]$ContainerName,
    [Parameter(Mandatory)][string]$Nonce,
    [Parameter(Mandatory)][string]$ImageId
  )
  $identityJson = Invoke-DockerCapture -Purpose 'docker-client-ownership' -Arguments @('container','inspect',$ContainerId,'--format','{{json .}}')
  $identity = $identityJson.Stdout | ConvertFrom-Json
  $labelProperty = $identity.Config.Labels.PSObject.Properties['beginner-budget.preview-v2-live-runner']
  $labelValue = if ($null -eq $labelProperty) { $null } else { [string]$labelProperty.Value }
  if ([string]$identity.Id -cne $ContainerId -or [string]$identity.Name -cne "/$ContainerName" -or [string]$identity.Image -cne $ImageId -or $labelValue -cne $Nonce) {
    throw 'Docker client ownership name/label/image/ID verification failed.'
  }
}

function Remove-ExactOwnedDockerContainer {
  param(
    [Parameter(Mandatory)][string]$ContainerName,
    [Parameter(Mandatory)][string]$Nonce,
    [Parameter(Mandatory)][string]$ImageId,
    [AllowEmptyString()][string]$ExpectedContainerId = ''
  )
  $ids = @(Get-DockerContainerIdsByExactName -Name $ContainerName)
  if ($ids.Count -eq 0) {
    $daemonHealth = Invoke-DockerCapture -Purpose 'docker-daemon-health-after-cleanup' -Arguments @('version','--format','{{.Server.Version}}')
    if ($daemonHealth.Stdout -notmatch '^\d+\.\d+\.\d+') { throw 'Docker daemon health could not be proven after exact container absence.' }
    return $false
  }
  if ($ids.Count -ne 1) { throw 'Docker exact-name ownership lookup returned multiple containers.' }
  $listedContainerId = [string]$ids[0]
  if (-not [string]::IsNullOrWhiteSpace($ExpectedContainerId) -and -not $ExpectedContainerId.StartsWith($listedContainerId,[System.StringComparison]::Ordinal)) {
    throw 'Docker cleanup container ID does not match the persisted ownership intent.'
  }
  $identityJson = Invoke-DockerCapture -Purpose 'docker-client-full-id' -Arguments @('container','inspect',$listedContainerId,'--format','{{.Id}}')
  $containerId = $identityJson.Stdout
  if ($containerId -notmatch '^[0-9a-f]{64}$') { throw 'Docker cleanup could not resolve a full container ID.' }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedContainerId) -and $containerId -cne $ExpectedContainerId) { throw 'Docker cleanup full container ID mismatch.' }
  Assert-DockerContainerIdentity -ContainerId $containerId -ContainerName $ContainerName -Nonce $Nonce -ImageId $ImageId
  $null = Invoke-DockerCapture -Purpose 'docker-container-cleanup' -Arguments @('container','rm','--force','--volumes',$containerId)
  $remaining = @(Get-DockerContainerIdsByExactName -Name $ContainerName)
  if ($remaining.Count -ne 0) { throw 'docker-container-cleanup exact-name zero-list verification failed.' }
  $daemonHealth = Invoke-DockerCapture -Purpose 'docker-daemon-health-after-cleanup' -Arguments @('version','--format','{{.Server.Version}}')
  if ($daemonHealth.Stdout -notmatch '^\d+\.\d+\.\d+') { throw 'Docker daemon health could not be proven after exact container cleanup.' }
  return $true
}

function Get-DockerIntentPayload {
  param([Parameter(Mandatory)]$Record)
  return [ordered]@{
    schemaVersion=[int]$Record.schemaVersion
    intentGeneration=[string]$Record.intentGeneration
    sequence=[int]$Record.sequence
    state=[string]$Record.state
    projectRef=[string]$Record.projectRef
    runId=[string]$Record.runId
    qaMarker=[string]$Record.qaMarker
    purpose=[string]$Record.purpose
    containerName=[string]$Record.containerName
    containerId=[string]$Record.containerId
    ownershipNonce=[string]$Record.ownershipNonce
    imageId=[string]$Record.imageId
    repoDigest=[string]$Record.repoDigest
    imageSnapshotSha256=[string]$Record.imageSnapshotSha256
    imageImmutableIdentitySha256=[string]$Record.imageImmutableIdentitySha256
    previousRecordSha256=[string]$Record.previousRecordSha256
    recordedAtUtc=[string]$Record.recordedAtUtc
  }
}

function Write-DockerIntentRecord {
  param(
    [Parameter(Mandatory)][ValidateSet(1,2)][int]$Sequence,
    [Parameter(Mandatory)][ValidateSet('owner','created')][string]$State,
    [Parameter(Mandatory)][AllowEmptyString()][string]$ContainerId,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-f]{64}$')][string]$PreviousRecordSha256
  )
  $payload = [ordered]@{
    schemaVersion=1;intentGeneration=$dockerIntentGeneration;sequence=$Sequence;state=$State
    projectRef=$ProjectRef;runId=$RunId;qaMarker=$QaMarker;purpose=$dockerClientPurpose
    containerName=$dockerClientContainerName;containerId=$ContainerId;ownershipNonce=$dockerClientNonce
    imageId=$dockerImageId;repoDigest=$dockerRepoDigest;imageSnapshotSha256=$dockerImageSnapshotSha256;imageImmutableIdentitySha256=$dockerImageImmutableIdentitySha256
    previousRecordSha256=$PreviousRecordSha256;recordedAtUtc=[DateTime]::UtcNow.ToString('o')
  }
  $payloadJson = $payload | ConvertTo-Json -Compress
  $recordSha256 = Get-Sha256Hex -Content $payloadJson
  $record = [ordered]@{}
  foreach ($key in $payload.Keys) { $record[$key] = $payload[$key] }
  $record.recordSha256 = $recordSha256
  $suffix = if($Sequence -eq 1){'0001-owner'}else{'0002-created'}
  $path = Join-Path $EvidenceDirectory ("docker-client-intent-$dockerIntentGeneration-$suffix.json")
  Write-DurableNewFile -Path $path -Content ($record | ConvertTo-Json -Compress)
  return [pscustomobject]@{Path=$path;RecordSha256=$recordSha256}
}

function Read-ValidDockerIntentRecord {
  param([Parameter(Mandatory)][string]$Path)
  try {
    $record = Get-Content -Raw -Encoding UTF8 -LiteralPath $Path | ConvertFrom-Json
    $required = @('schemaVersion','intentGeneration','sequence','state','projectRef','runId','qaMarker','purpose','containerName','containerId','ownershipNonce','imageId','repoDigest','imageSnapshotSha256','imageImmutableIdentitySha256','previousRecordSha256','recordedAtUtc','recordSha256')
    foreach ($name in $required) { if ($null -eq $record.PSObject.Properties[$name]) { return $null } }
    $payload = Get-DockerIntentPayload -Record $record
    $calculated = Get-Sha256Hex -Content ($payload | ConvertTo-Json -Compress)
    if ([string]$record.recordSha256 -notmatch '^[0-9a-f]{64}$' -or $calculated -cne [string]$record.recordSha256) { return $null }
    return $record
  } catch { return $null }
}

function Get-ValidDockerIntentOwners {
  $owners = New-Object System.Collections.Generic.List[object]
  foreach ($file in @(Get-ChildItem -LiteralPath $EvidenceDirectory -Filter 'docker-client-intent-*-0001-owner.json' -File)) {
    $owner = Read-ValidDockerIntentRecord -Path $file.FullName
    if ($null -eq $owner -or [int]$owner.schemaVersion -ne 1 -or [int]$owner.sequence -ne 1 -or [string]$owner.state -cne 'owner' -or
        [string]$owner.containerId -cne '' -or [string]$owner.previousRecordSha256 -cne ('0' * 64) -or
        [string]$owner.intentGeneration -notmatch '^\d{8}T\d{9}Z-[0-9a-f]{32}$' -or
        [string]$owner.containerName -cne (Get-DockerClientContainerName) -or [string]$owner.ownershipNonce -notmatch '^[0-9a-f]{32}$' -or
        [string]$owner.imageId -notmatch '^sha256:[0-9a-f]{64}$' -or [string]$owner.repoDigest -notmatch '^postgres@sha256:[0-9a-f]{64}$' -or
        [string]$owner.imageSnapshotSha256 -notmatch '^[0-9a-f]{64}$' -or [string]$owner.imageImmutableIdentitySha256 -notmatch '^[0-9a-f]{64}$' -or
        (Get-DockerImmutableIdentitySha256 -ImageId ([string]$owner.imageId) -RepoDigest ([string]$owner.repoDigest)) -cne [string]$owner.imageImmutableIdentitySha256 -or [string]$owner.projectRef -cne $ProjectRef -or
        [string]$owner.runId -cne $RunId -or [string]$owner.qaMarker -cne $QaMarker -or
        @('workload','recovery-control','cleanup-control') -notcontains [string]$owner.purpose) { continue }

    $createdId = ''
    $createdPath = Join-Path $EvidenceDirectory ("docker-client-intent-$($owner.intentGeneration)-0002-created.json")
    if (Test-Path -LiteralPath $createdPath) {
      $created = Read-ValidDockerIntentRecord -Path $createdPath
      if ($null -ne $created -and [int]$created.schemaVersion -eq 1 -and [int]$created.sequence -eq 2 -and [string]$created.state -ceq 'created' -and
          [string]$created.previousRecordSha256 -ceq [string]$owner.recordSha256 -and [string]$created.intentGeneration -ceq [string]$owner.intentGeneration -and
          [string]$created.projectRef -ceq [string]$owner.projectRef -and [string]$created.runId -ceq [string]$owner.runId -and
          [string]$created.qaMarker -ceq [string]$owner.qaMarker -and [string]$created.purpose -ceq [string]$owner.purpose -and
          [string]$created.containerName -ceq [string]$owner.containerName -and [string]$created.ownershipNonce -ceq [string]$owner.ownershipNonce -and
          [string]$created.imageId -ceq [string]$owner.imageId -and [string]$created.repoDigest -ceq [string]$owner.repoDigest -and
          [string]$created.imageSnapshotSha256 -ceq [string]$owner.imageSnapshotSha256 -and [string]$created.imageImmutableIdentitySha256 -ceq [string]$owner.imageImmutableIdentitySha256 -and
          [string]$created.containerId -match '^[0-9a-f]{64}$') {
        $createdId = [string]$created.containerId
      }
    }
    $owners.Add([pscustomobject]@{Owner=$owner;CreatedContainerId=$createdId;OwnerPath=$file.FullName})
  }
  return $owners.ToArray()
}

function Recover-StaleDockerClient {
  $ids = @(Get-DockerContainerIdsByExactName -Name (Get-DockerClientContainerName))
  if ($ids.Count -eq 0) {
    $daemonHealth = Invoke-DockerCapture -Purpose 'docker-daemon-health-after-cleanup' -Arguments @('version','--format','{{.Server.Version}}')
    if ($daemonHealth.Stdout -notmatch '^\d+\.\d+\.\d+') { throw 'Docker daemon health could not be proven before recovery.' }
    return
  }
  if ($ids.Count -ne 1) { throw 'Docker stale recovery exact-name lookup returned multiple containers.' }
  $identityResult = Invoke-DockerCapture -Purpose 'docker-stale-identity' -Arguments @('container','inspect',$ids[0],'--format','{{json .}}')
  $identity = $identityResult.Stdout | ConvertFrom-Json
  $actualContainerId = [string]$identity.Id
  if ($actualContainerId -notmatch '^[0-9a-f]{64}$') { throw 'Docker stale recovery did not resolve the exact full container ID.' }
  $labelProperty = $identity.Config.Labels.PSObject.Properties['beginner-budget.preview-v2-live-runner']
  $labelValue = if($null -eq $labelProperty){''}else{[string]$labelProperty.Value}
  $matchingOwners = @(Get-ValidDockerIntentOwners | Where-Object {
    [string]$_.Owner.ownershipNonce -ceq $labelValue -and [string]$_.Owner.imageId -ceq [string]$identity.Image -and
    [string]$_.Owner.containerName -ceq ([string]$identity.Name).TrimStart('/')
  })
  if ($matchingOwners.Count -ne 1) { throw 'Docker stale container has no unique durable hash-verified ownership record.' }
  $intent = $matchingOwners[0]
  $removed = Remove-ExactOwnedDockerContainer -ContainerName $intent.Owner.containerName -Nonce $intent.Owner.ownershipNonce -ImageId $intent.Owner.imageId -ExpectedContainerId $intent.CreatedContainerId
  Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory ('docker-stale-recovery-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'.json')) -Content ([ordered]@{
    intentGeneration=$intent.Owner.intentGeneration;ownerRecordSha256=$intent.Owner.recordSha256;purpose=$intent.Owner.purpose
    containerName=$intent.Owner.containerName;containerId=$actualContainerId;ownershipNonce=$intent.Owner.ownershipNonce;imageId=$intent.Owner.imageId
    removed=[bool]$removed;recoveredAtUtc=[DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json)
}

function Copy-SslRootCertificateToDockerClient {
  if ([string]::IsNullOrWhiteSpace($dockerClientContainerId)) { throw 'Docker client is not initialized for CA staging.' }
  if ([string]::IsNullOrWhiteSpace($sslRootCertificateResolvedPath) -or $sslRootCertificateSha256 -notmatch '^[0-9a-f]{64}$') {
    throw 'SslRootCertificate was not validated before Docker CA staging.'
  }
  $script:dockerSslRootCertificateVerified = $false
  $null = Invoke-DockerCapture -Purpose 'docker-ca-copy' -Arguments @('cp',$sslRootCertificateResolvedPath,"${dockerClientContainerId}:$dockerSslRootCertificatePath")
  $containerHashResult = Invoke-DockerCapture -Purpose 'docker-ca-sha256' -Arguments @('exec',$dockerClientContainerId,'sha256sum',$dockerSslRootCertificatePath)
  if ($containerHashResult.Stdout -notmatch '^([0-9a-f]{64})\s+' -or $Matches[1] -cne $sslRootCertificateSha256) {
    throw 'docker-ca-host-container-sha256-match failed.'
  }
  $null = Invoke-DockerCapture -Purpose 'docker-ca-read-only' -Arguments @('exec',$dockerClientContainerId,'chmod','0444',$dockerSslRootCertificatePath)
  Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory ('ssl-root-certificate-'+$dockerClientPurpose+'-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'.json')) -Content ([ordered]@{
    sha256=$sslRootCertificateSha256;byteLength=$sslRootCertificateLength;containerPath=$dockerSslRootCertificatePath;verifiedAtUtc=[DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json)
  $script:dockerSslRootCertificateVerified = $true
}

function New-OwnedDockerClient {
  param([Parameter(Mandatory)][ValidateSet('workload','recovery-control','cleanup-control')][string]$Purpose)
  if (@(Get-DockerContainerIdsByExactName -Name $dockerClientContainerName).Count -ne 0) { throw 'Docker client container name is already occupied without a validated recovery intent.' }
  $script:dockerClientPurpose = $Purpose
  $script:dockerClientRemovalVerified = $false
  $script:dockerSslRootCertificateVerified = $false
  $script:dockerClientNonce = [Guid]::NewGuid().ToString('N')
  $script:dockerIntentGeneration = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + $dockerClientNonce
  $ownerRecord = Write-DockerIntentRecord -Sequence 1 -State owner -ContainerId '' -PreviousRecordSha256 ('0' * 64)
  $script:dockerIntentOwnerRecordSha256 = $ownerRecord.RecordSha256
  $label = "beginner-budget.preview-v2-live-runner=$dockerClientNonce"
  $create = Invoke-DockerCapture -Purpose 'docker-client-create' -Arguments @('container','create','--name',$dockerClientContainerName,'--label',$label,'--mount','type=tmpfs,destination=/var/lib/postgresql/data','--entrypoint','sleep',$dockerImageId,'infinity')
  if ($create.Stdout -notmatch '^[0-9a-f]{64}$') { throw 'Docker returned an invalid client container ID.' }
  $script:dockerClientContainerId = $create.Stdout
  $null = Write-DockerIntentRecord -Sequence 2 -State created -ContainerId $dockerClientContainerId -PreviousRecordSha256 $dockerIntentOwnerRecordSha256
  Assert-DockerContainerIdentity -ContainerId $dockerClientContainerId -ContainerName $dockerClientContainerName -Nonce $dockerClientNonce -ImageId $dockerImageId
  $started = Invoke-DockerCapture -Purpose 'docker-client-start' -Arguments @('container','start',$dockerClientContainerId)
  if ($started.Stdout -cne $dockerClientContainerId) { throw 'Docker did not start the exact owned client container.' }
  Copy-SslRootCertificateToDockerClient
  $version = Invoke-DockerCapture -Purpose 'docker-psql-version' -Arguments @('exec',$dockerClientContainerId,'psql','--version')
  if ($version.Stdout -cne 'psql (PostgreSQL) 17.6') { throw 'Docker client psql version is not exactly PostgreSQL 17.6.' }
  Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory ('docker-client-'+$Purpose+'.json')) -Content ([ordered]@{
    clientMode='Docker';purpose=$Purpose;dockerContextName=$dockerContextName;dockerContextEndpoint=$dockerContextEndpoint;dockerContextSnapshotSha256=$dockerContextSnapshotSha256;imageReference=$dockerImageReference;imageId=$dockerImageId;repoDigest=$dockerRepoDigest;imageSnapshotSha256=$dockerImageSnapshotSha256;imageImmutableIdentitySha256=$dockerImageImmutableIdentitySha256;containerName=$dockerClientContainerName
    containerId=$dockerClientContainerId;ownershipNonce=$dockerClientNonce;psqlVersion=$version.Stdout;createdAtUtc=[DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json)
}

function Initialize-DockerClient {
  $script:dockerPath = (Get-Command docker.exe -CommandType Application -ErrorAction Stop).Source
  Initialize-LocalDockerContext
  $script:dockerClientContainerName = Get-DockerClientContainerName
  if ($RecoveryOnly) {
    # Ownership intents are sufficient to reclaim a pre-manifest crash. No DB
    # operation is possible until the later manifest and immutable image gates.
    Recover-StaleDockerClient
    Initialize-SslRootCertificate
    Load-RecoveryEvidence
    $snapshotResult = Invoke-DockerCapture -Purpose 'docker-image-single-snapshot' -Arguments @('image','inspect',$dockerImageId)
  } else {
    Initialize-SslRootCertificate
    $snapshotResult = Invoke-DockerCapture -Purpose 'docker-image-single-snapshot' -Arguments @('image','inspect',$dockerImageReference)
  }
  $parsedSnapshot = ConvertFrom-Json -InputObject $snapshotResult.Stdout
  $snapshotRows = @($parsedSnapshot)
  if ($snapshotRows.Count -ne 1) { throw 'postgres:17.6-alpine must resolve to one image in a single inspect snapshot.' }
  $imageSnapshot = $snapshotRows[0]
  if ([string]$imageSnapshot.Id -notmatch '^sha256:[0-9a-f]{64}$') { throw 'postgres:17.6-alpine is not present with an immutable image ID; the runner never pulls images.' }
  if($RecoveryOnly){
    $digestMatches = @(([string[]]$imageSnapshot.RepoDigests) | Where-Object { $_ -ceq $dockerRepoDigest })
    if ($digestMatches.Count -ne 1) { throw 'RecoveryOnly persisted postgres digest is not bound to the immutable image ID.' }
  }else{
    $digestMatches = @(([string[]]$imageSnapshot.RepoDigests) | Where-Object { $_ -match '^postgres@sha256:[0-9a-f]{64}$' })
    if ($digestMatches.Count -ne 1) { throw 'postgres:17.6-alpine must resolve to exactly one immutable postgres@sha256 digest.' }
    $tagMatches = @(([string[]]$imageSnapshot.RepoTags) | Where-Object { $_ -ceq $dockerImageReference })
    if ($tagMatches.Count -ne 1) { throw 'single image snapshot does not contain the exact pinned local tag.' }
  }
  $labelsProperty = $imageSnapshot.Config.PSObject.Properties['Labels']
  $snapshotLabels = if($null -eq $labelsProperty){$null}else{$labelsProperty.Value}
  $snapshotEvidence = [ordered]@{imageReference=$dockerImageReference;imageId=[string]$imageSnapshot.Id;repoDigests=@([string[]]$imageSnapshot.RepoDigests|Sort-Object);repoTags=@([string[]]$imageSnapshot.RepoTags|Sort-Object);labels=$snapshotLabels}
  $snapshotContent = $snapshotEvidence | ConvertTo-Json -Depth 8
  $snapshotName = if($RecoveryOnly){'docker-image-snapshot-recovery-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'.json'}else{'docker-image-snapshot.json'}
  $script:dockerImageSnapshotPath = Join-Path $EvidenceDirectory $snapshotName
  Write-DurableNewFile -Path $dockerImageSnapshotPath -Content $snapshotContent
  $script:dockerImageSnapshotSha256 = Get-FileSha256Hex -Path $dockerImageSnapshotPath
  $observedImageId = [string]$imageSnapshot.Id
  $observedRepoDigest = [string]$digestMatches[0]
  $observedIdentitySha256 = Get-DockerImmutableIdentitySha256 -ImageId $observedImageId -RepoDigest $observedRepoDigest
  if($RecoveryOnly){
    if($observedImageId -cne $dockerImageId -or $observedRepoDigest -cne $dockerRepoDigest -or $observedIdentitySha256 -cne $dockerImageImmutableIdentitySha256){throw 'RecoveryOnly Docker immutable image identity mismatch.'}
  }else{
    $script:dockerImageId = $observedImageId
    $script:dockerRepoDigest = $observedRepoDigest
    $script:dockerImageImmutableIdentitySha256 = $observedIdentitySha256
  }
  $initialPurpose = if($RecoveryOnly){'recovery-control'}else{'workload'}
  New-OwnedDockerClient -Purpose $initialPurpose
}

function Assert-OwnedDockerClient {
  if ([string]::IsNullOrWhiteSpace($dockerClientContainerId) -or [string]::IsNullOrWhiteSpace($dockerClientContainerName) -or [string]::IsNullOrWhiteSpace($dockerClientNonce)) { throw 'Docker client ownership is not initialized.' }
  Assert-DockerContainerIdentity -ContainerId $dockerClientContainerId -ContainerName $dockerClientContainerName -Nonce $dockerClientNonce -ImageId $dockerImageId
}

function Remove-OwnedDockerClient {
  if ([string]::IsNullOrWhiteSpace($dockerClientContainerId)) { return }
  $containerId = $dockerClientContainerId
  if ($containerId -cne $dockerClientContainerId) { throw 'Docker cleanup container ID changed.' }
  $removed = Remove-ExactOwnedDockerContainer -ContainerName $dockerClientContainerName -Nonce $dockerClientNonce -ImageId $dockerImageId -ExpectedContainerId $containerId
  if (-not $removed) { throw 'Docker owned client disappeared before exact cleanup verification.' }
  Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory ('docker-client-removed-'+$dockerClientPurpose+'-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ')+'.json')) -Content ([ordered]@{purpose=$dockerClientPurpose;containerId=$containerId;containerName=$dockerClientContainerName;ownershipNonce=$dockerClientNonce;removedAtUtc=[DateTime]::UtcNow.ToString('o')}|ConvertTo-Json)
  $script:dockerClientRemovalVerified = $true
  $script:dockerClientContainerId = $null
}

function Reset-DockerClientForCleanup {
  Remove-OwnedDockerClient
  $script:preparedSqlFiles = @{}
  New-OwnedDockerClient -Purpose 'cleanup-control'
}

function Load-RecoveryEvidence {
  foreach($required in @($manifestPath,$baselineInvariantPath,$baselineUserAPath,$recoverySqlPath,$ledgerPath,$originalDockerImageSnapshotPath)){if(-not(Test-Path -LiteralPath $required)){throw "RecoveryOnly evidence is missing: $required"}}
  $script:manifest=Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestPath|ConvertFrom-Json
  if($manifest.projectRef -cne $ProjectRef -or $manifest.runId -cne $RunId -or $manifest.qaMarker -cne $QaMarker -or $manifest.qaUserA -cne $QaUserA.ToLowerInvariant() -or $manifest.qaUserB -cne $QaUserB.ToLowerInvariant()){throw 'RecoveryOnly parameters do not exactly match the recovery manifest.'}
  if ($manifest.dockerContextName -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' -or
      $manifest.dockerContextEndpoint -notmatch '^npipe:/{4}\./pipe/(?:docker_engine|dockerDesktopLinuxEngine)$' -or
      $manifest.dockerContextSnapshotSha256 -notmatch '^[0-9a-f]{64}$' -or
      [string]$manifest.dockerContextName -cne $dockerContextName -or
      [string]$manifest.dockerContextEndpoint -cne $dockerContextEndpoint -or
      [string]$manifest.dockerContextSnapshotSha256 -cne $dockerContextSnapshotSha256) {
    throw 'RecoveryOnly local Docker context binding mismatch.'
  }
  foreach($phase in $fixtures.Keys){
    $savedProperty = $manifest.fixtures.PSObject.Properties[$phase]
    $saved = if ($null -eq $savedProperty) { $null } else { $savedProperty.Value }
    $derived=$fixtures[$phase]
    if($null -eq $saved -or $saved.transactionId -cne $derived.transactionId -or $saved.templateId -cne $derived.templateId -or $saved.memoA -cne $derived.memoA -or $saved.memoB -cne $derived.memoB){throw "RecoveryOnly fixture mismatch: $phase"}
  }
  if ($manifest.cleanupSqlSha256 -notmatch '^[0-9a-f]{64}$') { throw 'RecoveryOnly cleanupSqlSha256 is missing or invalid.' }
  $script:expectedCleanupSqlSha256 = [string]$manifest.cleanupSqlSha256
  $script:invariantBefore=(Get-Content -Raw -Encoding UTF8 -LiteralPath $baselineInvariantPath).Trim()
  $script:userACanonicalBefore=(Get-Content -Raw -Encoding UTF8 -LiteralPath $baselineUserAPath).Trim()
  if ($manifest.baselineInvariantSha256 -notmatch '^[0-9a-f]{64}$' -or (Get-FileSha256Hex -Path $baselineInvariantPath) -cne [string]$manifest.baselineInvariantSha256) { throw 'RecoveryOnly baseline invariant integrity mismatch.' }
  if ($manifest.baselineUserASha256 -notmatch '^[0-9a-f]{64}$' -or (Get-FileSha256Hex -Path $baselineUserAPath) -cne [string]$manifest.baselineUserASha256) { throw 'RecoveryOnly QA A baseline integrity mismatch.' }
  if ($manifest.imageSnapshotSha256 -notmatch '^[0-9a-f]{64}$' -or (Get-FileSha256Hex -Path $originalDockerImageSnapshotPath) -cne [string]$manifest.imageSnapshotSha256) { throw 'RecoveryOnly Docker image single-snapshot integrity mismatch.' }
  if ($manifest.imageId -notmatch '^sha256:[0-9a-f]{64}$' -or $manifest.repoDigest -notmatch '^postgres@sha256:[0-9a-f]{64}$' -or $manifest.imageImmutableIdentitySha256 -notmatch '^[0-9a-f]{64}$') { throw 'RecoveryOnly Docker immutable image manifest fields are invalid.' }
  $originalSnapshotRows = @((Get-Content -Raw -Encoding UTF8 -LiteralPath $originalDockerImageSnapshotPath | ConvertFrom-Json))
  if ($originalSnapshotRows.Count -ne 1 -or [string]$originalSnapshotRows[0].imageId -cne [string]$manifest.imageId -or
      @([string[]]$originalSnapshotRows[0].repoDigests | Where-Object { $_ -ceq [string]$manifest.repoDigest }).Count -ne 1) {
    throw 'RecoveryOnly Docker original image snapshot binding mismatch.'
  }
  $expectedIdentitySha = Get-DockerImmutableIdentitySha256 -ImageId ([string]$manifest.imageId) -RepoDigest ([string]$manifest.repoDigest)
  if($expectedIdentitySha -cne [string]$manifest.imageImmutableIdentitySha256){throw 'RecoveryOnly Docker immutable image manifest hash mismatch.'}
  if ($manifest.sslRootCertificateSha256 -notmatch '^[0-9a-f]{64}$' -or [string]$manifest.sslRootCertificateSha256 -cne $sslRootCertificateSha256) {
    throw 'RecoveryOnly SslRootCertificate SHA256 does not match the original manifest.'
  }
  $script:dockerImageId=[string]$manifest.imageId
  $script:dockerRepoDigest=[string]$manifest.repoDigest
  $script:dockerImageImmutableIdentitySha256=[string]$manifest.imageImmutableIdentitySha256
  $script:dockerImageSnapshotSha256=[string]$manifest.imageSnapshotSha256
}

function Copy-SqlToDockerClient {
  param([Parameter(Mandatory)][string]$SqlPath,[Parameter(Mandatory)][string]$Purpose)
  Assert-OwnedDockerClient
  $hostHash = Get-FileSha256Hex -Path $SqlPath
  $containerPath = "/tmp/$Purpose.sql"
  $null = Invoke-DockerCapture -Purpose "docker-cp-$Purpose" -Arguments @('cp',$SqlPath,"${dockerClientContainerId}:$containerPath")
  $containerHash = (Invoke-DockerCapture -Purpose "docker-sha256-$Purpose" -Arguments @('exec',$dockerClientContainerId,'sha256sum',$containerPath)).Stdout
  if ($containerHash -notmatch '^([0-9a-f]{64})\s+' -or $Matches[1] -cne $hostHash) {
    throw "docker-host-container-sha256-match failed: $Purpose"
  }
  return $containerPath
}

function Prepare-PsqlFile {
  param([Parameter(Mandatory)][string]$SqlPath)
  $resolvedSql = (Resolve-Path -LiteralPath $SqlPath).Path
  $allowedPrefix = $EvidenceDirectory.TrimEnd('\') + '\'
  if (-not $resolvedSql.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'SQL preparation is limited to the evidence directory.' }
  $hostHash = Get-FileSha256Hex -Path $resolvedSql
  $purpose = ([System.IO.Path]::GetFileNameWithoutExtension($resolvedSql)) + '-' + $hostHash.Substring(0,12)
  $containerSql = Copy-SqlToDockerClient -SqlPath $resolvedSql -Purpose $purpose
  $script:preparedSqlFiles[$resolvedSql] = [pscustomobject]@{ContainerPath=$containerSql;HostSha256=$hostHash}
  return $containerSql
}

function Start-PsqlFile {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$SqlPath,
    [Parameter(Mandatory)][string]$StdoutPath,
    [Parameter(Mandatory)][string]$StderrPath,
    [Parameter(Mandatory)][ValidatePattern('^[a-z0-9-]{1,63}$')][string]$ApplicationName
  )
  $resolvedSql = (Resolve-Path -LiteralPath $SqlPath).Path
  if (-not $dockerSslRootCertificateVerified) { throw 'Docker CA hash verification must pass before psql starts.' }
  $allowedPrefix = $EvidenceDirectory.TrimEnd('\') + '\'
  if (-not $resolvedSql.StartsWith($allowedPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'psql may execute only fixed SQL files inside the evidence directory.'
  }
  $psqlArguments = @(
    '-X', '-W', '--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--quiet', '--tuples-only', '--no-align',
    '--host', $PgHost, '--port', $PgPort, '--dbname', $PgDatabase, '--username', $PgUser,
    '-f'
  )
  if (-not $preparedSqlFiles.ContainsKey($resolvedSql)) { throw 'SQL was not pre-staged before execution.' }
  $prepared = $preparedSqlFiles[$resolvedSql]
  if ($prepared.HostSha256 -cne (Get-FileSha256Hex -Path $resolvedSql)) { throw 'pre-staged SQL changed before execution.' }
  $containerSql = $prepared.ContainerPath
  $startFile = $dockerPath
  $startArguments = @('--host',$dockerContextEndpoint) + @('exec','-i','--env',"PGSSLMODE=$PgSslMode",'--env',"PGSSLROOTCERT=$dockerSslRootCertificatePath",'--env','PGCONNECT_TIMEOUT=3','--env',"PGAPPNAME=$ApplicationName",$dockerClientContainerId,'psql') + $psqlArguments + @($containerSql)
  $start = [System.Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $startFile
  $start.Arguments = (($startArguments | ForEach-Object { Quote-ProcessArgument ([string]$_) }) -join ' ')
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardInput = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  $start.WorkingDirectory = $repoRoot
  foreach ($unsafeName in @($start.EnvironmentVariables.Keys | Where-Object { ([string]$_) -match '^PG' })) {
    $null = $start.EnvironmentVariables.Remove($unsafeName)
  }
  foreach ($unsafeName in $unsafeDockerEnvironmentNames) {
    $null = $start.EnvironmentVariables.Remove($unsafeName)
  }

  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo = $start
  if (-not $process.Start()) { throw "failed to start psql: $Name" }
  $ownedProcesses.Add($process)
  if ($credentialPointer -eq [IntPtr]::Zero -or $null -eq $securePassword) {
    Stop-OwnedProcess -Process $process
    throw 'credential transport is not initialized.'
  }
  for ($offset = 0; $offset -lt $securePassword.Length; $offset++) {
    $character = [char][Runtime.InteropServices.Marshal]::ReadInt16($credentialPointer, $offset * 2)
    $process.StandardInput.Write($character)
    $character = [char]0
  }
  $process.StandardInput.WriteLine()
  $process.StandardInput.Close()
  return [pscustomobject]@{
    Name=$Name; Process=$process
    OutputTask=$process.StandardOutput.ReadToEndAsync()
    ErrorTask=$process.StandardError.ReadToEndAsync()
    StdoutPath=$StdoutPath; StderrPath=$StderrPath
  }
}

function Complete-Psql {
  param(
    [Parameter(Mandatory)]$Handle,
    [int[]]$AllowedExitCodes = @(0),
    [int]$TimeoutSeconds = $WorkerDeadlineSeconds
  )
  if (-not $Handle.Process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-OwnedProcess -Process $Handle.Process
    throw "bounded psql deadline exceeded: $($Handle.Name)"
  }
  $Handle.Process.Refresh()
  $stdout = $Handle.OutputTask.GetAwaiter().GetResult()
  $stderr = $Handle.ErrorTask.GetAwaiter().GetResult()

  # Credentials are never materialized as a managed string, so compare every
  # captured character to the unmanaged SecureString before writing evidence.
  foreach ($captured in @($stdout, $stderr)) {
    if ($captured.Length -ge $securePassword.Length -and $securePassword.Length -gt 0) {
      for ($start = 0; $start -le $captured.Length - $securePassword.Length; $start++) {
        $same = $true
        for ($i = 0; $i -lt $securePassword.Length; $i++) {
          if ($captured[$start + $i] -ne [char][Runtime.InteropServices.Marshal]::ReadInt16($credentialPointer, $i * 2)) { $same = $false; break }
        }
        if ($same) { throw "credential appeared in captured psql output: $($Handle.Name)" }
      }
    }
  }
  Write-Utf8NoBom -Path $Handle.StdoutPath -Content $stdout
  Write-Utf8NoBom -Path $Handle.StderrPath -Content $stderr
  if ($stderr -match '(?i)40P01|55P03|57014|deadlock detected|statement timeout|lock timeout') {
    throw "forbidden timeout/deadlock SQLSTATE: $($Handle.Name)"
  }
  if ($AllowedExitCodes -notcontains $Handle.Process.ExitCode) {
    throw "psql failed: $($Handle.Name) exit=$($Handle.Process.ExitCode)"
  }
  return [pscustomobject]@{Name=$Handle.Name;ExitCode=$Handle.Process.ExitCode;Stdout=$stdout.Trim();Stderr=$stderr.Trim()}
}

function Get-ExactSqlStateErrors {
  param([Parameter(Mandatory)][string]$Stderr)
  $states = New-Object System.Collections.Generic.List[string]
  foreach ($line in ($Stderr -split '\r?\n')) {
    $trimmed = $line.Trim()
    if ($trimmed -cmatch '(?:^|:\s*)(?:ERROR|FATAL):\s+([0-9A-Z]{5})$') { $states.Add($Matches[1]) }
    elseif ($trimmed -cmatch '(?:^|:\s*)(?:ERROR|FATAL):') { $states.Add('UNPARSEABLE') }
  }
  return @($states)
}

function New-PsqlPlan {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Sql,
    [Parameter(Mandatory)][string]$ApplicationName,
    [string]$Directory = $EvidenceDirectory
  )
  if (-not (Test-Path -LiteralPath $Directory)) { New-Item -ItemType Directory -Path $Directory | Out-Null }
  $sqlPath = Join-Path $Directory ($Name + '.sql')
  Write-Utf8NoBom -Path $sqlPath -Content ("\set VERBOSITY sqlstate`n" + $Sql)
  $null = Prepare-PsqlFile -SqlPath $sqlPath
  return [pscustomobject]@{
    Name=$Name;SqlPath=$sqlPath;ApplicationName=$ApplicationName
    StdoutPath=(Join-Path $Directory ($Name + '.stdout.txt'))
    StderrPath=(Join-Path $Directory ($Name + '.stderr.txt'))
  }
}

function Start-PsqlPlan {
  param([Parameter(Mandatory)]$Plan)
  return Start-PsqlFile -Name $Plan.Name -SqlPath $Plan.SqlPath -StdoutPath $Plan.StdoutPath -StderrPath $Plan.StderrPath -ApplicationName $Plan.ApplicationName
}

function Invoke-PsqlPlan {
  param([Parameter(Mandatory)]$Plan,[int[]]$AllowedExitCodes=@(0),[int]$TimeoutSeconds=$WorkerDeadlineSeconds)
  $handle = Start-PsqlPlan -Plan $Plan
  return Complete-Psql -Handle $handle -AllowedExitCodes $AllowedExitCodes -TimeoutSeconds $TimeoutSeconds
}

function Invoke-Psql {
  param(
    [Parameter(Mandatory)][string]$Name,
    [Parameter(Mandatory)][string]$Sql,
    [int[]]$AllowedExitCodes=@(0),
    [int]$TimeoutSeconds=$WorkerDeadlineSeconds
  )
  $applicationName = Get-AuxiliaryApplicationName -Name $Name
  $plan = New-PsqlPlan -Name $Name -Sql $Sql -ApplicationName $applicationName
  return Invoke-PsqlPlan -Plan $plan -AllowedExitCodes $AllowedExitCodes -TimeoutSeconds $TimeoutSeconds
}

function Get-RemainingProbeSeconds {
  param([Parameter(Mandatory)][DateTime]$Deadline)
  $remaining=[Math]::Floor(($Deadline-[DateTime]::UtcNow).TotalSeconds)
  if($remaining -lt 1){return 0}
  return [Math]::Min(4,[int]$remaining)
}

function Get-InvariantSql {
  return @'
set timezone to 'UTC'; set statement_timeout = '15s'; set lock_timeout = '3s';
do $preview_v2_invariant$
declare
  v_preview_v1_settings jsonb;
  v_preview_v1_transactions jsonb;
  v_invariant jsonb;
begin
  if to_regclass('public.preview_budget_settings') is null then
    v_preview_v1_settings := jsonb_build_object('relation_state','ABSENT','count',0,'invariant_hash',null);
  else
    execute $preview_v1_settings_query$
      select jsonb_build_object(
        'relation_state','EXISTS',
        'count',count(*),
        'invariant_hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),''))
      ) from public.preview_budget_settings r
    $preview_v1_settings_query$ into v_preview_v1_settings;
  end if;

  if to_regclass('public.preview_transactions') is null then
    v_preview_v1_transactions := jsonb_build_object('relation_state','ABSENT','count',0,'invariant_hash',null);
  else
    execute $preview_v1_transactions_query$
      select jsonb_build_object(
        'relation_state','EXISTS',
        'count',count(*),
        'invariant_hash',md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),''))
      ) from public.preview_transactions r
    $preview_v1_transactions_query$ into v_preview_v1_transactions;
  end if;

  v_invariant := jsonb_build_object(
    'production.settings', jsonb_build_object('count',(select count(*) from public.budget_settings),'invariant_hash',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from public.budget_settings r)),
    'production.transactions', jsonb_build_object('count',(select count(*) from public.transactions),'invariant_hash',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from public.transactions r)),
    'preview_v1.settings', v_preview_v1_settings,
    'preview_v1.transactions', v_preview_v1_transactions,
    'preview_v2.seed_metadata', jsonb_build_object('count',(select count(*) from public.preview_v2_seed_metadata),'full_hash',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\n' order by to_jsonb(r)::text),'')) from public.preview_v2_seed_metadata r))
  );
  perform set_config('preview_v2.live.invariant',v_invariant::text,false);
end;
$preview_v2_invariant$;
select current_setting('preview_v2.live.invariant');
'@
}

function Assert-InvariantSnapshotEqual {
  param([Parameter(Mandatory)][string]$Before,[Parameter(Mandatory)][string]$After,[Parameter(Mandatory)][string]$Context)
  if ($Before.Trim() -cne $After.Trim()) { throw "$Context changed production, V1, or seed marker count/invariant_hash/full_hash." }
}

function Assert-DisposableUsers {
  $a = ConvertTo-PsqlLiteral $QaUserA.ToLowerInvariant()
  $b = ConvertTo-PsqlLiteral $QaUserB.ToLowerInvariant()
  $sql = @'
set statement_timeout='15s';
do $disposable_user_gate$
declare
  v_user uuid;
  v_auth_count bigint;
  v_production_count bigint;
  v_preview_v1_count bigint;
  v_preview_v2_count bigint;
  v_marker_count bigint;
  v_rows jsonb := '[]'::jsonb;
begin
  foreach v_user in array array[__QA_USER_A__::uuid,__QA_USER_B__::uuid]
  loop
    select count(*) into v_auth_count from auth.users where id=v_user;
    select
      (select count(*) from public.budget_settings where user_id=v_user)+
      (select count(*) from public.transactions where user_id=v_user)
    into v_production_count;

    v_preview_v1_count := 0;
    if to_regclass('public.preview_budget_settings') is not null then
      execute 'select count(*) from public.preview_budget_settings where user_id=$1'
      into v_preview_v1_count using v_user;
    end if;
    if to_regclass('public.preview_transactions') is not null then
      execute 'select $1 + count(*) from public.preview_transactions where user_id=$2'
      into v_preview_v1_count using v_preview_v1_count,v_user;
    end if;

    select
      (select count(*) from public.preview_v2_budget_settings where user_id=v_user)+
      (select count(*) from public.preview_v2_transactions where user_id=v_user)
    into v_preview_v2_count;
    select count(*) into v_marker_count
    from public.preview_v2_seed_metadata where seed_key='production_snapshot_v2';

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'user_id',v_user,
      'auth_count',v_auth_count,
      'production_count',v_production_count,
      'preview_v1_count',v_preview_v1_count,
      'preview_v2_count',v_preview_v2_count,
      'pre_absent',(v_production_count+v_preview_v1_count+v_preview_v2_count=0),
      'marker_count',v_marker_count
    ));
  end loop;
  perform set_config('preview_v2.live.disposable_user_gate',v_rows::text,false);
end;
$disposable_user_gate$;
select current_setting('preview_v2.live.disposable_user_gate');
'@
  $sql=$sql.Replace('__QA_USER_A__',$a).Replace('__QA_USER_B__',$b)
  $result = Invoke-Psql -Name 'disposable_user_gate' -Sql $sql
  $parsedRows = ConvertFrom-Json -InputObject $result.Stdout
  $rows = @($parsedRows)
  if ($rows.Count -ne 2) { throw 'disposable_user_gate requires two users.' }
  $rowA=@($rows|Where-Object user_id -eq $QaUserA.ToLowerInvariant())
  $rowB=@($rows|Where-Object user_id -eq $QaUserB.ToLowerInvariant())
  if($rowA.Count -ne 1 -or [int]$rowA[0].auth_count -ne 1 -or [int]$rowA[0].marker_count -ne 1){throw 'QA A and production_snapshot_v2 must each exist exactly once.'}
  if($rowB.Count -ne 1 -or [int]$rowB[0].auth_count -ne 1 -or [int]$rowB[0].marker_count -ne 1 -or [int]$rowB[0].production_count -ne 0 -or [int]$rowB[0].preview_v1_count -ne 0 -or [int]$rowB[0].preview_v2_count -ne 0){
    throw 'disposable_user_gate requires QA B to be production/V1/V2 data-absent.'
  }
}

function Initialize-Fixtures {
  foreach($phase in @('cas-stale','same-user-duplicate','cross-user-same-id')){
    $fixtures[$phase]=[ordered]@{
      transactionId=Get-DeterministicId -Phase $phase -Prefix 'tx'
      templateId=Get-DeterministicId -Phase $phase -Prefix 'rt'
      memoA="$QaMarker-$phase-a"
      memoB="$QaMarker-$phase-b"
    }
  }
}

function Assert-RunFixturesAbsent {
  $idValues=@($fixtures.Keys|ForEach-Object{ConvertTo-PsqlLiteral $fixtures[$_].transactionId})-join ','
  $marker=ConvertTo-PsqlLiteral($QaMarker+'%')
  $sql=@"
select jsonb_build_object(
 'exact_transaction_count',(select count(*) from public.preview_v2_transactions where user_id in('$( $QaUserA.ToLowerInvariant())'::uuid,'$( $QaUserB.ToLowerInvariant())'::uuid) and id in($idValues)),
 'marker_transaction_count',(select count(*) from public.preview_v2_transactions where user_id in('$( $QaUserA.ToLowerInvariant())'::uuid,'$( $QaUserB.ToLowerInvariant())'::uuid) and memo like $marker),
 'marker_template_count',(select count(*) from public.preview_v2_budget_settings s cross join lateral jsonb_array_elements(coalesce(s.category_budgets->'__recurring_expense_templates','[]'::jsonb)) t where s.user_id in('$( $QaUserA.ToLowerInvariant())'::uuid,'$( $QaUserB.ToLowerInvariant())'::uuid) and t->>'memo' like $marker)
)::text;
"@
  $result=Invoke-Psql -Name 'run-fixture-preflight-zero' -Sql $sql
  $j=$result.Stdout|ConvertFrom-Json
  if([int]$j.exact_transaction_count -ne 0 -or [int]$j.marker_transaction_count -ne 0 -or [int]$j.marker_template_count -ne 0){throw 'RunId/qaMarker fixtures already exist; use RecoveryOnly before a new run.'}
}

function Get-UserV2CanonicalSql {
  param([Parameter(Mandatory)][string]$UserId)
  $user=ConvertTo-PsqlLiteral $UserId
  return "select jsonb_build_object('settings_count',(select count(*) from public.preview_v2_budget_settings where user_id=$user::uuid),'settings_hash',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')) from public.preview_v2_budget_settings r where user_id=$user::uuid),'transaction_count',(select count(*) from public.preview_v2_transactions where user_id=$user::uuid),'transaction_hash',(select md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' order by to_jsonb(r)::text),'')) from public.preview_v2_transactions r where user_id=$user::uuid))::text;"
}

function Get-ApplicationName {
  param([Parameter(Mandatory)][string]$Phase,[Parameter(Mandatory)][string]$Participant)
  $sha=[System.Security.Cryptography.SHA256]::Create()
  try{$hash=$sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$RunId`:$QaMarker"))}
  finally{$sha.Dispose()}
  $runHash=(($hash|ForEach-Object{$_.ToString('x2')})-join '').Substring(0,12)
  return "pv2-$runHash-$Phase-$Participant"
}

function Get-AuxiliaryApplicationName {
  param([Parameter(Mandatory)][string]$Name)
  $sha=[System.Security.Cryptography.SHA256]::Create()
  try{$hash=$sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes("$RunId`:$QaMarker`:$Name"))}
  finally{$sha.Dispose()}
  $suffix=(($hash|ForEach-Object{$_.ToString('x2')})-join '').Substring(0,16)
  return "pv2-aux-$suffix"
}

function Get-RunApplicationNames {
  $names = New-Object System.Collections.Generic.List[string]
  foreach ($phase in @('cas-stale','same-user-duplicate','cross-user-same-id')) {
    foreach ($participant in @('worker-a','worker-b','controller')) {
      $names.Add((Get-ApplicationName -Phase $phase -Participant $participant))
    }
  }
  return @($names)
}

function Stop-RunServerBackends {
  # A local psql/docker client can disappear while its server backend continues.
  # Terminate only the nine exact application names derived from this run, then
  # prove that all of them are absent before cleanup is allowed to issue DML.
  $workerApps = New-Object System.Collections.Generic.List[string]
  $controllerApps = New-Object System.Collections.Generic.List[string]
  foreach ($phase in @('cas-stale','same-user-duplicate','cross-user-same-id')) {
    $workerApps.Add((Get-ApplicationName -Phase $phase -Participant 'worker-a'))
    $workerApps.Add((Get-ApplicationName -Phase $phase -Participant 'worker-b'))
    $controllerApps.Add((Get-ApplicationName -Phase $phase -Participant 'controller'))
  }
  $workerLiterals = (($workerApps | ForEach-Object { ConvertTo-PsqlLiteral $_ }) -join ',')
  $allLiterals = ((@($workerApps) + @($controllerApps) | ForEach-Object { ConvertTo-PsqlLiteral $_ }) -join ',')
  $ownedFilter = "datname=current_database() and usename=current_user and backend_type='client backend' and pid <> pg_catalog.pg_backend_pid()"
  $deadline = [DateTime]::UtcNow.AddSeconds($ObservationDeadlineSeconds)
  $attempt = 0
  do {
    $attempt++
    $probeSeconds = Get-RemainingProbeSeconds -Deadline $deadline
    if ($probeSeconds -eq 0) { break }
    $workerTerminationSql = @"
set statement_timeout='${probeSeconds}s';
with owned as (
 select pid,application_name from pg_catalog.pg_stat_activity
 where application_name in ($workerLiterals) and $ownedFilter
), killed as (
 select pid,application_name,pg_catalog.pg_terminate_backend(pid) as terminated from owned
)
select jsonb_build_object('attempt',$attempt,'owned_count',(select count(*) from owned),'owned_pids',coalesce((select jsonb_agg(pid order by pid) from owned),'[]'::jsonb),'terminated_count',(select count(*) from killed where terminated))::text;
"@
    $termination = Invoke-Psql -Name "server-worker-terminate-$attempt" -Sql $workerTerminationSql -TimeoutSeconds $probeSeconds
    $terminationEvidence = $termination.Stdout | ConvertFrom-Json
    Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory "server-worker-terminate-$attempt.json") -Content ($terminationEvidence | ConvertTo-Json -Depth 4)

    $probeSeconds = Get-RemainingProbeSeconds -Deadline $deadline
    if ($probeSeconds -eq 0) { break }
    $drain = Invoke-Psql -Name "server-worker-drain-$attempt" -Sql ("set statement_timeout='${probeSeconds}s';select jsonb_build_object('remaining_count',count(*),'remaining_pids',coalesce(jsonb_agg(pid order by pid),'[]'::jsonb))::text from pg_catalog.pg_stat_activity where application_name in ($workerLiterals) and $ownedFilter;") -TimeoutSeconds $probeSeconds
    $drainEvidence = $drain.Stdout | ConvertFrom-Json
    Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory "server-worker-drain-$attempt.json") -Content ($drainEvidence | ConvertTo-Json -Depth 4)
    if ([int]$drainEvidence.remaining_count -eq 0) { break }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  if ($null -eq $drainEvidence -or [int]$drainEvidence.remaining_count -ne 0) { throw 'run-scoped worker backends did not reach zero before controller release.' }

  $probeSeconds = Get-RemainingProbeSeconds -Deadline $deadline
  if ($probeSeconds -eq 0) { throw 'server backend cleanup deadline expired before controller termination.' }
  $controllerTerminationSql = @"
set statement_timeout='${probeSeconds}s';
with owned as (
 select pid,application_name from pg_catalog.pg_stat_activity
 where application_name in ($allLiterals) and $ownedFilter
), killed as (
 select pid,application_name,pg_catalog.pg_terminate_backend(pid) as terminated from owned
)
select jsonb_build_object('owned_count',(select count(*) from owned),'owned_pids',coalesce((select jsonb_agg(pid order by pid) from owned),'[]'::jsonb),'terminated_count',(select count(*) from killed where terminated))::text;
"@
  $controllerTermination = Invoke-Psql -Name 'server-controller-terminate' -Sql $controllerTerminationSql -TimeoutSeconds $probeSeconds
  Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory 'server-controller-terminate.json') -Content (($controllerTermination.Stdout | ConvertFrom-Json) | ConvertTo-Json -Depth 4)
  do {
    $probeSeconds = Get-RemainingProbeSeconds -Deadline $deadline
    if ($probeSeconds -eq 0) { break }
    $allDrain = Invoke-Psql -Name 'server-all-drain' -Sql ("set statement_timeout='${probeSeconds}s';select jsonb_build_object('remaining_count',count(*),'remaining_pids',coalesce(jsonb_agg(pid order by pid),'[]'::jsonb))::text from pg_catalog.pg_stat_activity where application_name in ($allLiterals) and $ownedFilter;") -TimeoutSeconds $probeSeconds
    $allDrainEvidence = $allDrain.Stdout | ConvertFrom-Json
    Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory 'server-all-drain.json') -Content ($allDrainEvidence | ConvertTo-Json -Depth 4)
    if ([int]$allDrainEvidence.remaining_count -eq 0) { return }
    Start-Sleep -Milliseconds 50
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'run-scoped worker/controller backends did not reach zero before cleanup.'
}

function Get-WorkerPrelude {
  param([string]$Phase,[string]$Participant,[Int64]$Key,[string]$UserId)
  $app = ConvertTo-PsqlLiteral (Get-ApplicationName -Phase $Phase -Participant $Participant)
  $user = ConvertTo-PsqlLiteral $UserId
  return @"
set timezone to 'UTC'; set statement_timeout='${WorkerDeadlineSeconds}s'; set lock_timeout='${WorkerDeadlineSeconds}s'; set idle_in_transaction_session_timeout='${WorkerDeadlineSeconds}s';
do `$app_self`$ begin if current_setting('application_name') <> $app then raise exception 'startup application_name self-check failed' using errcode='42501'; end if; end; `$app_self`$;
begin;
select set_config('request.jwt.claim.sub',$user,true); set local role authenticated;
do `$auth_self`$ begin if current_user <> 'authenticated' or auth.uid() is distinct from $user::uuid then raise exception 'authenticated self-check failed' using errcode='42501'; end if; end; `$auth_self`$;
select pg_backend_pid() as worker_pid;
select pg_catalog.pg_advisory_xact_lock($Key);
"@
}

# The cas-stale fixture exercises the live RPC's p_expected_updated_at contract.
# Both workers call the five-argument RPC with a null pre-ABSENT expectation;
# the committed winner creates settings and the loser must return exact 40001.

function New-PhaseProcessPlan {
  param([string]$Phase,[string]$Participant,[string]$Sql)
  $phaseDir = Join-Path $EvidenceDirectory $Phase
  $applicationName = Get-ApplicationName -Phase $Phase -Participant $Participant
  return New-PsqlPlan -Name $Participant -Sql $Sql -ApplicationName $applicationName -Directory $phaseDir
}

function Assert-PhaseInvariant {
  param([Parameter(Mandatory)][string]$Phase)
  $now = (Invoke-Psql -Name ("$Phase-invariant") -Sql (Get-InvariantSql)).Stdout
  Assert-InvariantSnapshotEqual -Before $invariantBefore -After $now -Context $Phase
  if($Phase -ne 'cross-user-same-id'){
    $currentA=(Invoke-Psql -Name ("$Phase-user-a") -Sql (Get-UserV2CanonicalSql $QaUserA.ToLowerInvariant())).Stdout
    if($currentA.Trim() -cne $userACanonicalBefore.Trim()){throw "$Phase changed QA A full state."}
  }
}

function Assert-PhaseFixture {
  param([Parameter(Mandatory)][ValidateSet('cas-stale','same-user-duplicate','cross-user-same-id')][string]$Phase)
  $cas=$fixtures['cas-stale'];$dup=$fixtures['same-user-duplicate'];$cross=$fixtures['cross-user-same-id']
  $b=$QaUserB.ToLowerInvariant();$a=$QaUserA.ToLowerInvariant()
  $payload="jsonb_build_object('__recurring_expense_templates',jsonb_build_array(jsonb_build_object('id',"+(ConvertTo-PsqlLiteral $cas.templateId)+",'memo',"+(ConvertTo-PsqlLiteral $cas.memoA)+",'category','living','amount',1,'dayOfMonth',1,'startsOn','2026-01-01')))"
  $expectedBTransactions=if($Phase -eq 'cas-stale'){1}elseif($Phase -eq 'same-user-duplicate'){2}else{3}
  $expectedMarkerCount=if($Phase -eq 'cas-stale'){2}elseif($Phase -eq 'same-user-duplicate'){3}else{5}
  $extra=if($Phase -eq 'cas-stale'){
    "and (select count(*) from public.preview_v2_transactions where user_id='$b'::uuid and id="+(ConvertTo-PsqlLiteral $cas.transactionId)+" and date='2026-08-01' and type='expense' and category='living' and amount=1 and memo="+(ConvertTo-PsqlLiteral $cas.memoA)+" and source='user')=1"
  }elseif($Phase -eq 'same-user-duplicate'){
    "and (select count(*) from public.preview_v2_transactions where user_id='$b'::uuid and id="+(ConvertTo-PsqlLiteral $dup.transactionId)+" and date='2026-08-01' and type='expense' and category='living' and amount=1 and memo="+(ConvertTo-PsqlLiteral $dup.memoA)+" and source='user')=1"
  }else{
    "and (select count(*) from public.preview_v2_transactions where user_id='$a'::uuid and id="+(ConvertTo-PsqlLiteral $cross.transactionId)+" and date='2026-08-01' and type='expense' and category='living' and amount=1 and memo="+(ConvertTo-PsqlLiteral $cross.memoA)+" and source='user')=1 and (select count(*) from public.preview_v2_transactions where user_id='$b'::uuid and id="+(ConvertTo-PsqlLiteral $cross.transactionId)+" and date='2026-08-01' and type='expense' and category='living' and amount=1 and memo="+(ConvertTo-PsqlLiteral $cross.memoB)+" and source='user')=1"
  }
  $sql=@"
select jsonb_build_object(
 'settings_owned',(select count(*)=1 from public.preview_v2_budget_settings where user_id='$b'::uuid and monthly_budget=500000 and category_budgets=$payload),
 'b_transaction_count',(select count(*) from public.preview_v2_transactions where user_id='$b'::uuid),
 'marker_count',(select count(*) from public.preview_v2_transactions where user_id in('$a'::uuid,'$b'::uuid) and memo like $(ConvertTo-PsqlLiteral($QaMarker+'%')))+(select count(*) from public.preview_v2_budget_settings s cross join lateral jsonb_array_elements(coalesce(s.category_budgets->'__recurring_expense_templates','[]'::jsonb)) t where s.user_id in('$a'::uuid,'$b'::uuid) and t->>'memo' like $(ConvertTo-PsqlLiteral($QaMarker+'%'))),
 'exact_content',((select true) $extra)
)::text;
"@
  $result=Invoke-Psql -Name "$Phase-fixture-verification" -Sql $sql
  $j=$result.Stdout|ConvertFrom-Json
  if(-not $j.settings_owned -or [int]$j.b_transaction_count -ne $expectedBTransactions -or [int]$j.marker_count -ne $expectedMarkerCount -or -not $j.exact_content){throw "$Phase committed fixture count/content/ownership verification failed."}
}

function Invoke-ConcurrencyPhase {
  param([Parameter(Mandatory)][ValidateSet('cas-stale','same-user-duplicate','cross-user-same-id')][string]$Phase)
  $key = Get-AdvisoryKey $Phase
  $txId = $fixtures[$Phase].transactionId
  $templateId = $fixtures[$Phase].templateId
  $memoA = $fixtures[$Phase].memoA
  $memoB = $fixtures[$Phase].memoB

  # Recovery manifest is written before the first possible DML. The append-only
  # ledger still records each successful commit immediately afterward.
  Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory ("fixture-$Phase.json")) -Content ([ordered]@{
    phase=$Phase;key=$key;userA=$QaUserA.ToLowerInvariant();userB=$QaUserB.ToLowerInvariant();transactionId=$txId;templateId=$templateId;marker=$QaMarker;recordedAtUtc=[DateTime]::UtcNow.ToString('o')
  } | ConvertTo-Json -Depth 5)

  $controllerApp = Get-ApplicationName -Phase $Phase -Participant 'controller'
  $a = $QaUserA.ToLowerInvariant(); $b = $QaUserB.ToLowerInvariant()
  if ($Phase -eq 'cas-stale') {
    $payload = "jsonb_build_object('__recurring_expense_templates',jsonb_build_array(jsonb_build_object('id',"+(ConvertTo-PsqlLiteral $templateId)+",'memo',"+(ConvertTo-PsqlLiteral $memoA)+",'category','living','amount',1,'dayOfMonth',1,'startsOn','2026-01-01')))"
    $transactions = "jsonb_build_array(jsonb_build_object('id',"+(ConvertTo-PsqlLiteral $txId)+",'date','2026-08-01','type','expense','category','living','amount',1,'memo',"+(ConvertTo-PsqlLiteral $memoA)+",'source','user'))"
    $body = "select * from public.replace_preview_v2_budget_state(500000,$payload,$transactions,null,'[]'::jsonb); commit;"
    $sqlA=(Get-WorkerPrelude $Phase 'worker-a' $key $b)+$body
    $sqlB=(Get-WorkerPrelude $Phase 'worker-b' $key $b)+$body
  } elseif ($Phase -eq 'same-user-duplicate') {
    $insert="insert into public.preview_v2_transactions(id,user_id,date,type,category,amount,memo,source) values("+(ConvertTo-PsqlLiteral $txId)+",auth.uid(),'2026-08-01','expense','living',1,"+(ConvertTo-PsqlLiteral $memoA)+",'user'); commit;"
    $sqlA=(Get-WorkerPrelude $Phase 'worker-a' $key $b)+$insert
    $sqlB=(Get-WorkerPrelude $Phase 'worker-b' $key $b)+$insert
  } else {
    $insertA="insert into public.preview_v2_transactions(id,user_id,date,type,category,amount,memo,source) values("+(ConvertTo-PsqlLiteral $txId)+",auth.uid(),'2026-08-01','expense','living',1,"+(ConvertTo-PsqlLiteral $memoA)+",'user'); commit;"
    $insertB="insert into public.preview_v2_transactions(id,user_id,date,type,category,amount,memo,source) values("+(ConvertTo-PsqlLiteral $txId)+",auth.uid(),'2026-08-01','expense','living',1,"+(ConvertTo-PsqlLiteral $memoB)+",'user'); commit;"
    $sqlA=(Get-WorkerPrelude $Phase 'worker-a' $key $a)+$insertA
    $sqlB=(Get-WorkerPrelude $Phase 'worker-b' $key $b)+$insertB
  }

  $phaseDir = Join-Path $EvidenceDirectory $Phase
  $controllerSql = "set statement_timeout='${WorkerDeadlineSeconds}s'; do `$app_self`$ begin if current_setting('application_name') <> "+(ConvertTo-PsqlLiteral $controllerApp)+" then raise exception 'startup application_name self-check failed' using errcode='42501'; end if; end; `$app_self`$; select pg_catalog.pg_advisory_lock($key); select pg_backend_pid(); select pg_sleep($WorkerDeadlineSeconds);"
  $lockTag="l.classid=(((${key}::bigint >> 32) & 4294967295)::text)::oid and l.objid=((${key}::bigint & 4294967295)::text)::oid and l.objsubid=1"
  $controllerProbeSql="set statement_timeout='4s';select a.pid from pg_catalog.pg_stat_activity a join pg_catalog.pg_locks l on l.pid=a.pid and l.locktype='advisory' and l.granted and $lockTag where a.application_name=$(ConvertTo-PsqlLiteral $controllerApp);"
  $appA=Get-ApplicationName $Phase 'worker-a';$appB=Get-ApplicationName $Phase 'worker-b'
  $observe=@"
select jsonb_build_object('waiting_count',count(*),'worker_pids',jsonb_agg(w.pid order by w.pid),'controller_pid',min(h.pid),'classid',min(w.classid),'objid',min(w.objid),'objsubid',min(w.objsubid))::text
from pg_catalog.pg_locks w
join pg_catalog.pg_stat_activity a on a.pid=w.pid
join pg_catalog.pg_locks h on h.locktype=w.locktype and h.classid=w.classid and h.objid=w.objid and h.objsubid=w.objsubid and h.granted
join pg_catalog.pg_stat_activity c on c.pid=h.pid and c.application_name=$(ConvertTo-PsqlLiteral $controllerApp)
where w.locktype='advisory' and not w.granted and w.waitstart is not null and a.wait_event_type='Lock' and a.application_name in ($(ConvertTo-PsqlLiteral $appA),$(ConvertTo-PsqlLiteral $appB));
"@
  $releaseSql="with owned as (select distinct a.pid from pg_catalog.pg_stat_activity a join pg_catalog.pg_locks l on l.pid=a.pid and l.locktype='advisory' and l.granted and $lockTag where a.application_name=$(ConvertTo-PsqlLiteral $controllerApp)) select coalesce(bool_and(pg_catalog.pg_terminate_backend(pid)),false) from owned;"

  # Every phase SQL file is copied and hash-verified before any controller,
  # worker, or observation deadline begins. The timed section only docker-execs
  # immutable, pre-staged files.
  $controllerPlan = New-PhaseProcessPlan -Phase $Phase -Participant 'controller' -Sql $controllerSql
  $workerAPlan = New-PhaseProcessPlan -Phase $Phase -Participant 'worker-a' -Sql $sqlA
  $workerBPlan = New-PhaseProcessPlan -Phase $Phase -Participant 'worker-b' -Sql $sqlB
  $controllerProbePlan = New-PsqlPlan -Name 'controller-probe' -Sql $controllerProbeSql -ApplicationName (Get-AuxiliaryApplicationName -Name "$Phase-controller-probe") -Directory $phaseDir
  $waitProbePlan = New-PsqlPlan -Name 'wait-probe' -Sql ("set statement_timeout='4s';"+$observe) -ApplicationName (Get-AuxiliaryApplicationName -Name "$Phase-wait-probe") -Directory $phaseDir
  $releasePlan = New-PsqlPlan -Name 'controller-release' -Sql $releaseSql -ApplicationName (Get-AuxiliaryApplicationName -Name "$Phase-controller-release") -Directory $phaseDir

  $controller = Start-PsqlPlan -Plan $controllerPlan
  $activeControllers.Add($controller.Process)
  $controllerPid = $null
  $deadline = [DateTime]::UtcNow.AddSeconds($ObservationDeadlineSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    $probeSeconds=Get-RemainingProbeSeconds $deadline
    if($probeSeconds -eq 0){break}
    $probe = Invoke-PsqlPlan -Plan $controllerProbePlan -TimeoutSeconds $probeSeconds
    if ($probe.Stdout -match '^\d+$') { $controllerPid=[int]$probe.Stdout;break }
    Start-Sleep -Milliseconds 50
  }
  if ($null -eq $controllerPid) { throw "$Phase controller lock was not observed." }

  $script:committedFixturePossible=$true
  $workerA=Start-PsqlPlan -Plan $workerAPlan
  $activeWorkers.Add($workerA.Process)
  $workerB=Start-PsqlPlan -Plan $workerBPlan
  $activeWorkers.Add($workerB.Process)

  $observation=$null;$deadline=[DateTime]::UtcNow.AddSeconds($ObservationDeadlineSeconds)
  while([DateTime]::UtcNow -lt $deadline){
    $probeSeconds=Get-RemainingProbeSeconds $deadline
    if($probeSeconds -eq 0){break}
    $probe=Invoke-PsqlPlan -Plan $waitProbePlan -TimeoutSeconds $probeSeconds
    if($probe.Stdout){$candidate=$probe.Stdout|ConvertFrom-Json;if([int]$candidate.waiting_count -eq 2 -and @($candidate.worker_pids).Count -eq 2){$observation=$candidate;break}}
    Start-Sleep -Milliseconds 50
  }
  if($null -eq $observation){throw "$Phase real same-key advisory waits were not observed."}
  Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory "$Phase-lock-observation.json") -Content ($observation|ConvertTo-Json -Depth 5)

  $released=Invoke-PsqlPlan -Plan $releasePlan
  if($released.Stdout -ne 't'){throw "$Phase exact controller release failed."}
  $controllerResult=Complete-Psql -Handle $controller -AllowedExitCodes @(2)
  $controllerErrors=@(Get-ExactSqlStateErrors $controllerResult.Stderr)
  if($controllerErrors.Count -gt 1 -or ($controllerErrors.Count -eq 1 -and $controllerErrors[0] -ne '57P01')){throw "$Phase controller ended with an unexpected SQLSTATE."}
  $allowed=if($Phase -eq 'cross-user-same-id'){@(0)}else{@(0,3)}
  $ra=Complete-Psql -Handle $workerA -AllowedExitCodes $allowed
  $rb=Complete-Psql -Handle $workerB -AllowedExitCodes $allowed
  $results=@($ra,$rb)

  if($Phase -eq 'cas-stale'){$code='40001'}elseif($Phase -eq 'same-user-duplicate'){$code='23505'}else{$code=$null}
  if($code){
    $winners=@($results|Where-Object ExitCode -eq 0)
    $losers=@($results|Where-Object{$states=@(Get-ExactSqlStateErrors $_.Stderr);$_.ExitCode -eq 3 -and $states.Count -eq 1 -and $states[0] -eq $code})
    if($winners.Count -ne 1 -or $losers.Count -ne 1 -or @($winners|Where-Object{$states=@(Get-ExactSqlStateErrors $_.Stderr);$states.Count -ne 0}).Count -ne 0){throw "$Phase requires one commit and one exact_sqlstate $code."}
  } elseif(@($results|Where-Object ExitCode -ne 0).Count -ne 0){throw "$Phase requires two commits."}

  Assert-PhaseFixture $Phase
  if($Phase -eq 'cas-stale'){
    Add-LedgerRecord templateIds $b $templateId $memoA $Phase
    Add-LedgerRecord transactionIds $b $txId $memoA $Phase
  } elseif($Phase -eq 'same-user-duplicate'){
    Add-LedgerRecord transactionIds $b $txId $memoA $Phase
  } else {
    Add-LedgerRecord transactionIds $a $txId $memoA "$Phase-a"
    Add-LedgerRecord transactionIds $b $txId $memoB "$Phase-b"
  }
  Assert-PhaseInvariant $Phase
}

function Get-RecoveryCleanupSql {
  $clauses=New-Object System.Collections.Generic.List[string]
  foreach($phase in $fixtures.Keys){
    $f=$fixtures[$phase]
    $owner=if($phase -eq 'cross-user-same-id'){$QaUserA.ToLowerInvariant()}else{$QaUserB.ToLowerInvariant()}
    $clauses.Add("(user_id='$owner'::uuid and id='$(($f.transactionId).Replace("'","''"))')")
    if($phase -eq 'cross-user-same-id'){$clauses.Add("(user_id='$($QaUserB.ToLowerInvariant())'::uuid and id='$(($f.transactionId).Replace("'","''"))')")}
  }
  $predicate=if($clauses.Count){$clauses -join ' or '}else{'false'}
  $marker=ConvertTo-PsqlLiteral($QaMarker+'%')
  $cas=$fixtures['cas-stale']
  $ownedPayload="jsonb_build_object('__recurring_expense_templates',jsonb_build_array(jsonb_build_object('id',"+(ConvertTo-PsqlLiteral $cas.templateId)+",'memo',"+(ConvertTo-PsqlLiteral $cas.memoA)+",'category','living','amount',1,'dayOfMonth',1,'startsOn','2026-01-01')))"
  return @"
\set VERBOSITY sqlstate
set statement_timeout='20s';set lock_timeout='5s';begin;
delete from public.preview_v2_transactions where $predicate;
delete from public.preview_v2_budget_settings where user_id='$($QaUserB.ToLowerInvariant())'::uuid and monthly_budget=500000 and category_budgets=$ownedPayload;
commit;
select jsonb_build_object('cleanup_verified',true,'exact_id_count',(select count(*) from public.preview_v2_transactions where $predicate),'qa_marker_leak_count',(select count(*) from public.preview_v2_transactions where user_id in('$($QaUserA.ToLowerInvariant())'::uuid,'$($QaUserB.ToLowerInvariant())'::uuid) and memo like $marker)+(select count(*) from public.preview_v2_budget_settings s cross join lateral jsonb_array_elements(coalesce(s.category_budgets->'__recurring_expense_templates','[]'::jsonb)) t where s.user_id in('$($QaUserA.ToLowerInvariant())'::uuid,'$($QaUserB.ToLowerInvariant())'::uuid) and t->>'memo' like $marker),'b_v2_row_count',(select count(*) from public.preview_v2_budget_settings where user_id='$($QaUserB.ToLowerInvariant())'::uuid)+(select count(*) from public.preview_v2_transactions where user_id='$($QaUserB.ToLowerInvariant())'::uuid))::text;
"@
}

function Invoke-ExactCleanup {
  # cleanup_attempted is evidence of an attempt, not success. cleanupVerified is
  # set only after every exact-ID, marker, B-absence settings_restore,
  # A-canonical, and invariant check passes; finally retries idempotently.
  $script:cleanupAttempted=$true
  $script:cleanupAttemptNumber++
  if(-not(Test-Path -LiteralPath $recoverySqlPath)){throw 'pre-generated recovery cleanup SQL is missing.'}
  $freshCleanupSql = Get-RecoveryCleanupSql
  $freshHash = Get-Sha256Hex -Content $freshCleanupSql
  $storedHash = Get-FileSha256Hex -Path $recoverySqlPath
  if ([string]::IsNullOrWhiteSpace($expectedCleanupSqlSha256) -or
      $freshHash -cne $expectedCleanupSqlSha256 -or
      $storedHash -cne $expectedCleanupSqlSha256) {
    throw 'recovery cleanup SQL integrity comparison failed; no cleanup DML was executed.'
  }
  # Quiesce the client execution boundary before querying server backends. A
  # docker.exe process can be gone while an accepted docker exec has not yet
  # opened its PostgreSQL connection. Removing the exact owned workload
  # container makes that late connect impossible; cleanup then runs through a
  # fresh control-only client with a new ownership nonce.
  Reset-DockerClientForCleanup
  Stop-RunServerBackends
  $name="cleanup-attempt-$cleanupAttemptNumber"
  $attemptSqlPath = Join-Path $EvidenceDirectory "cleanup-attempt-$cleanupAttemptNumber.sql"
  Write-Utf8NoBom -Path $attemptSqlPath -Content $freshCleanupSql
  if ((Get-FileSha256Hex -Path $attemptSqlPath) -cne $expectedCleanupSqlSha256) {
    throw 'fresh cleanup SQL write verification failed; no cleanup DML was executed.'
  }
  $null = Prepare-PsqlFile -SqlPath $attemptSqlPath
  $handle=Start-PsqlFile -Name $name -SqlPath $attemptSqlPath -StdoutPath (Join-Path $EvidenceDirectory "$name.stdout.txt") -StderrPath (Join-Path $EvidenceDirectory "$name.stderr.txt") -ApplicationName (Get-AuxiliaryApplicationName -Name $name)
  $result=Complete-Psql -Handle $handle
  $j=$result.Stdout|ConvertFrom-Json
  if(-not $j.cleanup_verified -or [int]$j.exact_id_count -ne 0 -or [int]$j.qa_marker_leak_count -ne 0 -or [int]$j.b_v2_row_count -ne 0){throw 'cleanup did not restore byte-exact pre_absent QA B state.'}
  $after=(Invoke-Psql -Name 'cleanup-invariant' -Sql (Get-InvariantSql)).Stdout
  Assert-InvariantSnapshotEqual $invariantBefore $after 'cleanup'
  $afterA=(Invoke-Psql -Name 'cleanup-user-a-canonical' -Sql (Get-UserV2CanonicalSql $QaUserA.ToLowerInvariant())).Stdout
  if($afterA.Trim() -cne $userACanonicalBefore.Trim()){throw 'cleanup did not byte-restore QA A full state.'}
  $script:cleanupVerified=$true
}

$EvidenceDirectory=Assert-SafeEvidenceDirectory -Path $EvidenceDirectory -AllowExistingEvidence:$RecoveryOnly
$ledgerPath=Join-Path $EvidenceDirectory 'qa-ledger.jsonl'
$baselineInvariantPath=Join-Path $EvidenceDirectory 'invariants-before.json'
$baselineUserAPath=Join-Path $EvidenceDirectory 'user-a-before.json'
$recoverySqlPath=Join-Path $EvidenceDirectory 'recovery-cleanup.sql'
$manifestPath=Join-Path $EvidenceDirectory 'recovery-manifest.json'
$originalDockerImageSnapshotPath=Join-Path $EvidenceDirectory 'docker-image-snapshot.json'
Initialize-Fixtures

try{
  $evidenceLeaseStream=Acquire-EvidenceLease -Directory $EvidenceDirectory
  if($QaUserA.Equals($QaUserB,[System.StringComparison]::OrdinalIgnoreCase)){throw 'QA users must be distinct.'}
  if((2 * $ObservationDeadlineSeconds) + 7 -ge $WorkerDeadlineSeconds){throw 'Two observation windows plus a 7-second safety margin must be less than WorkerDeadlineSeconds.'}
  Assert-NoInheritedLibpqEnvironment
  $direct=($PgHost -ceq "db.$ProjectRef.supabase.co" -and $PgUser -ceq 'postgres' -and $PgPort -ceq '5432' -and $PgDatabase -ceq 'postgres')
  $pooler=($PgHost -match '^[a-z0-9.-]+\.pooler\.supabase\.com$' -and $PgUser -ceq "postgres.$ProjectRef" -and $PgPort -ceq '5432' -and $PgDatabase -ceq 'postgres')
  if(-not($direct -or $pooler)){throw 'PGHOST/PGUSER does not match the exact Supabase ProjectRef endpoint contract.'}
  Initialize-DockerClient

  $writersConsent=Read-Host "Type WRITERS-STOPPED after confirming all production, V1, V2, local authenticated tabs, and API writers are stopped and will remain stopped through exact cleanup"
  if($writersConsent -cne 'WRITERS-STOPPED'){throw 'explicit all-writers-stopped confirmation failed.'}
  $confirmationPrompt=if($RecoveryOnly){"Type the exact ProjectRef '$ProjectRef' to execute recovery-only exact cleanup"}else{"Type the exact ProjectRef '$ProjectRef' to execute committed concurrency verification"}
  $typed=Read-Host $confirmationPrompt
  if($typed -cne $ProjectRef){throw 'explicit ProjectRef confirmation failed.'}
  $confirmationUtc=[DateTime]::UtcNow.ToString('o')
  $confirmationName=if($RecoveryOnly){'recovery-confirmation-'+([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))+'.json'}else{'write-free-confirmation.json'}
  Write-Utf8NoBom -Path (Join-Path $EvidenceDirectory $confirmationName) -Content ([ordered]@{projectRef=$ProjectRef;recoveryOnly=[bool]$RecoveryOnly;writersStoppedConfirmed=$true;confirmedAtUtc=$confirmationUtc}|ConvertTo-Json)

  $securePassword=Read-Host 'Database password (unmanaged-memory transport; never logged)' -AsSecureString
  $credentialPointer=[Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($securePassword)
  if($securePassword.Length -eq 0){throw 'database password must not be empty.'}
  $transportName=if($RecoveryOnly){'recovery-credential-transport-preflight'}else{'credential-transport-preflight'}
  $transport=Invoke-Psql -Name $transportName -TimeoutSeconds 8 -Sql "select 'credential-transport-preflight';"
  if($transport.Stdout -cne 'credential-transport-preflight'){throw 'installed psql cannot use redirected stdin credential transport.'}

  if($RecoveryOnly){
    $committedFixturePossible=$true
    Invoke-ExactCleanup
    Add-LedgerRecord events $QaUserA.ToLowerInvariant() $RunId $QaMarker 'recovery_cleanup_verified'
    Write-Output 'preview-v2 recovery-only exact cleanup verified'
  }else{
    Write-Utf8NoBom -Path $ledgerPath -Content ''
    Assert-DisposableUsers
    Assert-RunFixturesAbsent
    $invariantBefore=(Invoke-Psql -Name 'invariants-before' -Sql (Get-InvariantSql)).Stdout
    $userACanonicalBefore=(Invoke-Psql -Name 'user-a-before' -Sql (Get-UserV2CanonicalSql $QaUserA.ToLowerInvariant())).Stdout
    Write-Utf8NoBom -Path $baselineInvariantPath -Content $invariantBefore
    Write-Utf8NoBom -Path $baselineUserAPath -Content $userACanonicalBefore
    $recoveryCleanupSql = Get-RecoveryCleanupSql
    Write-Utf8NoBom -Path $recoverySqlPath -Content $recoveryCleanupSql
    $expectedCleanupSqlSha256 = Get-Sha256Hex -Content $recoveryCleanupSql
    if ((Get-FileSha256Hex -Path $recoverySqlPath) -cne $expectedCleanupSqlSha256) { throw 'pre-generated recovery cleanup SQL write verification failed.' }
    $manifest=[ordered]@{projectRef=$ProjectRef;runId=$RunId;qaMarker=$QaMarker;qaUserA=$QaUserA.ToLowerInvariant();qaUserB=$QaUserB.ToLowerInvariant();preAbsentUserB=$true;writersStoppedConfirmed=$true;confirmationUtc=$confirmationUtc;cleanupSqlSha256=$expectedCleanupSqlSha256;baselineInvariantSha256=(Get-FileSha256Hex -Path $baselineInvariantPath);baselineUserASha256=(Get-FileSha256Hex -Path $baselineUserAPath);dockerContextName=$dockerContextName;dockerContextEndpoint=$dockerContextEndpoint;dockerContextSnapshotSha256=$dockerContextSnapshotSha256;imageSnapshotSha256=$dockerImageSnapshotSha256;imageId=$dockerImageId;repoDigest=$dockerRepoDigest;imageImmutableIdentitySha256=$dockerImageImmutableIdentitySha256;sslRootCertificateSha256=$sslRootCertificateSha256;sslRootCertificateLength=$sslRootCertificateLength;fixtures=$fixtures}
    Write-Utf8NoBom -Path $manifestPath -Content ($manifest|ConvertTo-Json -Depth 8)
    foreach($phase in @('cas-stale','same-user-duplicate','cross-user-same-id')){Invoke-ConcurrencyPhase $phase}
    Invoke-ExactCleanup
    Add-LedgerRecord events $QaUserA.ToLowerInvariant() $RunId $QaMarker 'cleanup_verified'
    Write-Output 'preview-v2 live committed concurrency runner passed; exact cleanup verified'
  }
}catch{$primaryError=$_}
finally{
  # If commit status is ambiguous, terminate owned workers before the controller
  # can release them. Then terminate only the exact owned controller processes.
  foreach($p in @($activeWorkers)){if($null -ne $p){Stop-OwnedProcess $p}}
  foreach($p in @($activeControllers)){if($null -ne $p){Stop-OwnedProcess $p}}
  foreach($p in @($ownedProcesses)){if($null -ne $p){Stop-OwnedProcess $p}}
  if($committedFixturePossible -and -not $cleanupVerified){try{Invoke-ExactCleanup}catch{$cleanupError=$_}}
  if($credentialPointer -ne [IntPtr]::Zero){[Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($credentialPointer);$credentialPointer=[IntPtr]::Zero}
  if($null -ne $securePassword){$securePassword.Dispose();$securePassword=$null}
  if(-not [string]::IsNullOrWhiteSpace($dockerClientContainerId)){
    try{Remove-OwnedDockerClient}catch{if($null -eq $cleanupError){$cleanupError=$_}else{$cleanupError=[System.Management.Automation.ErrorRecord]::new([System.Exception]::new($cleanupError.Exception.Message+[Environment]::NewLine+'docker cleanup failure: '+$_.Exception.Message),'DockerCleanupCombined',[System.Management.Automation.ErrorCategory]::CloseError,$dockerClientContainerId)}}
  }
  if($null -ne $evidenceLeaseStream){$evidenceLeaseStream.Dispose();$evidenceLeaseStream=$null}
}

if($null -ne $primaryError -or $null -ne $cleanupError){
  $messages=New-Object System.Collections.Generic.List[string]
  if($null -ne $primaryError){$messages.Add('run failure: '+$primaryError.Exception.Message)}
  if($null -ne $cleanupError){$messages.Add('cleanup failure: '+$cleanupError.Exception.Message)}
  throw ($messages -join [Environment]::NewLine)
}
