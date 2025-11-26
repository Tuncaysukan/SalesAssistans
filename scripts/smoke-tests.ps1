$ErrorActionPreference = 'Stop'

function Get-EnvValue($name) {
  $root = Split-Path -Parent $PSCommandPath
  $envFile = Join-Path $root '.env'
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match "^$name=" } | Select-Object -First 1
    if ($line) { return ($line -split '=',2)[1] }
  }
  return $null
}

function Get-Json($method, $url, $body=$null, $headers=@{}) {
  if ($body -ne $null -and -not ($body -is [string])) { $body = ($body | ConvertTo-Json -Depth 8) }
  $resp = Invoke-RestMethod -Method $method -Uri $url -Headers $headers -ContentType 'application/json' -Body $body
  return $resp
}

function Get-Status($method, $url) {
  try { $w = Invoke-WebRequest -Method $method -Uri $url -UseBasicParsing; return $w.StatusCode }
  catch { if ($_.Exception.Response) { return $_.Exception.Response.StatusCode.Value__ } else { return -1 } }
}

function ComputeHmac($secret, $body) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($secret)
  $h = New-Object System.Security.Cryptography.HMACSHA256($bytes)
  $hash = $h.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))
  $hex = -join ($hash | ForEach-Object { $_.ToString('x2') })
  return 'sha256=' + $hex
}

$nodeBase = 'http://127.0.0.1:3001'
$laravelBase = Get-EnvValue 'LARAVEL_URL'
if (-not $laravelBase) { $laravelBase = 'http://127.0.0.1:8000/api' }

$results = @{}

try {
  $results.node_health = Get-Json 'GET' ($nodeBase + '/health/node')
} catch { $results.node_health = @{ ok=$false } }

try {
  $results.laravel_health = Get-Json 'GET' ($laravelBase + '/health/laravel')
} catch { $results.laravel_health = @{ ok=$false } }

$results.node_debug_error_status = Get-Status 'GET' ($nodeBase + '/debug/error')
$results.laravel_debug_error_status = Get-Status 'GET' ($laravelBase + '/debug/error')

$now = [int]([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())
$waBody = @{ entry = @(@{ changes = @(@{ value = @{ metadata = @{ phone_number_id = 'wa_dev_1' }; messages = @(@{ id='wamid.TEST_NOW'; from='905555555555'; timestamp=$now; text = @{ body = 'Merhaba, fiyat nedir?' } }) } }) }) }
try { $results.wa_ingest = Get-Json 'POST' ($nodeBase + '/webhooks/whatsapp') $waBody } catch { $results.wa_ingest = @{ ok=$false } }

try {
  $convs = Get-Json 'GET' ($nodeBase + '/conversations')
  $id = $convs.conversations[-1].id
  $results.latest_conv = $id
  $results.latest_draft = Get-Json 'GET' ($nodeBase + ('/ai/drafts/latest/' + $id))
  $results.send_text = Get-Json 'POST' ($nodeBase + ('/conversations/' + $id + '/send')) @{ text = 'Bilgileri paylaşıyorum.' }
} catch { }

$secret = Get-EnvValue 'INTERNAL_SECRET'
if (-not $secret) { $secret = 'devsecret123' }
$oldTsMs = ([DateTimeOffset]::UtcNow.AddDays(-3).ToUnixTimeMilliseconds())
$payloadObj = @{ channel='wa'; tenant_key='wa_dev_1'; external_contact_id='905000000000'; external_message_id='oldmsg1'; direction='in'; type='text'; body='Merhaba'; timestamp=$oldTsMs; meta=@{ raw=@{} } }
$payloadJson = $payloadObj | ConvertTo-Json -Depth 8
$sig = ComputeHmac $secret $payloadJson
try { $r = Get-Json 'POST' ($nodeBase + '/internal/ingest') $payloadObj @{ 'X-Internal-Signature' = $sig } ; $oldId = $r.conversation_id } catch { $oldId = $null }
if ($oldId) { try { $results.send_template = Get-Json 'POST' ($nodeBase + ('/conversations/' + $oldId + '/send')) @{ text = '24h-dışı test' } } catch { } }

try { $results.daily = Get-Json 'GET' ($nodeBase + '/reports/daily') } catch { }

$summary = [PSCustomObject]@{
  NodeHealth = $results.node_health
  LaravelHealth = $results.laravel_health
  NodeDebugErrorStatus = $results.node_debug_error_status
  LaravelDebugErrorStatus = $results.laravel_debug_error_status
  LatestConversationId = $results.latest_conv
  LatestDraft = $results.latest_draft
  SendText = $results.send_text
  SendTemplate = $results.send_template
  DailyReport = $results.daily
}

$summary | ConvertTo-Json -Depth 8

