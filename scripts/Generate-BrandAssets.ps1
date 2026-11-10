# Render the approved root-level artwork for the browser, Windows and Android.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$res = Join-Path $root 'android/app/src/main/res'
$palettes = [ordered]@{ navy='#101E33'; aubergine='#150929'; burgundy='#321622'; pine='#132B25'; graphite='#20232C' }
# Keep the textured tile within Android's 66 dp safe zone on the 108 dp layer.
$androidLauncherFill = 66.0 / 108.0

function Get-IconBounds([Drawing.Bitmap]$image) {
    $left = $image.Width; $top = $image.Height; $right = 0; $bottom = 0
    for ($y = 0; $y -lt $image.Height; $y += 4) {
        for ($x = 0; $x -lt $image.Width; $x += 4) {
            if ($image.GetPixel($x, $y).A -le 128) { continue }
            $left = [Math]::Min($left, $x); $top = [Math]::Min($top, $y)
            $right = [Math]::Max($right, $x); $bottom = [Math]::Max($bottom, $y)
        }
    }
    if ($left -ge $right -or $top -ge $bottom) { throw 'Missing wallet artwork.' }
    $left = [Math]::Max(0, $left - 5); $top = [Math]::Max(0, $top - 5)
    $right = [Math]::Min($image.Width, $right + 6); $bottom = [Math]::Min($image.Height, $bottom + 6)
    return [Drawing.RectangleF]::new($left, $top, ($right - $left), ($bottom - $top))
}

function New-IconBitmap([int]$width, [int]$height, [double]$fill, [string]$background) {
    $bitmap = [Drawing.Bitmap]::new($width, $height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        if ($background) { $graphics.Clear([Drawing.ColorTranslator]::FromHtml($background)) }
        $scale = [Math]::Min($width, $height) * $fill / [Math]::Max($bounds.Width, $bounds.Height)
        $w = $bounds.Width * $scale
        $h = $bounds.Height * $scale
        $destination = [Drawing.RectangleF]::new((($width - $w) / 2), (($height - $h) / 2), $w, $h)
        $graphics.DrawImage($source, $destination, $bounds, [Drawing.GraphicsUnit]::Pixel)
    } finally { $graphics.Dispose() }
    return $bitmap
}

function Save-Png([string]$path, [int]$width, [int]$height, [double]$fill, [string]$background) {
    $bitmap = New-IconBitmap $width $height $fill $background
    try { $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png) }
    finally { $bitmap.Dispose() }
}

function Save-ExistingPng([string]$path, [double]$fill, [string]$background) {
    $old = [Drawing.Image]::FromFile($path)
    try { $width = $old.Width; $height = $old.Height } finally { $old.Dispose() }
    Save-Png $path $width $height $fill $background
}

function Save-Ico([string]$path, [int[]]$sizes) {
    $frames = foreach ($size in $sizes) {
        $bitmap = New-IconBitmap $size $size .97
        $stream = [IO.MemoryStream]::new()
        try {
            $bitmap.Save($stream, [Drawing.Imaging.ImageFormat]::Png)
            @{ Size=$size; Data=$stream.ToArray() }
        } finally { $bitmap.Dispose(); $stream.Dispose() }
    }
    $writer = [IO.BinaryWriter]::new([IO.File]::Create($path))
    try {
        $writer.Write([uint16]0)
        $writer.Write([uint16]1)
        $writer.Write([uint16]$frames.Count)
        $offset = 6 + 16 * $frames.Count
        foreach ($frame in $frames) {
            $dimension = [byte]($frame.Size % 256)
            $writer.Write($dimension)
            $writer.Write($dimension)
            $writer.Write([uint16]0)
            $writer.Write([uint16]1)
            $writer.Write([uint16]32)
            $writer.Write([uint32]$frame.Data.Length)
            $writer.Write([uint32]$offset)
            $offset += $frame.Data.Length
        }
        foreach ($frame in $frames) { $writer.Write([byte[]]$frame.Data) }
    } finally { $writer.Dispose() }
}

$foregrounds = New-Item -ItemType Directory -Path (Join-Path $res 'drawable-nodpi') -Force
$colors = @()
foreach ($key in $palettes.Keys) {
    $source = [Drawing.Bitmap]::new((Join-Path $root "brand-assets/wallet-$key.png"))
    try {
        $bounds = Get-IconBounds $source
        Save-Png (Join-Path $root "public/brand/wallet-$key.png") 256 256 .96
        Save-Png (Join-Path $root "desktop/brand/$key.png") 128 128 .96
        if ($key -eq 'navy') {
            Save-Png (Join-Path $root 'public/budgetly-wallet-icon.png') 512 512 .96
            Save-Png (Join-Path $root 'public/budgetly-wallet-maskable.png') 512 512 .76 $palettes[$key]
            Save-Ico (Join-Path $root 'public/favicon.ico') @(16,32,48)
            Save-Ico (Join-Path $root 'desktop/icon.ico') @(16,24,32,48,64,128,256)
            Get-ChildItem -Path $res -Directory -Filter 'mipmap-*' | ForEach-Object {
                Get-ChildItem -LiteralPath $_.FullName -Filter 'ic_launcher*.png' | ForEach-Object {
                    $fill = if ($_.Name -eq 'ic_launcher_foreground.png') { $androidLauncherFill } else { .96 }
                    Save-ExistingPng $_.FullName $fill
                }
            }
            Get-ChildItem -Path $res -Directory -Filter 'drawable*' | ForEach-Object {
                $splash = Join-Path $_.FullName 'splash.png'
                if (Test-Path -LiteralPath $splash) { Save-ExistingPng $splash .42 '#F4F8FB' }
            }
            Save-ExistingPng (Join-Path $res 'drawable/flowbudget_logo.png') .84
            continue
        }

        $resource = "wallet_launcher_$key"
        Save-Png (Join-Path $res "mipmap-xxxhdpi/$resource.png") 192 192 .96
        Save-Png (Join-Path $foregrounds.FullName "${resource}_art.png") 432 432 $androidLauncherFill
        $colors += "    <color name=""${resource}_background"">$($palettes[$key])</color>"
        @"
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/${resource}_background" />
    <foreground android:drawable="@drawable/${resource}_art" />
</adaptive-icon>
"@ | Set-Content -LiteralPath (Join-Path $res "mipmap-anydpi-v26/$resource.xml") -Encoding UTF8
    } finally { $source.Dispose() }
}
@('<?xml version="1.0" encoding="utf-8"?>','<resources>') + $colors + '</resources>' |
    Set-Content -LiteralPath (Join-Path $res 'values/wallet_launcher_colors.xml') -Encoding UTF8
