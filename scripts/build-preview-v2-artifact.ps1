[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$SourceRoot,
  [Parameter(Mandatory)][string]$DeployRoot,
  [Parameter(Mandatory)][string]$SourceCommit,
  [Parameter(Mandatory)][string]$BuiltAtUtc
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-DeployGit {
  param([Parameter(Mandatory)][string[]]$Arguments)

  $output = & git -c "safe.directory=$($script:deployRoot.Replace('\', '/'))" -C $script:deployRoot @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "deploy git $($Arguments -join ' ') failed:`n$($output -join [Environment]::NewLine)"
  }
  return @($output)
}

function Get-TreeHashes {
  param([Parameter(Mandatory)][string]$Root)

  if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return @() }
  return @(
    Get-ChildItem -LiteralPath $Root -Recurse -File |
      Sort-Object FullName |
      ForEach-Object {
        '{0} {1}' -f $_.FullName.Substring($script:deployRoot.Length), (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash
      }
  )
}

$sourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path.TrimEnd('\')
$deployRoot = (Resolve-Path -LiteralPath $DeployRoot).Path.TrimEnd('\')

if ($SourceCommit -notmatch '^[0-9a-fA-F]{40}$') {
  throw 'SourceCommit must be an exact 40-character hexadecimal SHA.'
}
$parsedBuiltAt = [DateTimeOffset]::MinValue
$builtAtParses = [DateTimeOffset]::TryParseExact(
    $BuiltAtUtc,
    @('yyyy-MM-ddTHH:mm:ssZ', 'yyyy-MM-ddTHH:mm:ss.FFFFFFFZ'),
    [System.Globalization.CultureInfo]::InvariantCulture,
    [System.Globalization.DateTimeStyles]::AssumeUniversal,
    [ref]$parsedBuiltAt
  )
if ($BuiltAtUtc -notmatch '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$' -or -not $builtAtParses) {
  throw 'BuiltAtUtc must be a UTC ISO-8601 value ending in Z.'
}

$sourceHead = (& git -C $sourceRoot rev-parse HEAD 2>&1)
if ($LASTEXITCODE -ne 0 -or ([string]$sourceHead).Trim() -ne $SourceCommit.ToLowerInvariant()) {
  throw 'SourceCommit does not match SourceRoot HEAD.'
}

$deployStatus = (Invoke-DeployGit @('status', '--porcelain')) -join "`n"
if ($deployStatus) { throw 'Deploy repository must be clean before artifact creation.' }
$deployBranch = ((Invoke-DeployGit @('branch', '--show-current')) -join '').Trim()
if ($deployBranch -ne 'main') { throw "Deploy repository must be on main, not '$deployBranch'." }
$deployHeadBefore = ((Invoke-DeployGit @('rev-parse', 'HEAD')) -join '').Trim()
if ($deployHeadBefore -notmatch '^[0-9a-f]{40}$') { throw 'Deploy repository HEAD is invalid.' }

$v1Before = Get-TreeHashes -Root (Join-Path $deployRoot 'v1')
$artifactFiles = @(
  'index.html', 'css/style.css', 'js/storage.js', 'js/transactions.js',
  'js/cloud.js', 'js/ui.js', 'js/app.js'
)

foreach ($relative in $artifactFiles) {
  $sourceFile = Join-Path $sourceRoot $relative
  if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
    throw "Required source artifact is missing: $relative"
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $deployRoot 'v2\css'), (Join-Path $deployRoot 'v2\js') | Out-Null
foreach ($relative in $artifactFiles) {
  $target = Join-Path (Join-Path $deployRoot 'v2') $relative
  Copy-Item -LiteralPath (Join-Path $sourceRoot $relative) -Destination $target
}

$version = [ordered]@{
  version = 'v2'
  sourceRepository = 'https://github.com/suho-j/beginner-budget'
  sourceBranch = 'guardian/budget-preview-v2'
  sourceCommit = $SourceCommit.ToLowerInvariant()
  builtAt = $BuiltAtUtc
  testCount = 87
  environment = 'preview-v2'
  dataTables = @('preview_v2_budget_settings', 'preview_v2_transactions')
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText(
  (Join-Path $deployRoot 'v2\version.json'),
  (($version | ConvertTo-Json -Depth 4) + "`n"),
  $utf8NoBom
)

$rootLandingBase64 = 'PCFkb2N0eXBlIGh0bWw+CjxodG1sIGxhbmc9ImtvIj4KPGhlYWQ+CiAgPG1ldGEgY2hhcnNldD0idXRmLTgiPgogIDxtZXRhIG5hbWU9InZpZXdwb3J0IiBjb250ZW50PSJ3aWR0aD1kZXZpY2Utd2lkdGgsIGluaXRpYWwtc2NhbGU9MSI+CiAgPHRpdGxlPuyeheusuOyekCDqsIDqs4TrtoAg6rCc67CcIOuvuOumrOuztOq4sDwvdGl0bGU+CjwvaGVhZD4KPGJvZHk+CiAgPG1haW4+CiAgICA8aDE+7J6F66y47J6QIOqwgOqzhOu2gCDqsJzrsJwg66+466as67O06riwPC9oMT4KICAgIDxwPuqwgSDrsoTsoITsnYAg6rKp66as65CcIOqwnOuwnCDrr7jrpqzrs7TquLDsnoXri4jri6QuPC9wPgogICAgPG5hdiBhcmlhLWxhYmVsPSLrr7jrpqzrs7TquLAg67KE7KCEIj4KICAgICAgPGEgaHJlZj0iL2JlZ2lubmVyLWJ1ZGdldC1wcmV2aWV3L3YxLyI+VjEg4oCUIO2DrcK37IiY7KCVwrfsupjrprDrjZQ8L2E+CiAgICAgIDxhIGhyZWY9Ii9iZWdpbm5lci1idWRnZXQtcHJldmlldy92Mi8iPlYyIOKAlCDrsJjrs7Xsp4DstpzCt+yYiOyglSDrgrTsl608L2E+CiAgICA8L25hdj4KICA8L21haW4+CjwvYm9keT4KPC9odG1sPg=='
$readmeTemplateBase64 = 'IyBiZWdpbm5lci1idWRnZXQtcHJldmlldwoK6rCBIOuyhOyghOydgCDqsqnrpqzrkJwg6rCc67CcIOuvuOumrOuztOq4sOyeheuLiOuLpC4KCnwgdmVyc2lvbiB8IHB1YmxpYyBVUkwgfCBzb3VyY2UgYnJhbmNoIHwgc291cmNlIFNIQSB8IGRhdGEgdGFibGVzIHwKfC0tLXwtLS18LS0tfC0tLXwtLS18CnwgVjEgfCBodHRwczovL3N1aG8tai5naXRodWIuaW8vYmVnaW5uZXItYnVkZ2V0LXByZXZpZXcvdjEvIHwgYGd1YXJkaWFuL2J1ZGdldC1wcmV2aWV3LXYxYCB8IGAyYjdkMzRmZjg0MzA1ZmRmZTY3OTQzM2JjZTEyNzk5Mzg2MWRmZmEwYCB8IGBwcmV2aWV3X2J1ZGdldF9zZXR0aW5nc2AsIGBwcmV2aWV3X3RyYW5zYWN0aW9uc2AgfAp8IFYyIHwgaHR0cHM6Ly9zdWhvLWouZ2l0aHViLmlvL2JlZ2lubmVyLWJ1ZGdldC1wcmV2aWV3L3YyLyB8IGBndWFyZGlhbi9idWRnZXQtcHJldmlldy12MmAgfCBgX19TT1VSQ0VfQ09NTUlUX19gIHwgYHByZXZpZXdfdjJfYnVkZ2V0X3NldHRpbmdzYCwgYHByZXZpZXdfdjJfdHJhbnNhY3Rpb25zYCB8'
$rootLanding = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($rootLandingBase64))
$readmeTemplate = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($readmeTemplateBase64))
$readme = $readmeTemplate.Replace('__SOURCE_COMMIT__', $SourceCommit.ToLowerInvariant())
[System.IO.File]::WriteAllText((Join-Path $deployRoot 'index.html'), ($rootLanding.TrimStart() + "`n"), $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $deployRoot 'README.md'), ($readme.TrimStart() + "`n"), $utf8NoBom)

