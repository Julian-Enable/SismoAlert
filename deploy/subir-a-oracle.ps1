param(
  [Parameter(Mandatory = $true)][string]$Ip,
  [Parameter(Mandatory = $true)][string]$KeyPath,
  [string]$Domain = "sismoalert.duckdns.org",
  [Parameter(Mandatory = $true)][string]$DuckToken,
  [string]$User = "ubuntu"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
$stage = Join-Path $env:TEMP "sismoalert-stage"
$zip = Join-Path $env:TEMP "sismoalert.zip"

if (-not (Test-Path $KeyPath)) { throw "No encuentro la llave: $KeyPath" }

Write-Host "==> Preparando paquete (sin node_modules)"
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage | Out-Null
foreach ($item in @("src", "public", "package.json", "package-lock.json", ".env")) {
  $src = Join-Path $root $item
  if (Test-Path $src) {
    if ((Get-Item $src).PSIsContainer) { Copy-Item $src $stage -Recurse }
    else { Copy-Item $src $stage }
  }
}
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip
Write-Host "Paquete: $zip"

$sshArgs = @("-i", $KeyPath, "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=15")

Write-Host "==> Subiendo a ${User}@${Ip}..."
& scp @sshArgs $zip "${User}@${Ip}:~/sismoalert.zip"
if ($LASTEXITCODE -ne 0) { throw "scp del paquete fallo" }
& scp @sshArgs (Join-Path $PSScriptRoot "setup.sh") "${User}@${Ip}:~/setup.sh"
if ($LASTEXITCODE -ne 0) { throw "scp de setup.sh fallo" }

Write-Host "==> Instalando en la VM (2-4 min)..."
& ssh @sshArgs "${User}@${Ip}" "bash ~/setup.sh `"$Domain`" `"$DuckToken`""
if ($LASTEXITCODE -ne 0) { Write-Warning "El setup termino con errores, revisa la salida." }

Write-Host ""
Write-Host "Abre tu servidor en: https://$Domain"
Write-Host "Para ver los registros: ssh -i $KeyPath ${User}@${Ip} 'journalctl -u sismoalert -f'"