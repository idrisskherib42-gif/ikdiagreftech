<#
Reproducible load test for IK DIAG's static server.

What it simulates: N concurrent "users" (default 5, matching the requirement),
each replaying the sequence of HTTP requests a real browser session generates
across the key user journeys (home, missions list, mission questionnaire
assets, field assistant, veille, surface calculator, health check).

Why a runspace pool and not Start-Job/ThreadJob: this environment is Windows
PowerShell 5.1 with no guarantee of internet access to install the ThreadJob
module, and Start-Job spins up a full separate process per job (slow, heavy).
A runspace pool gives real parallel execution inside a single process using
only the .NET types already loaded by serve.ps1 itself.

Usage:
  powershell -NoProfile -File loadtest.ps1
  powershell -NoProfile -File loadtest.ps1 -Users 10 -RequestsPerUser 40
#>
param(
  [int]$Users = 5,
  [int]$RequestsPerUser = 20,
  [string]$BaseUrl = "http://localhost:8080"
)

$paths = @(
  "/index.html",
  "/assets/css/style.css",
  "/assets/js/nav.js",
  "/assets/js/icons.js",
  "/assets/js/auth.js",
  "/assets/js/missions.js",
  "/assets/js/content.js",
  "/assets/js/util.js",
  "/assets/js/store.js",
  "/assets/js/crypto.js",
  "/assets/js/lock.js",
  "/assets/js/diagnostic-defs.js",
  "/missions.html",
  "/mission-nouvelle.html",
  "/assets/js/eligibility-wizard.js",
  "/assets/js/eligibility-rules.js",
  "/assets/js/questionnaire-defs.js",
  "/assistant-terrain.html",
  "/assistant-ia.html",
  "/veille.html",
  "/references.html",
  "/calculateur-surface.html",
  "/assets/js/calculators.js",
  "/healthz"
)

$userSession = {
  param($userId, $paths, $BaseUrl, $requestsPerUser)
  $local = New-Object System.Collections.Generic.List[object]
  for ($i = 0; $i -lt $requestsPerUser; $i++) {
    $path = $paths[$i % $paths.Count]
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
      $resp = Invoke-WebRequest -Uri "$BaseUrl$path" -UseBasicParsing -TimeoutSec 10
      $sw.Stop()
      $local.Add([PSCustomObject]@{ User = $userId; Path = $path; Status = [int]$resp.StatusCode; Ms = $sw.ElapsedMilliseconds; Ok = $true })
    } catch {
      $sw.Stop()
      $statusCode = 0
      if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
      $local.Add([PSCustomObject]@{ User = $userId; Path = $path; Status = $statusCode; Ms = $sw.ElapsedMilliseconds; Ok = $false })
    }
  }
  return $local
}

Write-Output "Load test: $Users concurrent users x $RequestsPerUser requests against $BaseUrl"
$overallSw = [System.Diagnostics.Stopwatch]::StartNew()

$pool = [runspacefactory]::CreateRunspacePool(1, $Users)
$pool.Open()
$jobs = @()

for ($u = 1; $u -le $Users; $u++) {
  $ps = [powershell]::Create()
  $ps.RunspacePool = $pool
  [void]$ps.AddScript($userSession).AddArgument($u).AddArgument($paths).AddArgument($BaseUrl).AddArgument($RequestsPerUser)
  $jobs += [PSCustomObject]@{ PS = $ps; Handle = $ps.BeginInvoke() }
}

$allResults = New-Object System.Collections.Generic.List[object]
foreach ($job in $jobs) {
  $res = $job.PS.EndInvoke($job.Handle)
  foreach ($r in $res) { $allResults.Add($r) }
  $job.PS.Dispose()
}
$pool.Close()
$overallSw.Stop()

$total = $allResults.Count
$failed = @($allResults | Where-Object { -not $_.Ok })
$times = $allResults | ForEach-Object { $_.Ms } | Sort-Object

function Percentile($sorted, $p) {
  if ($sorted.Count -eq 0) { return 0 }
  $idx = [Math]::Ceiling(($p / 100) * $sorted.Count) - 1
  if ($idx -lt 0) { $idx = 0 }
  return $sorted[$idx]
}

Write-Output ""
Write-Output "===== Results ====="
Write-Output ("Total requests   : {0}" -f $total)
Write-Output ("Failed requests  : {0} ({1:P1})" -f $failed.Count, ($(if ($total -gt 0) { $failed.Count / $total } else { 0 })))
Write-Output ("Wall clock time  : {0} ms (for all $Users users combined)" -f $overallSw.ElapsedMilliseconds)
Write-Output ("Throughput       : {0:N1} req/s" -f ($(if ($overallSw.ElapsedMilliseconds -gt 0) { $total / ($overallSw.ElapsedMilliseconds / 1000) } else { 0 })))
Write-Output ("Latency p50 / p95 / max (ms) : {0} / {1} / {2}" -f (Percentile $times 50), (Percentile $times 95), ($(if ($times.Count -gt 0) { $times[-1] } else { 0 })))

if ($failed.Count -gt 0) {
  Write-Output ""
  Write-Output "Failed requests detail:"
  $failed | Group-Object Path, Status | ForEach-Object { Write-Output ("  {0} x {1}" -f $_.Count, $_.Name) }
  exit 1
} else {
  Write-Output ""
  Write-Output "All requests succeeded."
  exit 0
}
