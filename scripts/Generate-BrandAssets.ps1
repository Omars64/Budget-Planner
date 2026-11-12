# Render the approved root-level artwork for the browser, Windows and Android.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$res = Join-Path $root 'android/app/src/main/res'
$palettes = (Get-Content -LiteralPath (Join-Path $root 'src/lib/colorPalettes.json') -Raw | ConvertFrom-Json).PSObject.Properties
# Size the wallet itself inside Android's 108 dp adaptive icon layer.
$androidLauncherFill = 52.0 / 108.0

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

function New-WalletTile([string]$background) {
    $size = 512
    $corner = 256
    $tile = [Drawing.Bitmap]::new($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($tile)
    $shape = [Drawing.Drawing2D.GraphicsPath]::new()
    $brush = [Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($background))
    $wallet = New-IconBitmap $size $size .72
    try {
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $shape.AddArc(0, 0, $corner, $corner, 180, 90)
        $shape.AddArc(($size - $corner), 0, $corner, $corner, 270, 90)
        $shape.AddArc(($size - $corner), ($size - $corner), $corner, $corner, 0, 90)
        $shape.AddArc(0, ($size - $corner), $corner, $corner, 90, 90)
        $shape.CloseFigure()
        $graphics.FillPath($brush, $shape)
        $graphics.DrawImageUnscaled($wallet, 0, 0)
    } finally {
        $wallet.Dispose()
        $brush.Dispose()
        $shape.Dispose()
        $graphics.Dispose()
    }
    return $tile
}

$foregrounds = New-Item -ItemType Directory -Path (Join-Path $res 'drawable-nodpi') -Force
$colors = @()
foreach ($palette in $palettes) {
    $key = $palette.Name
    $background = $palette.Value.iconBackground
    $relative = if ($palette.Value.composeIcon) { "brand-assets/android/wallet-$key.png" } else { "brand-assets/wallet-$key.png" }
    $source = [Drawing.Bitmap]::new((Join-Path $root $relative))
    try {
        $bounds = Get-IconBounds $source
        if ($palette.Value.composeIcon) {
            $foreground = $source
            $source = New-WalletTile $background
            $foreground.Dispose()
            $bounds = Get-IconBounds $source
        }
        Save-Png (Join-Path $root "public/brand/wallet-$key.png") 256 256 .96
        Save-Png (Join-Path $root "desktop/brand/$key.png") 128 128 .96
        Save-Ico (Join-Path $root "desktop/brand/$key.ico") @(16,24,32,48,64,128,256)
        if ($key -eq 'navy') {
            Save-Png (Join-Path $root 'public/budgetly-wallet-icon.png') 512 512 .96
            Save-Png (Join-Path $root 'public/budgetly-wallet-maskable.png') 512 512 .76 $background
            Save-Ico (Join-Path $root 'public/favicon.ico') @(16,32,48)
            Save-Ico (Join-Path $root 'desktop/icon.ico') @(16,24,32,48,64,128,256)
            Get-ChildItem -Path $res -Directory -Filter 'mipmap-*' | ForEach-Object {
                Get-ChildItem -LiteralPath $_.FullName -Filter 'ic_launcher*.png' |
                    Where-Object Name -ne 'ic_launcher_foreground.png' |
                    ForEach-Object { Save-ExistingPng $_.FullName .96 }
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
        $colors += "    <color name=""${resource}_background"">$background</color>"
        @"
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/${resource}_background" />
    <foreground android:drawable="@drawable/${resource}_art" />
</adaptive-icon>
"@ | Set-Content -LiteralPath (Join-Path $res "mipmap-anydpi-v26/$resource.xml") -Encoding UTF8
    } finally { $source.Dispose() }
}

foreach ($key in $palettes.Name) {
    $source = [Drawing.Bitmap]::new((Join-Path $root "brand-assets/android/wallet-$key.png"))
    try {
        $bounds = Get-IconBounds $source
        if ($key -eq 'navy') {
            Get-ChildItem -Path $res -Directory -Filter 'mipmap-*' | ForEach-Object {
                Get-ChildItem -LiteralPath $_.FullName -Filter 'ic_launcher_foreground.png' |
                    ForEach-Object { Save-ExistingPng $_.FullName $androidLauncherFill }
            }
        } else {
            Save-Png (Join-Path $foregrounds.FullName "wallet_launcher_${key}_art.png") 432 432 $androidLauncherFill
        }
    } finally { $source.Dispose() }
}

@('<?xml version="1.0" encoding="utf-8"?>','<resources>') + $colors + '</resources>' |
    Set-Content -LiteralPath (Join-Path $res 'values/wallet_launcher_colors.xml') -Encoding UTF8

$navyBackground = ($palettes | Where-Object Name -eq 'navy').Value.iconBackground
@('<?xml version="1.0" encoding="utf-8"?>','<resources>',"    <color name=""ic_launcher_background"">$navyBackground</color>",'</resources>') |
    Set-Content -LiteralPath (Join-Path $res 'values/ic_launcher_background.xml') -Encoding UTF8

$keys = foreach ($key in $palettes.Name) { "        <item>$key</item>" }
@('<?xml version="1.0" encoding="utf-8"?>','<resources>','    <string-array name="budgetly_launcher_palettes" translatable="false">') + $keys + @('    </string-array>','</resources>') |
    Set-Content -LiteralPath (Join-Path $res 'values/wallet_launcher_palettes.xml') -Encoding UTF8
