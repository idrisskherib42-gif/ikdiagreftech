param(
  [int]$Port = 8080,
  [string]$Root = $PSScriptRoot,
  # Number of requests processed concurrently. Before this fix, the server
  # handled requests one at a time in a blocking loop: with 5 users each
  # loading a page that pulls ~15-20 JS/CSS files, requests queued up instead
  # of being served in parallel. A PowerShell runspace pool acts as the
  # "connection pool" here: beyond MaxConcurrency in-flight requests, the next
  # ones wait in the pool queue instead of piling up on the single thread.
  [int]$MaxConcurrency = 12,
  # Extra hostnames to bind alongside localhost (e.g. "ikdiag.local"), for a
  # friendlier URL via a hosts-file entry. Each one needs a one-time
  # "netsh http add urlacl" reservation run as Administrator -- see README --
  # otherwise Start() below throws AccessDenied for that prefix and the
  # server won't start at all, even for localhost.
  [string[]]$ExtraHosts = @()
)

Add-Type -AssemblyName System.Net.HttpListener -ErrorAction SilentlyContinue

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
foreach ($h in $ExtraHosts) { $listener.Prefixes.Add("http://${h}:$Port/") }
$listener.Start()

$logPath = Join-Path $Root "access.log"
$logMutex = New-Object System.Threading.Mutex($false, "IkDiagAccessLogMutex")

Write-Output "IK DIAG static server running at $prefix (root: $Root, max concurrency: $MaxConcurrency)"
if ($ExtraHosts) { Write-Output "Also bound: $($ExtraHosts | ForEach-Object { "http://${_}:$Port/" })" }
Write-Output "Access log: $logPath -- health endpoint: ${prefix}healthz"

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".svg"  = "image/svg+xml"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".ico"  = "image/x-icon"
  ".webmanifest" = "application/manifest+json"
}

# NOTE: no HTTP caching (Cache-Control) is applied to JS/CSS on purpose. This
# app is actively edited (content, rules, checklists) and a diagnostiqueur
# must always see the current logic and regulatory content, not a stale copy
# served from browser cache after an update -- correctness beats the marginal
# load reduction here (the load test already shows the server keeps up
# without caching, see loadtest.ps1 / README).
$cacheableExt = @()

$requestHandler = {
  param($context, $Root, $mime, $cacheableExt, $logPath, $logMutex)

  $request = $context.Request
  $response = $context.Response
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $statusCode = 200
  $method = [string]$request.HttpMethod
  $urlPath = [string]$request.Url.AbsolutePath

  try {
    $path = [System.Uri]::UnescapeDataString($urlPath)

    if ($path -eq "/healthz") {
      $statusCode = 200
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("OK")
      $response.ContentType = "text/plain; charset=utf-8"
      $response.StatusCode = $statusCode
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
      return
    }

    if ($path -eq "/") { $path = "/index.html" }
    # Security: block any path segment starting with "." (.claude/, .git/,
    # dotfiles) before even resolving it -- these must never be reachable
    # over HTTP regardless of what else lives in the project folder.
    if ($path -match '(^|/)\.[^/]*') {
      $statusCode = 403
      $response.StatusCode = $statusCode
      return
    }

    $filePath = Join-Path $Root ($path.TrimStart("/"))
    $filePath = [System.IO.Path]::GetFullPath($filePath)
    $rootFull = [System.IO.Path]::GetFullPath($Root)

    if (-not $filePath.StartsWith($rootFull)) {
      $statusCode = 403
      $response.StatusCode = $statusCode
      return
    }

    if (Test-Path $filePath -PathType Container) {
      $filePath = Join-Path $filePath "index.html"
    }

    if (Test-Path $filePath -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
      $contentType = $mime[$ext]
      if (-not $contentType) {
        # Security fix: previously any extension not in $mime (.ps1, .log,
        # .md, ...) still fell back to a generic content-type and was served
        # anyway. A real test proved this exposed serve.ps1's own source and
        # would expose access.log or any future non-web file placed in this
        # folder. Only the extensions this app actually serves are allowed;
        # everything else answers 404, indistinguishable from "not found".
        $statusCode = 404
        $response.StatusCode = $statusCode
        $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
        $response.OutputStream.Write($notFound, 0, $notFound.Length)
        return
      }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $response.ContentType = $contentType
      if ($cacheableExt -contains $ext) {
        $response.Headers.Add("Cache-Control", "public, max-age=300")
      }
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
      $statusCode = 404
      $response.StatusCode = $statusCode
      $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
      $response.OutputStream.Write($notFound, 0, $notFound.Length)
    }
  } catch {
    # Security: never send exception details (internal file paths, .NET type
    # names, stack info) to the client -- a generic message only. The real
    # detail goes to access.log (server-side only) via $errorDetail below.
    $statusCode = 500
    $errorDetail = $_.Exception.Message
    try {
      $response.StatusCode = $statusCode
      $errBytes = [System.Text.Encoding]::UTF8.GetBytes("500 Internal Server Error")
      $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
    } catch {}
  } finally {
    $sw.Stop()
    try { $response.Close() } catch {}
    $line = "{0:yyyy-MM-dd HH:mm:ss} {1,-4} {2,-45} {3} {4,6}ms" -f (Get-Date), $method, $urlPath, $statusCode, $sw.ElapsedMilliseconds
    if ($errorDetail) { $line = "$line  ERROR: $errorDetail" }
    if ($logMutex.WaitOne(2000)) {
      try { Add-Content -Path $logPath -Value $line -Encoding utf8 } finally { $logMutex.ReleaseMutex() }
    }
  }
}

$runspacePool = [runspacefactory]::CreateRunspacePool(1, $MaxConcurrency)
$runspacePool.Open()
$pending = New-Object System.Collections.Generic.List[object]

function Clear-CompletedJobs {
  for ($i = $pending.Count - 1; $i -ge 0; $i--) {
    if ($pending[$i].Handle.IsCompleted) {
      try { $pending[$i].PS.EndInvoke($pending[$i].Handle) } catch { Write-Output "Request error: $($_.Exception.Message)" }
      $pending[$i].PS.Dispose()
      $pending.RemoveAt($i)
    }
  }
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()

    $ps = [powershell]::Create()
    $ps.RunspacePool = $runspacePool
    [void]$ps.AddScript($requestHandler).AddArgument($context).AddArgument($Root).AddArgument($mime).AddArgument($cacheableExt).AddArgument($logPath).AddArgument($logMutex)
    $handle = $ps.BeginInvoke()
    $pending.Add([PSCustomObject]@{ PS = $ps; Handle = $handle })

    Clear-CompletedJobs
  }
} finally {
  foreach ($job in $pending) {
    try { $job.Handle.AsyncWaitHandle.WaitOne(2000) | Out-Null; $job.PS.EndInvoke($job.Handle) } catch {}
    $job.PS.Dispose()
  }
  $runspacePool.Close()
  $listener.Stop()
}
