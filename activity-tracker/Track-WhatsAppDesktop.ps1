$ErrorActionPreference = "Stop"

$apiUrl = "https://work-justification.vercel.app/api/sheet"
$dashboardOrigin = "https://work-justification.vercel.app"
$stateDirectory = Join-Path $env:LOCALAPPDATA "WorkJustification"
$statePath = Join-Path $stateDirectory "whatsapp-desktop-timer-state.json"
$idleLimitSeconds = 300
$targetPackageFamilies = @(
  "5319275A.51895FA4EA97F_cv1g1gvanyjgm",
  "5319275A.WhatsAppDesktop_cv1g1gvanyjgm"
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class WorkJustificationWindowTracker {
  [StructLayout(LayoutKind.Sequential)]
  private struct LASTINPUTINFO {
    public uint cbSize;
    public uint dwTime;
  }

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern int GetPackageFamilyName(IntPtr process, ref uint length, StringBuilder familyName);
  [DllImport("kernel32.dll")]
  private static extern bool CloseHandle(IntPtr handle);

  public static uint ForegroundProcessId() {
    uint processId;
    GetWindowThreadProcessId(GetForegroundWindow(), out processId);
    return processId;
  }

  public static uint IdleSeconds() {
    LASTINPUTINFO info = new LASTINPUTINFO();
    info.cbSize = (uint)Marshal.SizeOf(typeof(LASTINPUTINFO));
    if (!GetLastInputInfo(ref info)) return UInt32.MaxValue;
    return unchecked((uint)Environment.TickCount - info.dwTime) / 1000;
  }

  public static string PackageFamily(uint processId) {
    IntPtr process = OpenProcess(0x1000, false, processId);
    if (process == IntPtr.Zero) return "";
    try {
      uint length = 0;
      int result = GetPackageFamilyName(process, ref length, null);
      if (result != 122 || length == 0) return "";
      StringBuilder family = new StringBuilder((int)length);
      result = GetPackageFamilyName(process, ref length, family);
      return result == 0 ? family.ToString() : "";
    } finally {
      CloseHandle(process);
    }
  }
}
"@

function Get-ApiActivityRows {
  $response = Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType "application/json" `
    -Headers @{ Origin = $dashboardOrigin } -Body '{"method":"getActivityTotals","args":[]}' -TimeoutSec 20
  if (-not $response.ok) { throw "The activity API did not return success." }
  return @($response.data)
}

function Save-LocalTotal {
  if (-not (Test-Path -LiteralPath $stateDirectory)) {
    New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
  }
  $state = @{ date = $script:currentDate; activeSeconds = [int]$script:activeSeconds }
  $temporaryPath = "$statePath.tmp"
  ConvertTo-Json -InputObject $state -Compress | Set-Content -LiteralPath $temporaryPath -Encoding utf8
  Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
}

function Sync-Total {
  $entry = ConvertTo-Json -InputObject @{ date = $script:currentDate; application = "WhatsApp Desktop"; activeSeconds = [int]$script:activeSeconds } -Compress
  $body = '{"method":"saveActivityTotals","args":[[' + $entry + ']]}'
  $response = Invoke-RestMethod -Uri $apiUrl -Method Post -ContentType "application/json" `
    -Headers @{ Origin = $dashboardOrigin } -Body $body -TimeoutSec 20
  if (-not $response.ok) { throw "The activity API did not save the WhatsApp Desktop total." }
}

function Test-WhatsAppForeground {
  $processId = [WorkJustificationWindowTracker]::ForegroundProcessId()
  if ($processId -eq 0) { return $false }

  try {
    $process = Get-Process -Id $processId -ErrorAction Stop
    if ($process.ProcessName -match '^(WhatsApp|WhatsAppBeta|WhatsApp\.Root)$') { return $true }
  } catch { return $false }

  $family = [WorkJustificationWindowTracker]::PackageFamily($processId)
  return $targetPackageFamilies -contains $family
}

$script:currentDate = (Get-Date).ToString("yyyy-MM-dd")
$script:activeSeconds = 0
$lastLocalSave = [DateTimeOffset]::MinValue
$lastSync = [DateTimeOffset]::MinValue
$lastServerRead = [DateTimeOffset]::MinValue

if (Test-Path -LiteralPath $statePath) {
  try {
    $savedState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($savedState.date -eq $script:currentDate) {
      $script:activeSeconds = [Math]::Max(0, [int]$savedState.activeSeconds)
    }
  } catch { }
}

Write-Host "WhatsApp Desktop foreground timer is running. Press Ctrl+C to stop."
Write-Host "Only app identity and active seconds are recorded; no window title or chat content is read."

try {
  while ($true) {
    $now = [DateTimeOffset]::UtcNow
    $today = (Get-Date).ToString("yyyy-MM-dd")
    if ($today -ne $script:currentDate) {
      $script:currentDate = $today
      $script:activeSeconds = 0
      $lastServerRead = [DateTimeOffset]::MinValue
      $lastSync = [DateTimeOffset]::MinValue
    }

    if (($now - $lastServerRead).TotalSeconds -ge 60) {
      try {
        $rows = Get-ApiActivityRows
        $existing = $rows | Where-Object { $_.date -eq $script:currentDate -and $_.application -eq "WhatsApp Desktop" } | Select-Object -First 1
        if ($existing) {
          $script:activeSeconds = [Math]::Max($script:activeSeconds, [int]$existing.activeSeconds)
        }
        $lastServerRead = $now
      } catch {
        Write-Warning "Waiting for the Activity Log connection before syncing."
      }
    }

    if ([WorkJustificationWindowTracker]::IdleSeconds() -lt $idleLimitSeconds -and (Test-WhatsAppForeground)) {
      $script:activeSeconds++
    }

    if (($now - $lastLocalSave).TotalSeconds -ge 15) {
      Save-LocalTotal
      $lastLocalSave = $now
    }

    if (($now - $lastSync).TotalSeconds -ge 60 -and ($now - $lastServerRead).TotalSeconds -lt 60) {
      try {
        Sync-Total
        $lastSync = $now
        Write-Host ("{0}  WhatsApp Desktop: {1:N2} active minutes" -f $script:currentDate, ($script:activeSeconds / 60))
      } catch {
        Write-Warning "Sync failed; the total is saved locally and will retry."
      }
    }

    Start-Sleep -Seconds 1
  }
} finally {
  Save-LocalTotal
  try { Sync-Total } catch { Write-Warning "Final sync will retry the next time the timer runs." }
}

