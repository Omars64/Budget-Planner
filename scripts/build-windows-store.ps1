$ErrorActionPreference = 'Stop'

$identity = $env:BUDGETLY_STORE_IDENTITY
$publisher = $env:BUDGETLY_STORE_PUBLISHER
$displayName = $env:BUDGETLY_STORE_PUBLISHER_DISPLAY_NAME
if ($identity -cnotmatch '^[A-Za-z0-9.-]{3,50}$' -or $publisher -notmatch '^CN=\S' -or -not $displayName) {
    throw 'Set BUDGETLY_STORE_IDENTITY, BUDGETLY_STORE_PUBLISHER and BUDGETLY_STORE_PUBLISHER_DISPLAY_NAME from Partner Center.'
}

$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root 'dist-desktop/store'
$resources = Join-Path $output 'resources'
$assets = Join-Path $resources 'appx'
$configFile = Join-Path $output 'builder.json'
New-Item -ItemType Directory -Force -Path $assets | Out-Null

Add-Type -AssemblyName System.Drawing
$logo = [System.Drawing.Image]::FromFile((Join-Path $root 'desktop/brand/navy.png'))
try {
    foreach ($size in @(@(50,50,'StoreLogo'), @(150,150,'Square150x150Logo'), @(44,44,'Square44x44Logo'), @(310,150,'Wide310x150Logo'))) {
        $width, $height, $name = $size
        $bitmap = [System.Drawing.Bitmap]::new($width, $height)
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try {
            $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $graphics.DrawImage($logo, [int](($width - $height) / 2), 0, $height, $height)
            $bitmap.Save((Join-Path $assets "${name}.png"), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $graphics.Dispose()
            $bitmap.Dispose()
        }
    }
} finally {
    $logo.Dispose()
}

$package = Get-Content -Raw -LiteralPath (Join-Path $root 'package.json') | ConvertFrom-Json
$config = $package.build
$config.directories.output = $output
$config.directories | Add-Member -NotePropertyName buildResources -NotePropertyValue $resources
$config | Add-Member -NotePropertyName appx -NotePropertyValue @{
    identityName = $identity
    publisher = [System.Security.SecurityElement]::Escape($publisher)
    publisherDisplayName = [System.Security.SecurityElement]::Escape($displayName)
    applicationId = 'Budgetly'
    backgroundColor = 'transparent'
    artifactName = 'Budgetly-Store-${version}.${ext}'
}
$json = $config | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText($configFile, $json, [System.Text.UTF8Encoding]::new($false))

Push-Location $root
try {
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "Budgetly frontend build failed (exit $LASTEXITCODE)." }
    & (Join-Path $root 'node_modules/.bin/electron-builder.cmd') --config $configFile --win appx --x64 --publish never
    if ($LASTEXITCODE -ne 0) { throw "Budgetly Store packaging failed (exit $LASTEXITCODE)." }
} finally {
    Pop-Location
}
