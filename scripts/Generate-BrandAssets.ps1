# Resize the approved transparent source into Android's density and splash assets.
Add-Type -AssemblyName System.Drawing
$root = Split-Path $PSScriptRoot -Parent
$source = [System.Drawing.Image]::FromFile((Join-Path $root 'public/flowbudget-logo.png'))
$res = Join-Path $root 'android/app/src/main/res'
try {
    function Save-Png([string]$path, [int]$width, [int]$height, [bool]$splash, [bool]$foreground, [bool]$maskable = $false) {
        $bitmap = New-Object System.Drawing.Bitmap($width, $height)
        try {
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                if ($splash) { $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#F4F8FB')) }
                elseif ($maskable) { $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#101E33')) }
                else { $graphics.Clear([System.Drawing.Color]::Transparent) }
                $side = if ($splash) { [int]([Math]::Min($width, $height) * 0.42) } elseif ($foreground -or $maskable) { [int]($width * 0.70) } else { [int]([Math]::Min($width, $height) * 0.78) }
                $left = [int](($width - $side) / 2)
                $top = [int](($height - $side) / 2)
                $graphics.DrawImage($source, $left, $top, $side, $side)
            } finally { $graphics.Dispose() }
            $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
        } finally { $bitmap.Dispose() }
    }
    Get-ChildItem -Path $res -Directory -Filter 'mipmap-*' | ForEach-Object {
        Get-ChildItem -Path $_.FullName -Filter 'ic_launcher*.png' | ForEach-Object {
            $old = [System.Drawing.Image]::FromFile($_.FullName)
            try { $w = $old.Width; $h = $old.Height } finally { $old.Dispose() }
            Save-Png $_.FullName $w $h $false ($_.Name -eq 'ic_launcher_foreground.png')
        }
    }
    Get-ChildItem -Path $res -Directory -Filter 'drawable*' | ForEach-Object {
        $splash = Join-Path $_.FullName 'splash.png'
        if (Test-Path $splash) {
            $old = [System.Drawing.Image]::FromFile($splash)
            try { $w = $old.Width; $h = $old.Height } finally { $old.Dispose() }
            Save-Png $splash $w $h $true $false
        }
    }
    Save-Png (Join-Path $root 'public/budgetly-wallet-maskable.png') 1254 1254 $false $false $true
} finally { $source.Dispose() }
