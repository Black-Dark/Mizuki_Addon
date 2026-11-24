param()
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$behavior = Join-Path $root behavior_pack
$resources = Join-Path $root resource_pack
$bp = Get-Content -Raw (Join-Path $behavior manifest.json) | ConvertFrom-Json
$rp = Get-Content -Raw (Join-Path $resources manifest.json) | ConvertFrom-Json
$version = $bp.header.version -join '.'
if ($version -notmatch '^\d+\.\d+\.\d+$' -or ($rp.header.version -join '.') -ne $version) {
    throw 'The two pack manifests must use the same three-part version.'
}
foreach ($module in @($bp.modules) + @($rp.modules)) {
    if (($module.version -join '.') -ne $version) { throw 'A module version does not match its pack.' }
}
$link = @($bp.dependencies | Where-Object uuid -eq $rp.header.uuid)
if ($link.Count -ne 1 -or ($link[0].version -join '.') -ne $version) {
    throw 'The behavior pack must reference the resource pack UUID and version.'
}
Get-ChildItem $behavior,$resources -Recurse -Filter *.json | ForEach-Object {
    Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json | Out-Null
}
Get-ChildItem (Join-Path $behavior scripts) -Recurse -Filter *.js | ForEach-Object {
    node --check $_.FullName
    if ($LASTEXITCODE) { throw "Syntax check failed for $($_.Name)." }
}
Push-Location $root
try {
    node --test tests/*.test.js
    if ($LASTEXITCODE) { throw 'Workshop tests failed.' }
} finally {
    Pop-Location
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$temp = New-Item -ItemType Directory (Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
try {
    foreach ($pack in @(@{Source=$behavior; File='Mizuki_Behavior.mcpack'}, @{Source=$resources; File='Mizuki_Resources.mcpack'})) {
        $path = Join-Path $temp.FullName $pack.File
        [System.IO.Compression.ZipFile]::CreateFromDirectory($pack.Source, $path)
    }
    $zip = Join-Path $root "dist/Chibi-Companions-Mizuki-$version.mcaddon"
    New-Item -ItemType Directory -Force (Split-Path $zip) | Out-Null
    $candidate = Join-Path $temp.Parent.FullName ($temp.Name + '.mcaddon')
    try {
        [System.IO.Compression.ZipFile]::CreateFromDirectory($temp.FullName, $candidate)
        Copy-Item -LiteralPath $candidate -Destination $zip -Force
    } finally {
        if (Test-Path -LiteralPath $candidate) { Remove-Item -LiteralPath $candidate }
    }
    Write-Output $zip
} finally {
    $temp.GetFiles() | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
    Remove-Item -LiteralPath $temp.FullName
}
