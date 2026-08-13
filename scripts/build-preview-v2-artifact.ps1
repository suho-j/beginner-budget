[CmdletBinding(DefaultParameterSetName = 'Build')]
param(
  [Parameter(Mandatory, ParameterSetName = 'Build')][string]$SourceRoot,
  [Parameter(Mandatory, ParameterSetName = 'Build')][string]$DeployRoot,
  [Parameter(Mandatory, ParameterSetName = 'Build')][string]$SourceCommit,
  [Parameter(Mandatory, ParameterSetName = 'Build')][string]$BuiltAtUtc,
  [Parameter(ParameterSetName = 'Build')]
  [ValidateSet('None', 'AfterV2Swap', 'AfterIndexWrite', 'AfterReadmeWrite')]
  [string]$FailureInjection = 'None',
  [Parameter(ParameterSetName = 'Build', DontShow)]
  [ValidateSet(
    'None', 'DeployReadmeBeforePublish', 'CleanupFailureAfterSuccess',
    'HoldPublishLock', 'ExternalBeforeFirstWrite', 'ExternalAfterV2Swap',
    'ExternalAfterPublishV2Write', 'ExternalAfterRollbackV2Write'
  )]
  [string]$SelfTestScenario = 'None',
  [Parameter(Mandatory, ParameterSetName = 'SelfTest')][switch]$SelfTest,
  [Parameter(ParameterSetName = 'SelfTest', DontShow)]
  [ValidateSet('All', 'Concurrency')][string]$SelfTestFilter = 'All'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$expectedSourceBranch = 'guardian/budget-preview-v2'
$expectedSourceRepository = 'https://github.com/suho-j/beginner-budget'
$expectedDeployRepository = 'https://github.com/suho-j/beginner-budget-preview'
$artifactFiles = @(
  'index.html', 'css/style.css', 'js/storage.js', 'js/transactions.js',
  'js/cloud.js', 'js/ui.js', 'js/app.js'
)

function Invoke-RepositoryGit {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  $safeRoot = $Root.Replace('\', '/')
  $output = @(& git -c "safe.directory=$safeRoot" -c 'core.excludesFile=' -C $Root @Arguments)
  if ($LASTEXITCODE -ne 0) {
    throw "git $($Arguments -join ' ') failed for $Root"
  }
  return $output
}

function Get-ExactRepositoryRoot {
  param([Parameter(Mandatory)][string]$Root)

  $resolved = (Resolve-Path -LiteralPath $Root -ErrorAction Stop).Path.TrimEnd('\', '/')
  $topLevelText = (Invoke-RepositoryGit -Root $resolved -Arguments @('rev-parse', '--show-toplevel')) -join ''
  $topLevel = [System.IO.Path]::GetFullPath($topLevelText.Trim()).TrimEnd('\', '/')
  if (-not [string]::Equals($resolved, $topLevel, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Repository root must be the exact git toplevel: $resolved"
  }
  return $resolved
}

function Test-PathContains {
  param(
    [Parameter(Mandatory)][string]$Parent,
    [Parameter(Mandatory)][string]$Candidate
  )

  $parentPrefix = $Parent.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
  return $Candidate.StartsWith($parentPrefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Normalize-GitHubRepositoryUrl {
  param([Parameter(Mandatory)][string]$Url)

  $normalized = $Url.Trim().Replace('\', '/').TrimEnd('/')
  if ($normalized -match '^git@github\.com:(?<path>.+)$') {
    $normalized = 'https://github.com/' + $Matches.path
  }
  if ($normalized.EndsWith('.git', [System.StringComparison]::OrdinalIgnoreCase)) {
    $normalized = $normalized.Substring(0, $normalized.Length - 4)
  }
  return $normalized.ToLowerInvariant()
}

function Assert-RepositoryPreflight {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$ExpectedBranch,
    [Parameter(Mandatory)][string]$ExpectedRepository,
    [Parameter(Mandatory)][string]$Label
  )

  $status = (Invoke-RepositoryGit -Root $Root -Arguments @('status', '--porcelain=v1', '--untracked-files=all')) -join "`n"
  if ($status) { throw "$Label repository must be clean before artifact creation." }

  $branch = ((Invoke-RepositoryGit -Root $Root -Arguments @('branch', '--show-current')) -join '').Trim()
  if ($branch -ne $ExpectedBranch) {
    throw "$Label repository must be on $ExpectedBranch, not '$branch'."
  }

  $origin = ((Invoke-RepositoryGit -Root $Root -Arguments @('remote', 'get-url', 'origin')) -join '').Trim()
  if ((Normalize-GitHubRepositoryUrl -Url $origin) -ne $ExpectedRepository.ToLowerInvariant()) {
    throw "$Label origin must be $ExpectedRepository, not '$origin'."
  }
}

function Assert-SourceStable {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$ExpectedCommit
  )

  Assert-RepositoryPreflight -Root $Root -ExpectedBranch $expectedSourceBranch `
    -ExpectedRepository $expectedSourceRepository -Label 'Source'
  $head = ((Invoke-RepositoryGit -Root $Root -Arguments @('rev-parse', 'HEAD')) -join '').Trim().ToLowerInvariant()
  if ($head -ne $ExpectedCommit) { throw 'Source repository changed during artifact creation.' }
}

function Get-TreeHashes {
  param(
    [Parameter(Mandatory)][string]$TreeRoot,
    [Parameter(Mandatory)][string]$RelativeToRoot
  )

  if (-not (Test-Path -LiteralPath $TreeRoot -PathType Container)) { return @() }
  return @(
    Get-ChildItem -LiteralPath $TreeRoot -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
        '{0} {1}' -f $_.FullName.Substring($RelativeToRoot.Length).Replace('\', '/'),
          (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
      }
  )
}

function Get-MutableDeploySnapshot {
  param([Parameter(Mandatory)][string]$Root)

  $snapshot = [System.Collections.Generic.List[string]]::new()
  foreach ($relative in @('index.html', 'README.md')) {
    $path = Join-Path $Root $relative
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $snapshot.Add("$relative $((Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash)")
    } else {
      $snapshot.Add("$relative <missing>")
    }
  }

  $v2Root = Join-Path $Root 'v2'
  if (Test-Path -LiteralPath $v2Root -PathType Container) {
    $snapshot.Add('v2 <present>')
    foreach ($entry in (Get-TreeHashes -TreeRoot $v2Root -RelativeToRoot $Root)) {
      $snapshot.Add($entry)
    }
  } else {
    $snapshot.Add('v2 <missing>')
  }
  return @($snapshot | Sort-Object)
}

function Set-ExpectedMutableEntry {
  param(
    [Parameter(Mandatory)][string[]]$Expected,
    [Parameter(Mandatory)][ValidateSet('index.html', 'README.md')][string]$RelativePath,
    [string]$SourcePath,
    [switch]$Missing
  )

  if (-not $Missing -and (-not $SourcePath -or -not (Test-Path -LiteralPath $SourcePath -PathType Leaf))) {
    throw "Expected mutable entry source is missing: $RelativePath"
  }
  $next = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in $Expected) {
    if (-not $entry.StartsWith($RelativePath + ' ', [System.StringComparison]::Ordinal)) {
      $next.Add($entry)
    }
  }
  if ($Missing) {
    $next.Add("$RelativePath <missing>")
  } else {
    $next.Add("$RelativePath $((Get-FileHash -Algorithm SHA256 -LiteralPath $SourcePath).Hash)")
  }
  return @($next | Sort-Object)
}

function Set-ExpectedMutableTree {
  param(
    [Parameter(Mandatory)][string[]]$Expected,
    [Parameter(Mandatory)][ValidateSet('v2')][string]$TreeName,
    [string]$SourceRoot,
    [switch]$Missing
  )

  if (-not $Missing -and (-not $SourceRoot -or -not (Test-Path -LiteralPath $SourceRoot -PathType Container))) {
    throw "Expected mutable tree source is missing: $TreeName"
  }
  $treePrefix = "/$TreeName/"
  $next = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in $Expected) {
    if (-not $entry.StartsWith($TreeName + ' ', [System.StringComparison]::Ordinal) `
      -and -not $entry.StartsWith($treePrefix, [System.StringComparison]::Ordinal)) {
      $next.Add($entry)
    }
  }
  if ($Missing) {
    $next.Add("$TreeName <missing>")
  } else {
    $next.Add("$TreeName <present>")
    Get-ChildItem -LiteralPath $SourceRoot -Recurse -File | Sort-Object FullName | ForEach-Object {
      $relative = $_.FullName.Substring($SourceRoot.Length + 1).Replace('\', '/')
      $next.Add("/$TreeName/$relative $((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)")
    }
  }
  return @($next | Sort-Object)
}

function Get-RelativeFiles {
  param([Parameter(Mandatory)][string]$Root)

  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -File |
      ForEach-Object { $_.FullName.Substring($Root.Length + 1).Replace('\', '/') } |
      Sort-Object
  )
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Content
  )

  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Assert-V2Artifact {
  param(
    [Parameter(Mandatory)][string]$ArtifactRoot,
    [Parameter(Mandatory)][string]$ExpectedCommit,
    [Parameter(Mandatory)][string]$ExpectedBuiltAt
  )

  $expectedFiles = @($artifactFiles + 'version.json' | ForEach-Object { $_.Replace('\', '/') } | Sort-Object)
  $actualFiles = Get-RelativeFiles -Root $ArtifactRoot
  if (Compare-Object $expectedFiles $actualFiles) {
    throw 'V2 artifact contains files outside the exact eight-file contract.'
  }

  $deployedIndex = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $ArtifactRoot 'index.html')
  if ($deployedIndex -match '(?:src|href)=["'']/(?:css|js)/') {
    throw 'V2 index local asset paths must remain relative.'
  }

  $version = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $ArtifactRoot 'version.json') | ConvertFrom-Json
  $failed = $version.version -ne 'v2' `
    -or $version.sourceRepository -ne $expectedSourceRepository `
    -or $version.sourceBranch -ne $expectedSourceBranch `
    -or $version.sourceCommit -ne $ExpectedCommit `
    -or $version.builtAt -ne $ExpectedBuiltAt `
    -or $version.testCount -ne 89 `
    -or $version.environment -ne 'preview-v2' `
    -or @($version.dataTables).Count -ne 2 `
    -or @($version.dataTables)[0] -ne 'preview_v2_budget_settings' `
    -or @($version.dataTables)[1] -ne 'preview_v2_transactions'
  if ($failed) { throw 'V2 version.json does not match the fixed metadata contract.' }
}

function Assert-CommitMatchesArtifact {
  param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Commit,
    [Parameter(Mandatory)][string]$ArtifactRoot
  )

  foreach ($relative in $artifactFiles) {
    $commitObject = "${Commit}:$($relative.Replace('\', '/'))"
    $expectedBlob = ((Invoke-RepositoryGit -Root $Source -Arguments @('rev-parse', $commitObject)) -join '').Trim()
    $actualBlob = ((Invoke-RepositoryGit -Root $Source -Arguments @(
      'hash-object', '--no-filters', '--', (Join-Path $ArtifactRoot $relative)
    )) -join '').Trim()
    if ($expectedBlob -notmatch '^[0-9a-f]{40,64}$' -or $actualBlob -ne $expectedBlob) {
      throw "V2 artifact does not match SourceCommit blob: $relative"
    }
  }
}

function Export-CommitArtifact {
  param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Commit,
    [Parameter(Mandatory)][string]$ArchivePath,
    [Parameter(Mandatory)][string]$Destination,
    [Parameter(Mandatory)][string]$TarExecutable
  )

  $safeRoot = $Source.Replace('\', '/')
  $archiveOutput = @(& git -c "safe.directory=$safeRoot" -c 'core.excludesFile=' -c 'core.autocrlf=false' -C $Source `
    archive '--format=tar' "--output=$ArchivePath" $Commit '--' @artifactFiles 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "git archive failed for SourceCommit $Commit`: $($archiveOutput -join [Environment]::NewLine)"
  }

  $tarOutput = @(& $TarExecutable -xf $ArchivePath -C $Destination 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "tar extraction failed: $($tarOutput -join [Environment]::NewLine)"
  }

  $expectedFiles = @($artifactFiles | ForEach-Object { $_.Replace('\', '/') } | Sort-Object)
  $actualFiles = Get-RelativeFiles -Root $Destination
  if (Compare-Object $expectedFiles $actualFiles) {
    throw 'SourceCommit archive did not contain the exact seven-file artifact contract.'
  }
  Assert-CommitMatchesArtifact -Source $Source -Commit $Commit -ArtifactRoot $Destination
}

function Assert-DeployStableBeforePublish {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$ExpectedHead,
    [Parameter(Mandatory)][string]$V1Root,
    [Parameter(Mandatory)][string[]]$ExpectedV1,
    [Parameter(Mandatory)][string[]]$ExpectedMutable
  )

  $exactRoot = Get-ExactRepositoryRoot -Root $Root
  if (-not [string]::Equals($exactRoot, $Root, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Deploy repository toplevel changed before publish.'
  }
  Assert-RepositoryPreflight -Root $Root -ExpectedBranch 'main' `
    -ExpectedRepository $expectedDeployRepository -Label 'Deploy'
  $head = ((Invoke-RepositoryGit -Root $Root -Arguments @('rev-parse', 'HEAD')) -join '').Trim().ToLowerInvariant()
  if ($head -ne $ExpectedHead) { throw 'Deploy repository HEAD changed before publish.' }
  if (Compare-Object $ExpectedV1 (Get-TreeHashes -TreeRoot $V1Root -RelativeToRoot $Root)) {
    throw 'V1 artifact changed before publish.'
  }
  if (Compare-Object $ExpectedMutable (Get-MutableDeploySnapshot -Root $Root)) {
    throw 'Deploy index, README, or V2 artifact changed before publish.'
  }
}

function Assert-DeployOnlyExpectedChanges {
  param([Parameter(Mandatory)][string]$Root)

  $changed = @(
    (Invoke-RepositoryGit -Root $Root -Arguments @('diff', '--name-only', 'HEAD', '--'))
    (Invoke-RepositoryGit -Root $Root -Arguments @('ls-files', '--others', '--exclude-standard'))
  ) | ForEach-Object { ([string]$_).Trim().Replace('\', '/') } | Where-Object { $_ } | Sort-Object -Unique

  $unexpected = @($changed | Where-Object { $_ -ne 'index.html' -and $_ -ne 'README.md' -and -not $_.StartsWith('v2/') })
  if ($unexpected.Count -gt 0) {
    throw "Artifact publish changed paths outside index.html, README.md, and v2/: $($unexpected -join ', ')"
  }
}

function Get-RepositoryGitDirectory {
  param([Parameter(Mandatory)][string]$Root)

  $gitDirectoryText = ((Invoke-RepositoryGit -Root $Root -Arguments @('rev-parse', '--git-dir')) -join '').Trim()
  if ([System.IO.Path]::IsPathRooted($gitDirectoryText)) {
    return [System.IO.Path]::GetFullPath($gitDirectoryText).TrimEnd('\', '/')
  }
  return [System.IO.Path]::GetFullPath((Join-Path $Root $gitDirectoryText)).TrimEnd('\', '/')
}

function Get-DeployLockName {
  param([Parameter(Mandatory)][string]$Root)

  $normalizedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/').Replace('\', '/').ToLowerInvariant()
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($normalizedRoot))
  } finally {
    $sha256.Dispose()
  }
  $hex = -join @($hash | ForEach-Object { $_.ToString('x2') })
  return "Local\CodexPreviewV2Artifact_$hex"
}

function Enter-DeployPublishLock {
  param(
    [Parameter(Mandatory)][string]$Root,
    [int]$TimeoutMilliseconds = 1000
  )

  $mutex = [System.Threading.Mutex]::new($false, (Get-DeployLockName -Root $Root))
  $ownsMutex = $false
  $lockStream = $null
  $lockPath = $null
  try {
    try {
      $ownsMutex = $mutex.WaitOne($TimeoutMilliseconds)
    } catch [System.Threading.AbandonedMutexException] {
      $ownsMutex = $true
    }
    if (-not $ownsMutex) {
      throw 'Another V2 artifact publish holds the deploy-root mutex.'
    }

    $gitDirectory = Get-RepositoryGitDirectory -Root $Root
    $lockPath = Join-Path $gitDirectory 'codex-preview-v2-artifact.lock'
    try {
      $lockStream = [System.IO.File]::Open(
        $lockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
      )
      $lockStream.SetLength(0)
      $lockBytes = [System.Text.Encoding]::UTF8.GetBytes("PID=$PID`n")
      $lockStream.Write($lockBytes, 0, $lockBytes.Length)
      $lockStream.Flush($true)
    } catch {
      throw "Another V2 artifact publish holds the deploy-root file lock: $_"
    }

    return [pscustomobject]@{
      Mutex = $mutex
      OwnsMutex = $ownsMutex
      FileStream = $lockStream
      LockPath = $lockPath
    }
  } catch {
    if ($null -ne $lockStream) { $lockStream.Dispose() }
    if ($ownsMutex) {
      try { $mutex.ReleaseMutex() } catch { Write-Warning "V2 artifact mutex release warning: $_" }
    }
    $mutex.Dispose()
    throw
  }
}

function Exit-DeployPublishLock {
  param($Lock)

  if ($null -eq $Lock) { return }
  try {
    if ($null -ne $Lock.FileStream) { $Lock.FileStream.Dispose() }
    if ($Lock.LockPath -and (Test-Path -LiteralPath $Lock.LockPath -PathType Leaf)) {
      Remove-Item -LiteralPath $Lock.LockPath -Force
    }
  } catch {
    Write-Warning "V2 artifact file-lock cleanup warning: $_"
  } finally {
    try {
      if ($Lock.OwnsMutex) { $Lock.Mutex.ReleaseMutex() }
    } catch {
      Write-Warning "V2 artifact mutex release warning: $_"
    } finally {
      $Lock.Mutex.Dispose()
    }
  }
}

function Assert-MutableSnapshotCas {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string[]]$Expected,
    [Parameter(Mandatory)][string]$Phase
  )

  $current = Get-MutableDeploySnapshot -Root $Root
  if (Compare-Object $Expected $current) {
    throw "Deploy mutable-state CAS conflict before $Phase; concurrent bytes were preserved."
  }
}

function Invoke-SelfTestLockHold {
  param(
    [Parameter(Mandatory)][string]$LockPath,
    [Parameter(Mandatory)][string]$Scenario
  )

  if ($Scenario -ne 'HoldPublishLock') { return }
  $readyPath = $LockPath + '.selftest.ready'
  $releasePath = $LockPath + '.selftest.release'
  Write-Utf8NoBom -Path $readyPath -Content 'ready'
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  try {
    while (-not (Test-Path -LiteralPath $releasePath -PathType Leaf)) {
      if ([DateTime]::UtcNow -ge $deadline) { throw 'Self-test publish-lock release timeout.' }
      Start-Sleep -Milliseconds 50
    }
  } finally {
    foreach ($markerPath in @($readyPath, $releasePath)) {
      if (Test-Path -LiteralPath $markerPath) {
        Remove-Item -LiteralPath $markerPath -Force -ErrorAction SilentlyContinue
      }
    }
  }
}

function Assert-SelfTestScenarioAllowed {
  param(
    [Parameter(Mandatory)][string]$Scenario,
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Deploy
  )

  if ($Scenario -eq 'None') { return }
  if ($env:BEGINNER_BUDGET_ARTIFACT_SELF_TEST -ne '1') {
    throw 'Internal artifact self-test scenarios are disabled.'
  }
  $selfTestPrefix = [System.IO.Path]::GetFullPath(
    (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'Temp')
  ).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar + 'beginner-budget-v2-artifact-selftest-'
  if (-not $Source.StartsWith($selfTestPrefix, [System.StringComparison]::OrdinalIgnoreCase) `
    -or -not $Deploy.StartsWith($selfTestPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Internal artifact self-test scenarios require isolated temporary repositories.'
  }
}

function Assert-DirectDeployTarget {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string[]]$AllowedNames
  )

  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
  $parent = [System.IO.Path]::GetDirectoryName($fullPath).TrimEnd('\', '/')
  $name = [System.IO.Path]::GetFileName($fullPath)
  if (-not [string]::Equals($parent, $Root, [System.StringComparison]::OrdinalIgnoreCase) -or $AllowedNames -notcontains $name) {
    throw "Unsafe deploy mutation target: $fullPath"
  }
}

function Restore-DeployState {
  param(
    [Parameter(Mandatory)][string]$Root,
    [Parameter(Mandatory)][string]$BackupRoot,
    [Parameter(Mandatory)][bool]$HadIndex,
    [Parameter(Mandatory)][bool]$HadReadme,
    [Parameter(Mandatory)][bool]$HadV2,
    [Parameter(Mandatory)][string[]]$ExpectedMutable,
    [Parameter(Mandatory)][string]$SelfTestScenario
  )

  $restoreExpected = @($ExpectedMutable)
  $deployV2 = Join-Path $Root 'v2'
  Assert-DirectDeployTarget -Root $Root -Path $deployV2 -AllowedNames @('v2')
  $expectedV2Present = $restoreExpected -contains 'v2 <present>'
  if ($expectedV2Present) {
    Assert-MutableSnapshotCas -Root $Root -Expected $restoreExpected -Phase 'rollback V2 removal'
    $restoreExpected = Set-ExpectedMutableTree -Expected $restoreExpected -TreeName 'v2' -Missing
    Remove-Item -LiteralPath $deployV2 -Recurse -Force
    Assert-MutableSnapshotCas -Root $Root -Expected $restoreExpected -Phase 'rollback V2 removal validation'
  }
  if ($HadV2) {
    Assert-MutableSnapshotCas -Root $Root -Expected $restoreExpected -Phase 'rollback V2 restoration'
    $restoreExpected = Set-ExpectedMutableTree -Expected $restoreExpected -TreeName 'v2' `
      -SourceRoot (Join-Path $BackupRoot 'v2')
    Copy-Item -LiteralPath (Join-Path $BackupRoot 'v2') -Destination $deployV2 -Recurse
    if ($SelfTestScenario -eq 'ExternalAfterRollbackV2Write') {
      Write-Utf8NoBom -Path (Join-Path $Root 'README.md') -Content 'external bytes after rollback V2 write'
    }
    Assert-MutableSnapshotCas -Root $Root -Expected $restoreExpected -Phase 'rollback V2 restoration validation'
  }

  foreach ($item in @(
    @{ Name = 'index.html'; HadFile = $HadIndex },
    @{ Name = 'README.md'; HadFile = $HadReadme }
  )) {
    $target = Join-Path $Root $item.Name
    Assert-DirectDeployTarget -Root $Root -Path $target -AllowedNames @('index.html', 'README.md')
    if ($item.HadFile) {
      Assert-MutableSnapshotCas -Root $Root -Expected $restoreExpected -Phase "rollback $($item.Name) restoration"
      $restoreExpected = Set-ExpectedMutableEntry -Expected $restoreExpected -RelativePath $item.Name `
        -SourcePath (Join-Path $BackupRoot $item.Name)
      Copy-Item -LiteralPath (Join-Path $BackupRoot $item.Name) -Destination $target -Force
      Assert-MutableSnapshotCas -Root $Root -Expected $restoreExpected `
        -Phase "rollback $($item.Name) restoration validation"
    } elseif (Test-Path -LiteralPath $target) {
      Assert-MutableSnapshotCas -Root $Root -Expected $restoreExpected -Phase "rollback $($item.Name) removal"
      $restoreExpected = Set-ExpectedMutableEntry -Expected $restoreExpected -RelativePath $item.Name -Missing
      Remove-Item -LiteralPath $target -Force
      Assert-MutableSnapshotCas -Root $Root -Expected $restoreExpected `
        -Phase "rollback $($item.Name) removal validation"
    }
  }
  return @($restoreExpected)
}

function Invoke-ArtifactSelfTest {
  param([ValidateSet('All', 'Concurrency')][string]$Filter = 'All')
  $selfTestTempRoot = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'Temp'
  $selfTestRoot = Join-Path $selfTestTempRoot ('beginner-budget-v2-artifact-selftest-' + [guid]::NewGuid().ToString('N'))
  $selfTestBuiltAt = '2026-08-12T00:00:00Z'

  function Invoke-SelfTestGit {
    param([string]$Root, [string[]]$Arguments)
    & git -c core.excludesFile= -C $Root @Arguments | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "self-test git failed: $($Arguments -join ' ')" }
  }

  function Write-SelfTestFile {
    param([string]$Path, [string]$Content)
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    Write-Utf8NoBom -Path $Path -Content $Content
  }

  function New-SelfTestFixture {
    param([string]$Name)
    $caseRoot = Join-Path $selfTestRoot $Name
    $source = Join-Path $caseRoot 'source'
    $deploy = Join-Path $caseRoot 'deploy'
    New-Item -ItemType Directory -Path $source, $deploy | Out-Null

    Invoke-SelfTestGit $source @('init', '-b', $expectedSourceBranch)
    Invoke-SelfTestGit $source @('config', 'user.name', 'Artifact Test')
    Invoke-SelfTestGit $source @('config', 'user.email', 'artifact@example.test')
    Invoke-SelfTestGit $source @('remote', 'add', 'origin', ($expectedSourceRepository + '.git'))
    Write-SelfTestFile (Join-Path $source 'index.html') '<link rel="stylesheet" href="css/style.css"><script src="js/app.js"></script>'
    Write-SelfTestFile (Join-Path $source 'css/style.css') 'body { color: black; }'
    foreach ($namePart in @('storage', 'transactions', 'cloud', 'ui', 'app')) {
      Write-SelfTestFile (Join-Path $source "js/$namePart.js") "window.$namePart = true;"
    }
    Invoke-SelfTestGit $source @('add', '.')
    Invoke-SelfTestGit $source @('commit', '-m', 'source fixture')

    Invoke-SelfTestGit $deploy @('init', '-b', 'main')
    Invoke-SelfTestGit $deploy @('config', 'user.name', 'Artifact Test')
    Invoke-SelfTestGit $deploy @('config', 'user.email', 'artifact@example.test')
    Invoke-SelfTestGit $deploy @('remote', 'add', 'origin', ($expectedDeployRepository + '.git'))
    Write-SelfTestFile (Join-Path $deploy 'index.html') 'original root'
    Write-SelfTestFile (Join-Path $deploy 'README.md') 'original readme'
    Write-SelfTestFile (Join-Path $deploy 'v1/keep.txt') 'keep v1'
    Write-SelfTestFile (Join-Path $deploy 'v2/old.txt') 'old v2'
    Invoke-SelfTestGit $deploy @('add', '.')
    Invoke-SelfTestGit $deploy @('commit', '-m', 'deploy fixture')

    return [pscustomobject]@{
      Source = $source
      Deploy = $deploy
      Commit = ((& git -c core.excludesFile= -C $source rev-parse HEAD) -join '').Trim()
    }
  }

  function Get-SelfTestSnapshot {
    param([string]$Deploy)
    $snapshot = [System.Collections.Generic.List[string]]::new()
    foreach ($relative in @('index.html', 'README.md')) {
      $path = Join-Path $Deploy $relative
      $snapshot.Add("$relative $((Get-FileHash -Algorithm SHA256 -LiteralPath $path).Hash)")
    }
    foreach ($tree in @('v1', 'v2')) {
      Get-ChildItem -LiteralPath (Join-Path $Deploy $tree) -Recurse -File | Sort-Object FullName | ForEach-Object {
        $snapshot.Add("$($_.FullName.Substring($Deploy.Length).Replace('\', '/')) $((Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash)")
      }
    }
    return @($snapshot)
  }

  function Invoke-SelfTestBuild {
    param($Fixture, [string[]]$ExtraArguments = @())
    $arguments = @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
      '-SourceRoot', $Fixture.Source, '-DeployRoot', $Fixture.Deploy,
      '-SourceCommit', $Fixture.Commit, '-BuiltAtUtc', $selfTestBuiltAt
    ) + $ExtraArguments
    $oldPreference = $ErrorActionPreference
    $oldSelfTestEnvironment = $env:BEGINNER_BUDGET_ARTIFACT_SELF_TEST
    $ErrorActionPreference = 'Continue'
    try {
      $env:BEGINNER_BUDGET_ARTIFACT_SELF_TEST = '1'
      $output = @(& powershell @arguments 2>&1)
      $exitCode = $LASTEXITCODE
    } finally {
      $env:BEGINNER_BUDGET_ARTIFACT_SELF_TEST = $oldSelfTestEnvironment
      $ErrorActionPreference = $oldPreference
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = ($output -join "`n") }
  }

  function Start-SelfTestBuild {
    param($Fixture, [string[]]$ExtraArguments = @())
    $arguments = @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath,
      '-SourceRoot', $Fixture.Source, '-DeployRoot', $Fixture.Deploy,
      '-SourceCommit', $Fixture.Commit, '-BuiltAtUtc', $selfTestBuiltAt
    ) + $ExtraArguments
    $powershellExecutable = (Get-Command powershell -CommandType Application -ErrorAction Stop).Source
    $quotedArguments = @($arguments | ForEach-Object {
      $argumentText = [string]$_
      if ($argumentText -match '[\s"]') {
        '"' + $argumentText.Replace('\', '\').Replace('"', '\"') + '"'
      } else {
        $argumentText
      }
    })
    $startInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $startInfo.FileName = $powershellExecutable
    $startInfo.Arguments = $quotedArguments -join ' '
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $startInfo
    $oldSelfTestEnvironment = [Environment]::GetEnvironmentVariable(
      'BEGINNER_BUDGET_ARTIFACT_SELF_TEST',
      [EnvironmentVariableTarget]::Process
    )
    try {
      [Environment]::SetEnvironmentVariable(
        'BEGINNER_BUDGET_ARTIFACT_SELF_TEST', '1', [EnvironmentVariableTarget]::Process
      )
      if (-not $process.Start()) { throw 'Could not start artifact self-test subprocess.' }
    } finally {
      [Environment]::SetEnvironmentVariable(
        'BEGINNER_BUDGET_ARTIFACT_SELF_TEST', $oldSelfTestEnvironment, [EnvironmentVariableTarget]::Process
      )
    }
    return [pscustomobject]@{
      Process = $process
    }
  }

  function Get-SelfTestProcessOutput {
    param($StartedProcess)
    return @(
      $StartedProcess.Process.StandardOutput.ReadToEnd()
      $StartedProcess.Process.StandardError.ReadToEnd()
    ) -join "`n"
  }

  function Assert-SelfTestFailurePreservesDeploy {
    param($Fixture, [string[]]$ExtraArguments = @())
    $before = Get-SelfTestSnapshot $Fixture.Deploy
    $statusBefore = ((& git -c core.excludesFile= -C $Fixture.Deploy status --porcelain) -join "`n")
    $result = Invoke-SelfTestBuild $Fixture $ExtraArguments
    if ($result.ExitCode -eq 0) { throw "Self-test expected failure but succeeded: $($result.Output)" }
    if (Compare-Object $before (Get-SelfTestSnapshot $Fixture.Deploy)) {
      throw "Self-test failure changed deploy bytes: $($result.Output)"
    }
    $statusAfter = ((& git -c core.excludesFile= -C $Fixture.Deploy status --porcelain) -join "`n")
    if ($statusBefore -ne $statusAfter) { throw 'Self-test failure changed deploy git status.' }
  }

  try {
    New-Item -ItemType Directory -Path $selfTestRoot | Out-Null

    if ($Filter -eq 'All') {
    $happy = New-SelfTestFixture 'happy'
    $happyResult = Invoke-SelfTestBuild $happy
    if ($happyResult.ExitCode -ne 0) { throw "Artifact happy self-test failed: $($happyResult.Output)" }
    if (-not (Test-Path -LiteralPath (Join-Path $happy.Deploy 'v2/version.json'))) {
      throw 'Artifact happy self-test missed version.json.'
    }
    if ((Get-Content -Raw -LiteralPath (Join-Path $happy.Deploy 'v1/keep.txt')) -ne 'keep v1') {
      throw 'Artifact happy self-test changed V1.'
    }

    $dirtySource = New-SelfTestFixture 'dirty-source'
    Write-SelfTestFile (Join-Path $dirtySource.Source 'js/app.js') 'dirty source'
    Assert-SelfTestFailurePreservesDeploy $dirtySource

    $dirtyDeploy = New-SelfTestFixture 'dirty-deploy'
    Write-SelfTestFile (Join-Path $dirtyDeploy.Deploy 'README.md') 'dirty deploy'
    Assert-SelfTestFailurePreservesDeploy $dirtyDeploy

    $wrongSubdir = New-SelfTestFixture 'wrong-subdir'
    $wrongSubdir.Source = Join-Path $wrongSubdir.Source 'js'
    Assert-SelfTestFailurePreservesDeploy $wrongSubdir

    $wrongBranch = New-SelfTestFixture 'wrong-branch'
    Invoke-SelfTestGit $wrongBranch.Source @('switch', '-c', 'wrong')
    Assert-SelfTestFailurePreservesDeploy $wrongBranch

    $staleCommit = New-SelfTestFixture 'stale-commit'
    $staleCommit.Commit = '0000000000000000000000000000000000000000'
    Assert-SelfTestFailurePreservesDeploy $staleCommit

    $rollback = New-SelfTestFixture 'rollback'
    Assert-SelfTestFailurePreservesDeploy $rollback @('-FailureInjection', 'AfterIndexWrite')

    $hiddenWorkingTree = New-SelfTestFixture 'assume-unchanged'
    $hiddenWorkingPath = Join-Path $hiddenWorkingTree.Source 'js/app.js'
    Write-SelfTestFile $hiddenWorkingPath 'working tree bytes that are not committed'
    Invoke-SelfTestGit $hiddenWorkingTree.Source @('update-index', '--assume-unchanged', 'js/app.js')
    $hiddenStatus = ((& git -c core.excludesFile= -C $hiddenWorkingTree.Source status --porcelain) -join "`n")
    if ($hiddenStatus) { throw "Assume-unchanged self-test source was not status-clean: $hiddenStatus" }
    $hiddenResult = Invoke-SelfTestBuild $hiddenWorkingTree
    if ($hiddenResult.ExitCode -ne 0) { throw "Assume-unchanged self-test failed: $($hiddenResult.Output)" }
    $expectedCommitBlob = ((& git -c core.excludesFile= -C $hiddenWorkingTree.Source rev-parse `
      "$($hiddenWorkingTree.Commit):js/app.js") -join '').Trim()
    $deployedCommitBlob = ((& git -c core.excludesFile= -C $hiddenWorkingTree.Source hash-object --no-filters -- `
      (Join-Path $hiddenWorkingTree.Deploy 'v2/js/app.js')) -join '').Trim()
    $workingTreeBlob = ((& git -c core.excludesFile= -C $hiddenWorkingTree.Source hash-object --no-filters -- `
      $hiddenWorkingPath) -join '').Trim()
    if ($deployedCommitBlob -ne $expectedCommitBlob -or $workingTreeBlob -eq $expectedCommitBlob) {
      throw 'Artifact did not use exact SourceCommit bytes for an assume-unchanged working file.'
    }

    $concurrent = New-SelfTestFixture 'prepublish-concurrent'
    $concurrentBefore = Get-SelfTestSnapshot $concurrent.Deploy
    $concurrentResult = Invoke-SelfTestBuild $concurrent @('-SelfTestScenario', 'DeployReadmeBeforePublish')
    if ($concurrentResult.ExitCode -eq 0) { throw 'Prepublish concurrent mutation self-test unexpectedly succeeded.' }
    if ((Get-Content -Raw -LiteralPath (Join-Path $concurrent.Deploy 'README.md')) -ne 'concurrent deploy mutation') {
      throw 'Prepublish failure did not preserve the concurrent README bytes.'
    }
    $concurrentAfter = Get-SelfTestSnapshot $concurrent.Deploy
    if (Compare-Object @($concurrentBefore | Where-Object { -not $_.StartsWith('README.md ') }) `
        @($concurrentAfter | Where-Object { -not $_.StartsWith('README.md ') })) {
      throw 'Prepublish concurrent mutation changed deploy files outside README.md.'
    }
    $concurrentStatus = ((& git -c core.excludesFile= -C $concurrent.Deploy status --porcelain) -join "`n")
    if ($concurrentStatus.Trim() -ne 'M README.md') {
      throw "Prepublish concurrent mutation status was not preserved exactly: $concurrentStatus"
    }

    $cleanupFailure = New-SelfTestFixture 'cleanup-failure'
    $cleanupResult = Invoke-SelfTestBuild $cleanupFailure @('-SelfTestScenario', 'CleanupFailureAfterSuccess')
    if ($cleanupResult.ExitCode -ne 0 `
      -or -not $cleanupResult.Output.Contains('V2 artifact cleanup warning')) {
      throw "Cleanup warning self-test failed: $($cleanupResult.Output)"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $cleanupFailure.Deploy 'v2/version.json'))) {
      throw 'Cleanup warning self-test did not retain the successful artifact.'
    }
    }

    $lockedFixture = New-SelfTestFixture 'publish-lock'
    $lockFilePath = Join-Path $lockedFixture.Deploy '.git/codex-preview-v2-artifact.lock'
    $readyPath = $lockFilePath + '.selftest.ready'
    $releasePath = $lockFilePath + '.selftest.release'
    $firstBuild = Start-SelfTestBuild $lockedFixture @('-SelfTestScenario', 'HoldPublishLock')
    try {
      $readyDeadline = [DateTime]::UtcNow.AddSeconds(20)
      while (-not (Test-Path -LiteralPath $readyPath -PathType Leaf)) {
        if ($firstBuild.Process.HasExited) {
          $earlyOutput = Get-SelfTestProcessOutput $firstBuild
          throw "First publish-lock self-test process exited early: $earlyOutput"
        }
        if ([DateTime]::UtcNow -ge $readyDeadline) { throw 'Publish-lock self-test ready timeout.' }
        Start-Sleep -Milliseconds 50
      }

      $lockedBefore = Get-SelfTestSnapshot $lockedFixture.Deploy
      $secondBuild = Invoke-SelfTestBuild $lockedFixture
      if ($secondBuild.ExitCode -eq 0 -or -not $secondBuild.Output.Contains('holds the deploy-root mutex')) {
        throw "Second concurrent artifact build did not fail on the publish lock: $($secondBuild.Output)"
      }
      if (Compare-Object $lockedBefore (Get-SelfTestSnapshot $lockedFixture.Deploy)) {
        throw 'Second concurrent artifact build mutated deploy bytes while the first held the lock.'
      }
      Write-SelfTestFile -Path $releasePath -Content 'release'
      if (-not $firstBuild.Process.WaitForExit(30000)) {
        throw 'First publish-lock self-test process did not finish after release.'
      }
      $firstBuild.Process.Refresh()
      $firstOutput = Get-SelfTestProcessOutput $firstBuild
      if ($firstBuild.Process.ExitCode -ne 0) {
        throw "First publish-lock self-test process failed after release: $firstOutput"
      }
      if (Test-Path -LiteralPath $lockFilePath -PathType Leaf) {
        throw 'Publish-lock file remained after successful concurrent self-test.'
      }
    } finally {
      if (-not $firstBuild.Process.HasExited) {
        Write-SelfTestFile -Path $releasePath -Content 'release'
        if (-not $firstBuild.Process.WaitForExit(5000)) {
          Stop-Process -Id $firstBuild.Process.Id -Force -ErrorAction SilentlyContinue
        }
      }
    }

    $beforeFirstWrite = New-SelfTestFixture 'external-before-first-write'
    $beforeFirstSnapshot = Get-SelfTestSnapshot $beforeFirstWrite.Deploy
    $beforeFirstResult = Invoke-SelfTestBuild $beforeFirstWrite @('-SelfTestScenario', 'ExternalBeforeFirstWrite')
    if ($beforeFirstResult.ExitCode -eq 0 -or -not $beforeFirstResult.Output.Contains('CAS conflict before V2 removal')) {
      throw "External-before-first-write self-test did not fail at CAS: $($beforeFirstResult.Output)"
    }
    if ((Get-Content -Raw -LiteralPath (Join-Path $beforeFirstWrite.Deploy 'README.md')) -ne 'external bytes before first write') {
      throw 'External-before-first-write self-test erased concurrent README bytes.'
    }
    $beforeFirstAfter = Get-SelfTestSnapshot $beforeFirstWrite.Deploy
    if (Compare-Object @($beforeFirstSnapshot | Where-Object { -not $_.StartsWith('README.md ') }) `
        @($beforeFirstAfter | Where-Object { -not $_.StartsWith('README.md ') })) {
      throw 'External-before-first-write self-test made an artifact mutation before CAS rejection.'
    }

    $afterV2Swap = New-SelfTestFixture 'external-after-v2-swap'
    $afterV2Result = Invoke-SelfTestBuild $afterV2Swap @(
      '-SelfTestScenario', 'ExternalAfterV2Swap', '-FailureInjection', 'AfterV2Swap'
    )
    if ($afterV2Result.ExitCode -eq 0 `
      -or -not $afterV2Result.Output.Contains('rollback refused or failed') `
      -or -not $afterV2Result.Output.Contains('CAS conflict before rollback eligibility')) {
      throw "External-after-V2-swap rollback self-test did not preserve the conflict: $($afterV2Result.Output)"
    }
    if ((Get-Content -Raw -LiteralPath (Join-Path $afterV2Swap.Deploy 'README.md')) -ne 'external bytes after V2 swap') {
      throw 'Rollback erased concurrent README bytes after the V2 swap.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $afterV2Swap.Deploy 'v2/version.json')) `
      -or (Test-Path -LiteralPath (Join-Path $afterV2Swap.Deploy 'v2/old.txt'))) {
      throw 'Rollback-conflict self-test did not leave the explicit partial V2 state for human recovery.'
    }
    if ((Get-Content -Raw -LiteralPath (Join-Path $afterV2Swap.Deploy 'index.html')) -ne 'original root') {
      throw 'Rollback-conflict self-test unexpectedly changed the root index.'
    }

    $afterPublishWrite = New-SelfTestFixture 'external-after-publish-v2-write'
    $afterPublishResult = Invoke-SelfTestBuild $afterPublishWrite @(
      '-SelfTestScenario', 'ExternalAfterPublishV2Write'
    )
    if ($afterPublishResult.ExitCode -eq 0 `
      -or -not $afterPublishResult.Output.Contains('CAS conflict before V2 publish validation') `
      -or -not $afterPublishResult.Output.Contains('CAS conflict before rollback eligibility')) {
      throw "Post-publish V2 deterministic CAS self-test did not reject live drift: $($afterPublishResult.Output)"
    }
    if ((Get-Content -Raw -LiteralPath (Join-Path $afterPublishWrite.Deploy 'README.md')) -ne 'external bytes after V2 swap') {
      throw 'Post-publish V2 deterministic CAS self-test erased concurrent README bytes.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $afterPublishWrite.Deploy 'v2/version.json'))) {
      throw 'Post-publish V2 deterministic CAS self-test did not leave explicit partial V2 state.'
    }

    $afterRollbackWrite = New-SelfTestFixture 'external-after-rollback-v2-write'
    $afterRollbackResult = Invoke-SelfTestBuild $afterRollbackWrite @(
      '-SelfTestScenario', 'ExternalAfterRollbackV2Write', '-FailureInjection', 'AfterIndexWrite'
    )
    if ($afterRollbackResult.ExitCode -eq 0 `
      -or -not $afterRollbackResult.Output.Contains('CAS conflict before rollback V2 restoration validation')) {
      throw "Post-rollback V2 deterministic CAS self-test did not reject live drift: $($afterRollbackResult.Output)"
    }
    if ((Get-Content -Raw -LiteralPath (Join-Path $afterRollbackWrite.Deploy 'README.md')) -ne 'external bytes after rollback V2 write') {
      throw 'Post-rollback V2 deterministic CAS self-test erased concurrent README bytes.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $afterRollbackWrite.Deploy 'v2/old.txt')) `
      -or (Test-Path -LiteralPath (Join-Path $afterRollbackWrite.Deploy 'v2/version.json'))) {
      throw 'Post-rollback V2 deterministic CAS self-test did not leave the planned restored V2 tree.'
    }
    if ((Get-Content -Raw -LiteralPath (Join-Path $afterRollbackWrite.Deploy 'index.html')) -eq 'original root') {
      throw 'Post-rollback V2 deterministic CAS self-test unexpectedly completed the index rollback.'
    }

    $fileLockFixture = New-SelfTestFixture 'file-lock-only'
    $fileLockPath = Join-Path $fileLockFixture.Deploy '.git/codex-preview-v2-artifact.lock'
    $fileLockStream = [System.IO.File]::Open(
      $fileLockPath,
      [System.IO.FileMode]::OpenOrCreate,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
    try {
      $fileLockBefore = Get-SelfTestSnapshot $fileLockFixture.Deploy
      $fileLockStatusBefore = ((& git -c core.excludesFile= -C $fileLockFixture.Deploy status --porcelain) -join "`n")
      $fileLockResult = Invoke-SelfTestBuild $fileLockFixture
      if ($fileLockResult.ExitCode -eq 0 -or -not $fileLockResult.Output.Contains('holds the deploy-root file lock')) {
        throw "Exclusive file-lock branch self-test did not reject the child: $($fileLockResult.Output)"
      }
      if (Compare-Object $fileLockBefore (Get-SelfTestSnapshot $fileLockFixture.Deploy)) {
        throw 'Exclusive file-lock branch self-test allowed deploy byte mutations.'
      }
      $fileLockStatusAfter = ((& git -c core.excludesFile= -C $fileLockFixture.Deploy status --porcelain) -join "`n")
      if ($fileLockStatusAfter -ne $fileLockStatusBefore) {
        throw 'Exclusive file-lock branch self-test changed deploy git status.'
      }
    } finally {
      $fileLockStream.Dispose()
      if (Test-Path -LiteralPath $fileLockPath -PathType Leaf) {
        Remove-Item -LiteralPath $fileLockPath -Force
      }
    }
    if (Test-Path -LiteralPath $fileLockPath -PathType Leaf) {
      throw 'Exclusive file-lock branch self-test left a residual lock file.'
    }

    if ($Filter -eq 'Concurrency') {
      Write-Output 'V2 artifact concurrency self-tests passed: mutex, file-lock, deterministic publish and rollback CAS'
    } else {
      Write-Output 'V2 artifact self-tests passed: 16 scenarios including deterministic publish and rollback CAS'
    }
  } finally {
    if (Test-Path -LiteralPath $selfTestRoot) {
      $resolvedSelfTestRoot = (Resolve-Path -LiteralPath $selfTestRoot).Path
      $safePrefix = [System.IO.Path]::GetFullPath($selfTestTempRoot).TrimEnd('\', '/') `
        + [System.IO.Path]::DirectorySeparatorChar + 'beginner-budget-v2-artifact-selftest-'
      if ($resolvedSelfTestRoot.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        try {
          Get-ChildItem -LiteralPath $selfTestRoot -Recurse -Force -ErrorAction SilentlyContinue |
            ForEach-Object { $_.Attributes = [System.IO.FileAttributes]::Normal }
          [System.IO.Directory]::Delete($selfTestRoot, $true)
        } catch {
          Write-Warning "Artifact self-test cleanup deferred: $_"
        }
      }
    }
  }
}

if ($SelfTest) {
  Invoke-ArtifactSelfTest -Filter $SelfTestFilter
  exit 0
}

if ($SourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
  throw 'SourceCommit must be an exact 40-character hexadecimal SHA.'
}
$sourceCommitNormalized = $SourceCommit.ToLowerInvariant()
$parsedBuiltAt = [DateTimeOffset]::MinValue
$builtAtParses = [DateTimeOffset]::TryParse(
  $BuiltAtUtc,
  [System.Globalization.CultureInfo]::InvariantCulture,
  [System.Globalization.DateTimeStyles]::AssumeUniversal,
  [ref]$parsedBuiltAt
)
if ($BuiltAtUtc -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$' -or -not $builtAtParses) {
  throw 'BuiltAtUtc must be a UTC ISO-8601 value ending in Z.'
}

# Complete every repository and input preflight before creating staging files or
# mutating the deploy checkout.
$sourceRoot = Get-ExactRepositoryRoot -Root $SourceRoot
$deployRoot = Get-ExactRepositoryRoot -Root $DeployRoot
if ([string]::Equals($sourceRoot, $deployRoot, [System.StringComparison]::OrdinalIgnoreCase) `
  -or (Test-PathContains -Parent $sourceRoot -Candidate $deployRoot) `
  -or (Test-PathContains -Parent $deployRoot -Candidate $sourceRoot)) {
  throw 'SourceRoot and DeployRoot must be distinct, non-nested git repositories.'
}
Assert-SelfTestScenarioAllowed -Scenario $SelfTestScenario -Source $sourceRoot -Deploy $deployRoot

Assert-RepositoryPreflight -Root $sourceRoot -ExpectedBranch $expectedSourceBranch `
  -ExpectedRepository $expectedSourceRepository -Label 'Source'
Assert-RepositoryPreflight -Root $deployRoot -ExpectedBranch 'main' `
  -ExpectedRepository $expectedDeployRepository -Label 'Deploy'

$sourceHead = ((Invoke-RepositoryGit -Root $sourceRoot -Arguments @('rev-parse', 'HEAD')) -join '').Trim().ToLowerInvariant()
if ($sourceHead -ne $sourceCommitNormalized) { throw 'SourceCommit does not match SourceRoot HEAD.' }
$deployHeadBefore = ((Invoke-RepositoryGit -Root $deployRoot -Arguments @('rev-parse', 'HEAD')) -join '').Trim().ToLowerInvariant()
if ($deployHeadBefore -notmatch '^[0-9a-f]{40}$') { throw 'Deploy repository HEAD is invalid.' }

$v1Root = Join-Path $deployRoot 'v1'
if (-not (Test-Path -LiteralPath $v1Root -PathType Container)) {
  throw 'Deploy repository must already contain the V1 artifact.'
}
foreach ($relative in $artifactFiles) {
  $commitObject = "${sourceCommitNormalized}:$($relative.Replace('\', '/'))"
  $null = Invoke-RepositoryGit -Root $sourceRoot -Arguments @('cat-file', '-e', $commitObject)
}
$tarExecutable = (Get-Command tar -CommandType Application -ErrorAction Stop).Source

$v1Before = Get-TreeHashes -TreeRoot $v1Root -RelativeToRoot $deployRoot
$mutableBefore = Get-MutableDeploySnapshot -Root $deployRoot

$tempRoot = [System.IO.Path]::GetFullPath(
  (Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)) 'Temp')
).TrimEnd('\', '/')
$runRoot = Join-Path $tempRoot ('beginner-budget-preview-v2-artifact-' + [guid]::NewGuid().ToString('N'))
$payloadRoot = Join-Path $runRoot 'payload'
$stagedV2Root = Join-Path $payloadRoot 'v2'
$backupRoot = Join-Path $runRoot 'backup'
$archivePath = Join-Path $runRoot 'source-commit.tar'
$deployMutationStarted = $false
$publishLock = $null
$lastWrittenExpected = @($mutableBefore)
$hadIndex = Test-Path -LiteralPath (Join-Path $deployRoot 'index.html') -PathType Leaf
$hadReadme = Test-Path -LiteralPath (Join-Path $deployRoot 'README.md') -PathType Leaf
$hadV2 = Test-Path -LiteralPath (Join-Path $deployRoot 'v2') -PathType Container

try {
  New-Item -ItemType Directory -Path $stagedV2Root, $backupRoot | Out-Null
  Export-CommitArtifact -Source $sourceRoot -Commit $sourceCommitNormalized `
    -ArchivePath $archivePath -Destination $stagedV2Root -TarExecutable $tarExecutable

  $version = [ordered]@{
    version = 'v2'
    sourceRepository = $expectedSourceRepository
    sourceBranch = $expectedSourceBranch
    sourceCommit = $sourceCommitNormalized
    builtAt = $BuiltAtUtc
    testCount = 89
    environment = 'preview-v2'
    dataTables = @('preview_v2_budget_settings', 'preview_v2_transactions')
  }
  Write-Utf8NoBom -Path (Join-Path $stagedV2Root 'version.json') `
    -Content (($version | ConvertTo-Json -Depth 4) + "`n")

  # These Korean constants stay as base64 because Windows PowerShell 5.1 was
  # verified to decode them and WriteAllText emits deterministic UTF-8 without BOM.
  $rootLandingBase64 = 'PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImtvIj4KPGhlYWQ+CiAgPG1ldGEgY2hhcnNldD0idXRmLTgiPgogIDxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MSI+CiAgPHRpdGxlPuyeheusuOyekCDqsIDqs4TrtoAg6rCc67CcIOuvuOumrOuztOq4sDwvdGl0bGU+CjwvaGVhZD4KPGJvZHk+CiAgPG1haW4+CiAgICA8aDE+7J6F66y47J6QIOqwgOqzhOu2gCDqsJzrsJwg66+466as67O06riwPC9oMT4KICAgIDxwPuqwgSDrsoTsoITsnYAg6rKp66as65CcIOqwnOuwnCDrr7jrpqzrs7TquLDsnoXri4jri6QuPC9wPgogICAgPG5hdiBhcmlhLWxhYmVsPSLrr7jrpqzrs7TquLAg67KE7KCEIj4KICAgICAgPGEgaHJlZj0iL2JlZ2lubmVyLWJ1ZGdldC1wcmV2aWV3L3YxLyI+VjEg4oCUIO2DrcK37IiY7KCVwrfsupjrprDrjZQ8L2E+CiAgICAgIDxhIGhyZWY9Ii9iZWdpbm5lci1idWRnZXQtcHJldmlldy92Mi8iPlYyIOKAlCDrsJjrs7Xsp4DstpzCt+yYiOyglSDrgrTsl608L2E+CiAgICA8L25hdj4KICA8L21haW4+CjwvYm9keT4KPC9odG1sPg=='
  $readmeTemplateBase64 = 'IyBiZWdpbm5lci1idWRnZXQtcHJldmlldwoK6rCBIOuyhOyghOydgCDqsqnrpqzrkJwg6rCc67CcIOuvuOumrOuztOq4sOyeheuLiOuLpC4KCnwgdmVyc2lvbiB8IHB1YmxpYyBVUkwgfCBzb3VyY2UgYnJhbmNoIHwgc291cmNlIFNIQSB8IGRhdGEgdGFibGVzIHwKfC0tLXwtLS18LS0tfC0tLXwtLS18CnwgVjEgfCBodHRwczovL3N1aG8tai5naXRodWIuaW8vYmVnaW5uZXItYnVkZ2V0LXByZXZpZXcvdjEvIHwgYGd1YXJkaWFuL2J1ZGdldC1wcmV2aWV3LXYxYCB8IGAyYjdkMzRmZjg0MzA1ZmRmZTY3OTQzM2JjZTEyNzk5Mzg2MWRmZmEwYCB8IGBwcmV2aWV3X2J1ZGdldF9zZXR0aW5nc2AsIGBwcmV2aWV3X3RyYW5zYWN0aW9uc2AgfAp8IFYyIHwgaHR0cHM6Ly9zdWhvLWouZ2l0aHViLmlvL2JlZ2lubmVyLWJ1ZGdldC1wcmV2aWV3L3YyLyB8IGBndWFyZGlhbi9idWRnZXQtcHJldmlldy12MmAgfCBgX19TT1VSQ0VfQ09NTUlUX19gIHwgYHByZXZpZXdfdjJfYnVkZ2V0X3NldHRpbmdzYCwgYHByZXZpZXdfdjJfdHJhbnNhY3Rpb25zYCB8'
  $rootLanding = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($rootLandingBase64))
  $readmeTemplate = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($readmeTemplateBase64))
  Write-Utf8NoBom -Path (Join-Path $payloadRoot 'index.html') -Content ($rootLanding.TrimStart() + "`n")
  Write-Utf8NoBom -Path (Join-Path $payloadRoot 'README.md') `
    -Content ($readmeTemplate.Replace('__SOURCE_COMMIT__', $sourceCommitNormalized).TrimStart() + "`n")

  Assert-V2Artifact -ArtifactRoot $stagedV2Root -ExpectedCommit $sourceCommitNormalized -ExpectedBuiltAt $BuiltAtUtc
  Assert-CommitMatchesArtifact -Source $sourceRoot -Commit $sourceCommitNormalized -ArtifactRoot $stagedV2Root
  $expectedPayloadFiles = @('README.md', 'index.html') + @(
    $artifactFiles + 'version.json' | ForEach-Object { 'v2/' + $_.Replace('\', '/') }
  ) | Sort-Object
  if (Compare-Object $expectedPayloadFiles (Get-RelativeFiles -Root $payloadRoot)) {
    throw 'Staged deploy payload contains unexpected paths.'
  }
  $expectedAfterV2Removal = Set-ExpectedMutableTree -Expected $mutableBefore -TreeName 'v2' -Missing
  $expectedAfterV2Publish = Set-ExpectedMutableTree -Expected $expectedAfterV2Removal -TreeName 'v2' `
    -SourceRoot $stagedV2Root
  $expectedAfterIndexWrite = Set-ExpectedMutableEntry -Expected $expectedAfterV2Publish `
    -RelativePath 'index.html' -SourcePath (Join-Path $payloadRoot 'index.html')
  $expectedMutableAfter = Set-ExpectedMutableEntry -Expected $expectedAfterIndexWrite `
    -RelativePath 'README.md' -SourcePath (Join-Path $payloadRoot 'README.md')
  Assert-SourceStable -Root $sourceRoot -ExpectedCommit $sourceCommitNormalized

  $publishLock = Enter-DeployPublishLock -Root $deployRoot
  Invoke-SelfTestLockHold -LockPath $publishLock.LockPath -Scenario $SelfTestScenario
  if ($SelfTestScenario -eq 'DeployReadmeBeforePublish') {
    Write-Utf8NoBom -Path (Join-Path $deployRoot 'README.md') -Content 'concurrent deploy mutation'
  }
  Assert-DeployStableBeforePublish -Root $deployRoot -ExpectedHead $deployHeadBefore `
    -V1Root $v1Root -ExpectedV1 $v1Before -ExpectedMutable $mutableBefore
  $lastWrittenExpected = @($mutableBefore)

  if ($hadIndex) { Copy-Item -LiteralPath (Join-Path $deployRoot 'index.html') -Destination (Join-Path $backupRoot 'index.html') }
  if ($hadReadme) { Copy-Item -LiteralPath (Join-Path $deployRoot 'README.md') -Destination (Join-Path $backupRoot 'README.md') }
  if ($hadV2) { Copy-Item -LiteralPath (Join-Path $deployRoot 'v2') -Destination (Join-Path $backupRoot 'v2') -Recurse }
  if (Compare-Object $mutableBefore (Get-MutableDeploySnapshot -Root $backupRoot)) {
    throw 'Recovery backup bytes do not match the pre-run mutable snapshot.'
  }

  if ($SelfTestScenario -eq 'ExternalBeforeFirstWrite') {
    Write-Utf8NoBom -Path (Join-Path $deployRoot 'README.md') -Content 'external bytes before first write'
  }

  $deployV2 = Join-Path $deployRoot 'v2'
  Assert-DirectDeployTarget -Root $deployRoot -Path $deployV2 -AllowedNames @('v2')
  if ($hadV2) {
    Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'V2 removal'
    $lastWrittenExpected = @($expectedAfterV2Removal)
    $deployMutationStarted = $true
    Remove-Item -LiteralPath $deployV2 -Recurse -Force
    Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'V2 removal validation'
  } else {
    $lastWrittenExpected = @($expectedAfterV2Removal)
  }
  Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'V2 publish'
  $lastWrittenExpected = @($expectedAfterV2Publish)
  $deployMutationStarted = $true
  Move-Item -LiteralPath $stagedV2Root -Destination $deployV2
  if ($SelfTestScenario -in @('ExternalAfterV2Swap', 'ExternalAfterPublishV2Write')) {
    Write-Utf8NoBom -Path (Join-Path $deployRoot 'README.md') -Content 'external bytes after V2 swap'
  }
  Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'V2 publish validation'
  if ($FailureInjection -eq 'AfterV2Swap') { throw 'Injected artifact failure after V2 swap.' }

  Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'root index publish'
  $lastWrittenExpected = @($expectedAfterIndexWrite)
  Copy-Item -LiteralPath (Join-Path $payloadRoot 'index.html') -Destination (Join-Path $deployRoot 'index.html') -Force
  Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'root index publish validation'
  if ($FailureInjection -eq 'AfterIndexWrite') { throw 'Injected artifact failure after index write.' }
  Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'README publish'
  $lastWrittenExpected = @($expectedMutableAfter)
  Copy-Item -LiteralPath (Join-Path $payloadRoot 'README.md') -Destination (Join-Path $deployRoot 'README.md') -Force
  Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'README publish validation'
  if ($FailureInjection -eq 'AfterReadmeWrite') { throw 'Injected artifact failure after README write.' }

  Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'final validation'
  Assert-V2Artifact -ArtifactRoot $deployV2 -ExpectedCommit $sourceCommitNormalized -ExpectedBuiltAt $BuiltAtUtc
  Assert-CommitMatchesArtifact -Source $sourceRoot -Commit $sourceCommitNormalized -ArtifactRoot $deployV2
  if (Compare-Object $expectedMutableAfter (Get-MutableDeploySnapshot -Root $deployRoot)) {
    throw 'Published index, README, or V2 bytes do not match the validated staged payload.'
  }
  Assert-DeployOnlyExpectedChanges -Root $deployRoot
  if (Compare-Object $v1Before (Get-TreeHashes -TreeRoot $v1Root -RelativeToRoot $deployRoot)) {
    throw 'V1 artifact changed.'
  }
  $deployHeadAfter = ((Invoke-RepositoryGit -Root $deployRoot -Arguments @('rev-parse', 'HEAD')) -join '').Trim().ToLowerInvariant()
  if ($deployHeadAfter -ne $deployHeadBefore) { throw 'Deploy repository HEAD changed during artifact creation.' }
  Assert-SourceStable -Root $sourceRoot -ExpectedCommit $sourceCommitNormalized

  Write-Output "V2 artifact built from $sourceCommitNormalized at $BuiltAtUtc"
} catch {
  $operationError = $_
  if ($deployMutationStarted) {
    try {
      Assert-MutableSnapshotCas -Root $deployRoot -Expected $lastWrittenExpected -Phase 'rollback eligibility'
      $null = Restore-DeployState -Root $deployRoot -BackupRoot $backupRoot -HadIndex $hadIndex `
        -HadReadme $hadReadme -HadV2 $hadV2 -ExpectedMutable $lastWrittenExpected `
        -SelfTestScenario $SelfTestScenario
      if (Compare-Object $mutableBefore (Get-MutableDeploySnapshot -Root $deployRoot)) {
        throw 'Restored deploy files do not match their pre-run hashes.'
      }
    } catch {
      throw "Artifact creation failed; rollback refused or failed so concurrent bytes remain untouched. Original: $operationError Recovery: $_"
    }
  }
  throw $operationError
} finally {
  Exit-DeployPublishLock -Lock $publishLock
  try {
    if (Test-Path -LiteralPath $runRoot) {
      $resolvedRunRoot = (Resolve-Path -LiteralPath $runRoot).Path
      $safePrefix = $tempRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar + 'beginner-budget-preview-v2-artifact-'
      if ($resolvedRunRoot.StartsWith($safePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force
        if ($SelfTestScenario -eq 'CleanupFailureAfterSuccess') {
          throw 'Injected cleanup failure after safe removal.'
        }
      }
    }
  } catch {
    Write-Warning "V2 artifact cleanup warning: $_"
  }
}
