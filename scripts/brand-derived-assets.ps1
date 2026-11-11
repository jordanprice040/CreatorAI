# Regenerates the app's brand files derived from assets/creator-agent.
# Windows PowerShell 5+ (System.Drawing). Run from anywhere:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/brand-derived-assets.ps1
# Writes:
#   assets/creator-agent/windows.ico     256 px frame stored as PNG (other frames unchanged)
#   apps/desktop/src-tauri/icons/icon.ico          copy of windows.ico
#   apps/desktop/src-tauri/icons/nsis-header.bmp   150x57, mark at the left (Tauri's template has no MUI_HEADERIMAGE_RIGHT)
#   apps/desktop/src-tauri/icons/nsis-sidebar.bmp  164x314, sage mark on ink
#   apps/web/public/creator-agent-icon.png, apps/desktop/control/mark.png   64 px frame of windows.ico
#   apps/web/public/favicon.ico, apps/web/public/apple-touch-icon.png       copies of the pack's browser icons
#   assets/creator-agent/SHA256SUMS.txt            refreshed for the pack and every file above
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$pack = Join-Path $root 'assets/creator-agent'
$icons = Join-Path $root 'apps/desktop/src-tauri/icons'

function Read-Ico([string]$path) {
  $b = [IO.File]::ReadAllBytes($path)
  $n = [BitConverter]::ToUInt16($b, 4)
  $frames = @()
  for ($i = 0; $i -lt $n; $i++) {
    $e = 6 + 16 * $i
    $size = [BitConverter]::ToUInt32($b, $e + 8)
    $off = [BitConverter]::ToUInt32($b, $e + 12)
    $data = New-Object byte[] $size
    [Array]::Copy($b, $off, $data, 0, $size)
    $frames += , @{ entry = $b[$e..($e + 7)]; data = $data }
  }
  return $frames
}

function Write-Ico([string]$path, $frames) {
  $ms = New-Object IO.MemoryStream
  $w = New-Object IO.BinaryWriter $ms
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$frames.Count)
  $off = 6 + 16 * $frames.Count
  foreach ($f in $frames) {
    $w.Write([byte[]]$f.entry); $w.Write([uint32]$f.data.Length); $w.Write([uint32]$off)
    $off += $f.data.Length
  }
  foreach ($f in $frames) { $w.Write([byte[]]$f.data) }
  $w.Flush(); [IO.File]::WriteAllBytes($path, $ms.ToArray())
}

function IsPng([byte[]]$d) { $d.Length -gt 8 -and $d[0] -eq 0x89 -and $d[1] -eq 0x50 }

# Decode a 32-bit BMP icon frame (BITMAPINFOHEADER, bottom-up BGRA) into a Bitmap.
function Frame-Bitmap([byte[]]$d) {
  if (IsPng $d) { return [System.Drawing.Bitmap]::FromStream((New-Object IO.MemoryStream (, $d))) }
  $hs = [BitConverter]::ToInt32($d, 0); $w = [BitConverter]::ToInt32($d, 4)
  $h = [BitConverter]::ToInt32($d, 8) / 2; $bpp = [BitConverter]::ToUInt16($d, 14)
  if ($bpp -ne 32) { throw "Only 32-bit icon frames are supported (got $bpp)" }
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $lock = $bmp.LockBits((New-Object System.Drawing.Rectangle 0, 0, $w, $h), 'WriteOnly', $bmp.PixelFormat)
  for ($y = 0; $y -lt $h; $y++) {
    $src = $hs + ($h - 1 - $y) * $w * 4
    [Runtime.InteropServices.Marshal]::Copy($d, $src, [IntPtr]($lock.Scan0.ToInt64() + $y * $lock.Stride), $w * 4)
  }
  $bmp.UnlockBits($lock)
  return $bmp
}

# 1. Store the 256 px frame as PNG (Windows Vista+ reads PNG frames); pixels are unchanged.
$icoPath = Join-Path $pack 'windows.ico'
$frames = Read-Ico $icoPath
foreach ($f in $frames) {
  if ($f.entry[0] -eq 0 -and -not (IsPng $f.data)) {
    $bmp = Frame-Bitmap $f.data
    $ms = New-Object IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
    $f.data = $ms.ToArray()
  }
}
Write-Ico $icoPath $frames
Copy-Item $icoPath (Join-Path $icons 'icon.ico') -Force

# 2. 64 px frame for the web header and the desktop status window.
$f64 = $frames | Where-Object { $_.entry[0] -eq 64 } | Select-Object -First 1
$bmp = Frame-Bitmap $f64.data
$tmp = Join-Path $root 'apps/web/public/creator-agent-icon.png'
$bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
Copy-Item $tmp (Join-Path $root 'apps/desktop/control/mark.png') -Force

# 3. NSIS bitmaps (24-bit, the sizes Tauri documents).
function New-Art($w, $h, $bg, $markFile, $markH, $x, $y, $out) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'; $g.SmoothingMode = 'HighQuality'; $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml($bg))
  $m = [System.Drawing.Image]::FromFile($markFile)
  $mw = [int][Math]::Round($markH * $m.Width / $m.Height)
  $g.DrawImage($m, (New-Object System.Drawing.Rectangle $x, $y, $mw, $markH))
  $m.Dispose(); $g.Dispose()
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Bmp); $bmp.Dispose()
}
New-Art 150 57 '#FFFFFF' (Join-Path $pack 'mark-ink.png') 33 12 12 (Join-Path $icons 'nsis-header.bmp')
New-Art 164 314 '#141312' (Join-Path $pack 'mark-sage.png') 64 48 72 (Join-Path $icons 'nsis-sidebar.bmp')

# 4. Browser icons are straight copies.
Copy-Item (Join-Path $pack 'favicon.ico') (Join-Path $root 'apps/web/public/favicon.ico') -Force
Copy-Item (Join-Path $pack 'touch-icon-180.png') (Join-Path $root 'apps/web/public/apple-touch-icon.png') -Force

# 5. Refresh SHA256SUMS.txt (pack files, then app copies relative to the pack; LF endings).
$derived = @(
  'apps/desktop/control/mark.png',
  'apps/desktop/src-tauri/icons/icon.ico',
  'apps/desktop/src-tauri/icons/nsis-header.bmp',
  'apps/desktop/src-tauri/icons/nsis-sidebar.bmp',
  'apps/web/public/apple-touch-icon.png',
  'apps/web/public/creator-agent-icon.png',
  'apps/web/public/favicon.ico'
)
[string[]]$names = Get-ChildItem $pack -File | Where-Object { $_.Name -ne 'SHA256SUMS.txt' } |
  ForEach-Object { $_.Name }
[Array]::Sort($names, [StringComparer]::Ordinal)
$lines = @()
foreach ($n in $names) { $lines += (Get-FileHash (Join-Path $pack $n) -Algorithm SHA256).Hash.ToLower() + '  ' + $n }
foreach ($d in $derived) { $lines += (Get-FileHash (Join-Path $root $d) -Algorithm SHA256).Hash.ToLower() + '  ../../' + $d }
[IO.File]::WriteAllText((Join-Path $pack 'SHA256SUMS.txt'), (($lines -join "`n") + "`n"))
