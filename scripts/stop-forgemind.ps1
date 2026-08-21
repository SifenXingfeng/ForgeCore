[CmdletBinding()]
param(
    [switch]$StopMySql
)

$ErrorActionPreference = 'SilentlyContinue'
$rootPath = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $rootPath '.forgemind'

function Stop-PidFile([string]$Name) {
    $pidPath = Join-Path $runtimePath "$Name.pid"
    if (-not (Test-Path -LiteralPath $pidPath)) { return }
    $processId = [int](Get-Content -LiteralPath $pidPath -Raw)
    $allProcesses = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    $knownIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$knownIds.Add($processId)
    do {
        $added = $false
        foreach ($candidate in $allProcesses) {
            if ($knownIds.Contains([int]$candidate.ParentProcessId) -and -not $knownIds.Contains([int]$candidate.ProcessId)) {
                [void]$knownIds.Add([int]$candidate.ProcessId)
                $added = $true
            }
        }
    } while ($added)

    $targets = @($knownIds) | Sort-Object -Descending
    if ($targets.Count -gt 0) {
        Write-Host "停止 $Name（PID $processId 及其子进程）..."
        foreach ($targetId in $targets) {
            Stop-Process -Id $targetId -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
}

Write-Host '停止由 ForgeMind 启动器创建的服务...'
Stop-PidFile 'voice'
Stop-PidFile 'frontend'
Stop-PidFile 'ai'
Stop-PidFile 'spring'

if ($StopMySql) {
    $nativePidPath = Join-Path $runtimePath 'mysqlnative.pid'
    if (Test-Path -LiteralPath $nativePidPath) {
        Stop-PidFile 'mysqlnative'
        Write-Host '项目专用 MySQL 已停止，数据目录保留。' -ForegroundColor DarkGray
    } else {
        $dockerPath = (Get-Command docker.exe -ErrorAction SilentlyContinue).Source
        $composeFile = Join-Path $rootPath 'docker-compose.yml'
        if ($dockerPath -and (Test-Path -LiteralPath $composeFile)) {
        & $dockerPath compose -f $composeFile stop mysql | Out-Host
        Write-Host 'MySQL 容器已停止，数据卷保留。' -ForegroundColor DarkGray
        } else {
            Write-Warning '没有找到由 ForgeMind 启动器管理的 MySQL。'
        }
    }
}

Write-Host '已完成。运行日志保留在 .forgemind\logs。' -ForegroundColor Green
