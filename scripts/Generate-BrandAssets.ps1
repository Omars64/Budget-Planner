# Render the smooth matte wallet for the browser, Windows and Android.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'WalletIconArtwork.cs') -ReferencedAssemblies System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$res = Join-Path $root 'android/app/src/main/res'
$palettes = (Get-Content -LiteralPath (Join-Path $root 'src/lib/colorPalettes.json') -Raw | ConvertFrom-Json).PSObject.Properties

function Resize-Icon([Drawing.Bitmap]$source, [int]$size) {
    $bitmap = [Drawing.Bitmap]::new($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($source, 0, 0, $size, $size)
    } finally { $graphics.Dispose() }
    return $bitmap
}

function Save-Png([Drawing.Bitmap]$source, [string]$path, [int]$size) {
    if ($source.Width -eq $size) {
        $source.Save($path, [Drawing.Imaging.ImageFormat]::Png)
        return
    }
    $bitmap = Resize-Icon $source $size
    try { $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png) }
    finally { $bitmap.Dispose() }
}

function Save-Ico([Drawing.Bitmap]$source, [string]$path, [int[]]$sizes) {
    $frames = foreach ($size in $sizes) {
        $bitmap = Resize-Icon $source $size
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

function Save-AtExistingSize([Drawing.Bitmap]$source, [string]$path) {
    $old = [Drawing.Image]::FromFile($path)
    try { $size = $old.Width } finally { $old.Dispose() }
    Save-Png $source $path $size
}

$windowsSizes = @(16,24,32,48,64,128,256)
$colors = foreach ($palette in $palettes) {
    $key = $palette.Name
    $background, $detail, $wallet = $palette.Value.iconColors
    $dark = [Drawing.ColorTranslator]::FromHtml($background)
    $mid = [Drawing.ColorTranslator]::FromHtml($detail)
    $light = [Drawing.ColorTranslator]::FromHtml($wallet)
    $tile = [WalletIconArtwork]::Render($dark, $mid, $light, 512, 'tile')
    $android = [WalletIconArtwork]::Render($dark, $mid, $light, 512, 'android')
    $adaptive = [WalletIconArtwork]::Render($dark, $mid, $light, 432, 'adaptive')
    try {
        Save-Png $tile (Join-Path $root "brand-assets/wallet-$key.png") 512
        Save-Png $adaptive (Join-Path $root "brand-assets/android/wallet-$key.png") 432
        Save-Png $tile (Join-Path $root "public/brand/wallet-$key.png") 256
        Save-Png $tile (Join-Path $root "desktop/brand/$key.png") 128
        Save-Ico $tile (Join-Path $root "desktop/brand/$key.ico") $windowsSizes

        if ($key -eq 'navy') {
            Save-Png $tile (Join-Path $root 'public/budgetly-wallet-icon.png') 512
            $maskable = [WalletIconArtwork]::Render($dark, $mid, $light, 512, 'maskable')
            try { Save-Png $maskable (Join-Path $root 'public/budgetly-wallet-maskable.png') 512 }
            finally { $maskable.Dispose() }
            Save-Ico $tile (Join-Path $root 'public/favicon.ico') @(16,32,48)
            Save-Ico $tile (Join-Path $root 'desktop/icon.ico') $windowsSizes
            Get-ChildItem -LiteralPath $res -Directory -Filter 'mipmap-*' |
                ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -File -Filter 'ic_launcher*.png' } |
                ForEach-Object {
                    $source = if ($_.Name -eq 'ic_launcher_foreground.png') { $adaptive } else { $android }
                    Save-AtExistingSize $source $_.FullName
                }
            Save-Png $adaptive (Join-Path $res 'drawable/flowbudget_logo.png') 432
        } else {
            $resource = "wallet_launcher_$key"
            Save-Png $android (Join-Path $res "mipmap-xxxhdpi/$resource.png") 192
            Save-Png $adaptive (Join-Path $res "drawable-nodpi/${resource}_art.png") 432
            @"
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/${resource}_background" />
    <foreground android:drawable="@drawable/${resource}_art" />
</adaptive-icon>
"@ | Set-Content -LiteralPath (Join-Path $res "mipmap-anydpi-v26/$resource.xml") -Encoding Ascii
            "    <color name=""${resource}_background"">$background</color>"
        }
    } finally { $tile.Dispose(); $android.Dispose(); $adaptive.Dispose() }
}

@('<?xml version="1.0" encoding="utf-8"?>','<resources>') + $colors + '</resources>' |
    Set-Content -LiteralPath (Join-Path $res 'values/wallet_launcher_colors.xml') -Encoding UTF8

$navyBackground = ($palettes | Where-Object Name -eq 'navy').Value.iconColors[0]
@('<?xml version="1.0" encoding="utf-8"?>','<resources>',"    <color name=""ic_launcher_background"">$navyBackground</color>",'</resources>') |
    Set-Content -LiteralPath (Join-Path $res 'values/ic_launcher_background.xml') -Encoding UTF8

$keys = foreach ($key in $palettes.Name) { "        <item>$key</item>" }
@('<?xml version="1.0" encoding="utf-8"?>','<resources>','    <string-array name="budgetly_launcher_palettes" translatable="false">') + $keys + @('    </string-array>','</resources>') |
    Set-Content -LiteralPath (Join-Path $res 'values/wallet_launcher_palettes.xml') -Encoding Ascii
