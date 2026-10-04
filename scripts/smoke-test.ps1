$ErrorActionPreference = 'Stop'
$services = @('http://localhost:3001/health', 'http://localhost:3002/health', 'http://localhost:3003/health')
foreach ($url in $services) {
  $response = Invoke-RestMethod -Uri $url -Method Get
  if ($response.status -ne 'ok') { throw "Health check failed: $url" }
  Write-Host "OK $url"
}