foreach ($relative in $artifactFiles) {
  $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $sourceRoot $relative)).Hash
  $deployHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path (Join-Path $deployRoot 'v2') $relative)).Hash
  if ($sourceHash -ne $deployHash) { throw "V2 artifact mismatch: $relative" }
}

$v2Files = @(
  Get-ChildItem -LiteralPath (Join-Path $deployRoot 'v2') -Recurse -File |
    ForEach-Object { $_.FullName.Substring((Join-Path $deployRoot 'v2').Length + 1).Replace('\', '/') } |
    Sort-Object
)
$expectedV2Files = @($artifactFiles + 'version.json' | ForEach-Object { $_.Replace('\', '/') } | Sort-Object)
if (Compare-Object $expectedV2Files $v2Files) {
  throw 'V2 artifact contains files outside the exact eight-file contract.'
}

$v1After = Get-TreeHashes -Root (Join-Path $deployRoot 'v1')
if (Compare-Object $v1Before $v1After) { throw 'V1 artifact changed' }

$deployedIndex = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $deployRoot 'v2\index.html')
if ($deployedIndex -match '(?:src|href)=["'']/(?:css|js)/') {
  throw 'V2 index local asset paths must remain relative.'
}
$deployedVersion = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $deployRoot 'v2\version.json') | ConvertFrom-Json
$versionContractFailed = $deployedVersion.sourceCommit -ne $SourceCommit.ToLowerInvariant() `
  -or $deployedVersion.builtAt -ne $BuiltAtUtc `
  -or $deployedVersion.testCount -ne 87 `
  -or $deployedVersion.environment -ne 'preview-v2' `
  -or @($deployedVersion.dataTables).Count -ne 2 `
  -or @($deployedVersion.dataTables)[0] -ne 'preview_v2_budget_settings' `
  -or @($deployedVersion.dataTables)[1] -ne 'preview_v2_transactions'
if ($versionContractFailed) {
  throw 'V2 version.json does not match the fixed metadata contract.'
}

$deployHeadAfter = ((Invoke-DeployGit @('rev-parse', 'HEAD')) -join '').Trim()
if ($deployHeadAfter -ne $deployHeadBefore) { throw 'Deploy repository HEAD changed during artifact creation.' }

Write-Output "V2 artifact built from $($SourceCommit.ToLowerInvariant()) at $BuiltAtUtc"
