[CmdletBinding()]
param(
    [switch]$IncludeAI,
    [switch]$IncludeSpring,
    [switch]$IncludeVoiceChat,
    [switch]$NoBrowser,
    [switch]$SkipInstall,
    [switch]$SkipMySql,
    [switch]$ForceRebuild,
    [ValidateRange(1024, 65535)]
    [int]$Port = 5173
)

$ErrorActionPreference = 'Stop'
$rootPath = Split-Path -Parent $PSScriptRoot
$runtimePath = Join-Path $rootPath '.forgemind'
$logPath = Join-Path $runtimePath 'logs'
$composeFile = Join-Path $rootPath 'docker-compose.yml'
New-Item -ItemType Directory -Force -Path $logPath | Out-Null

function Test-LocalPort([int]$TargetPort) {
    $client = [System.Net.Sockets.TcpClient]::new()
    try {
        $async = $client.BeginConnect('127.0.0.1', $TargetPort, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-LocalPort([int]$TargetPort, [int]$Seconds = 30) {
    for ($index = 0; $index -lt $Seconds; $index++) {
        if (Test-LocalPort $TargetPort) { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Test-ForgeMindFrontend([int]$TargetPort) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$TargetPort" -TimeoutSec 2
        return $response.StatusCode -eq 200 -and $response.Content -match 'ForgeMind'
    } catch {
        return $false
    }
}

function Start-HiddenService {
    param(
        [Parameter(Mandatory)] [string]$Name,
        [Parameter(Mandatory)] [string]$WorkingDirectory,
        [Parameter(Mandatory)] [string]$Executable,
        [Parameter(Mandatory)] [string[]]$Arguments
    )

    $stdout = Join-Path $logPath "$Name.out.log"
    $stderr = Join-Path $logPath "$Name.err.log"
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr
    Set-Content -LiteralPath (Join-Path $runtimePath "$Name.pid") -Value $process.Id -Encoding ascii
    return $process
}

function Resolve-Python {
    $venvPython = Join-Path $rootPath 'ai-service\.venv\Scripts\python.exe'
    if (Test-Path -LiteralPath $venvPython) { return $venvPython }

    $launcher = (Get-Command py.exe -ErrorAction SilentlyContinue).Source
    $python = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
    if (-not $launcher -and -not $python) { return $null }

    Write-Host '创建可选 AI 服务虚拟环境...' -ForegroundColor Yellow
    if ($launcher) { & $launcher -3 -m venv (Join-Path $rootPath 'ai-service\.venv') | Out-Host }
    else { & $python -m venv (Join-Path $rootPath 'ai-service\.venv') | Out-Host }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython)) { return $null }
    & $venvPython -m pip install -r (Join-Path $rootPath 'ai-service\requirements-core.txt') | Out-Host
    if ($LASTEXITCODE -ne 0) { return $null }
    return $venvPython
}

function Get-MySqlHealth([string]$DockerPath) {
    $status = & $DockerPath inspect --format '{{.State.Health.Status}}' forgemind-mysql 2>$null
    if ($LASTEXITCODE -ne 0) { return $null }
    return ($status | Out-String).Trim()
}

function Resolve-NativeMySql {
    $serverCandidates = @()
    $programFilesRoot = [Environment]::GetFolderPath('ProgramFiles')
    $mysqlProgramRoot = Join-Path $programFilesRoot 'MySQL'
    if (Test-Path -LiteralPath $mysqlProgramRoot) {
        $serverCandidates += Get-ChildItem -LiteralPath $mysqlProgramRoot -Directory -Filter 'MySQL Server *' -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { Join-Path $_.FullName 'bin\mysqld.exe' }
    }
    $pathServer = (Get-Command mysqld.exe -ErrorAction SilentlyContinue).Source
    if ($pathServer) { $serverCandidates += $pathServer }

    foreach ($serverPath in $serverCandidates | Select-Object -Unique) {
        if (-not (Test-Path -LiteralPath $serverPath)) { continue }
        $versionText = (& $serverPath --version 2>&1 | Out-String)
        if ($versionText -notmatch 'Ver\s+(8\.|9\.)') { continue }
        $clientPath = Join-Path (Split-Path -Parent $serverPath) 'mysql.exe'
        if (-not (Test-Path -LiteralPath $clientPath)) { continue }
        return [pscustomobject]@{
            Server = $serverPath
            Client = $clientPath
            Base = Split-Path -Parent (Split-Path -Parent $serverPath)
            Version = $versionText.Trim()
        }
    }
    return $null
}

function Start-NativeMySql {
    $mysql = Resolve-NativeMySql
    if (-not $mysql) { throw '找不到 MySQL 8.x/9.x。请安装 MySQL Server 8.4，或安装 Docker。' }

    $dataPath = Join-Path $runtimePath 'mysql-data'
    $configPath = Join-Path $runtimePath 'mysql.ini'
    New-Item -ItemType Directory -Force -Path $dataPath | Out-Null
    $baseConfig = $mysql.Base.Replace('\', '/')
    $dataConfig = $dataPath.Replace('\', '/')
    $config = @"
[mysqld]
basedir=$baseConfig
datadir=$dataConfig
port=3306
bind-address=127.0.0.1
mysqlx=0
character-set-server=utf8mb4
collation-server=utf8mb4_0900_ai_ci
"@
    [System.IO.File]::WriteAllText($configPath, $config, [System.Text.UTF8Encoding]::new($false))

    if (-not (Test-Path -LiteralPath (Join-Path $dataPath 'mysql'))) {
        Write-Host '初始化项目专用 MySQL 8.4 数据目录...' -ForegroundColor Yellow
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $mysql.Server "--defaults-file=$configPath" --initialize-insecure --console 2>&1 | Out-Host
        $initializeExitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        if ($initializeExitCode -ne 0) { throw "MySQL 初始化失败，请检查 $logPath\mysqlnative.err.log" }
    }

    Write-Host "启动项目专用 MySQL：$($mysql.Version)" -ForegroundColor Yellow
    Start-HiddenService -Name 'mysqlnative' -WorkingDirectory $rootPath -Executable $mysql.Server -Arguments @("--defaults-file=`"$configPath`"", '--console') | Out-Null
    if (-not (Wait-LocalPort 3306 30)) { throw "MySQL 未就绪，请查看 $logPath\mysqlnative.err.log" }

    $bootstrapSql = "CREATE DATABASE IF NOT EXISTS forgemind CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci; CREATE USER IF NOT EXISTS 'forgemind'@'%' IDENTIFIED BY 'forgemind'; ALTER USER 'forgemind'@'%' IDENTIFIED BY 'forgemind'; GRANT ALL PRIVILEGES ON forgemind.* TO 'forgemind'@'%'; FLUSH PRIVILEGES;"
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $mysql.Client --no-defaults --protocol=TCP --host=127.0.0.1 --port=3306 --user=root "--execute=$bootstrapSql" 2>&1 | Out-Host
    $bootstrapExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($bootstrapExitCode -ne 0) { throw 'MySQL 数据库或应用账号初始化失败。' }
}

function Resolve-Java17 {
    $candidates = @()
    if ($env:JAVA_HOME) { $candidates += Join-Path $env:JAVA_HOME 'bin\java.exe' }
    $pathJava = (Get-Command java.exe -ErrorAction SilentlyContinue).Source
    if ($pathJava) { $candidates += $pathJava }
    foreach ($candidate in $candidates | Select-Object -Unique) {
        if (-not (Test-Path -LiteralPath $candidate)) { continue }
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        $versionText = (& $candidate -version 2>&1 | Out-String)
        $ErrorActionPreference = $previousPreference
        if ($versionText -match 'version\s+"(?:1\.)?(\d+)' -and [int]$Matches[1] -ge 17) { return $candidate }
    }
    return $null
}

Write-Host 'ForgeMind 一键启动' -ForegroundColor Cyan
Write-Host "项目目录: $rootPath"
if ($IncludeSpring) {
    Write-Host '当前模式: 前端 + Spring Boot + MySQL（不需要本地大语言模型）' -ForegroundColor DarkGray
} else {
    Write-Host '当前模式: 仅前端 + 确定性仿真（注册/登录不可用）' -ForegroundColor DarkGray
}

$npmPath = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $npmPath -or -not $nodePath) { throw '找不到 Node.js/npm，请先安装 Node.js 18 或更高版本。' }

$vitePath = Join-Path $rootPath 'node_modules\.bin\vite.cmd'
if (-not (Test-Path -LiteralPath $vitePath)) {
    if ($SkipInstall) { throw '缺少前端依赖，且使用了 -SkipInstall。请先执行 npm install。' }
    Write-Host '[1/4] 首次运行，安装前端依赖...' -ForegroundColor Yellow
    & $npmPath install --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm install 失败，请检查网络和 Node.js 环境。' }
} else {
    Write-Host '[1/4] 前端依赖已就绪。' -ForegroundColor DarkGray
}

if ($IncludeAI) {
    if (-not $env:FORGEMIND_LLM_PROVIDER) { $env:FORGEMIND_LLM_PROVIDER = 'rule' }
    if (-not $env:FORGEMIND_VOICE_ENABLED) { $env:FORGEMIND_VOICE_ENABLED = if ($IncludeVoiceChat) { 'true' } else { 'false' } }
    $env:VITE_AI_ENABLED = 'true'
    if (-not (Test-LocalPort 8000)) {
        $aiPython = Resolve-Python
        if (-not $aiPython) { throw '无法创建或定位 ai-service Python 环境。默认启动不需要该环境，可移除 -IncludeAI。' }
        Write-Host "[2/4] 启动可选智能服务（$($env:FORGEMIND_LLM_PROVIDER) 模式）..." -ForegroundColor Yellow
        Start-HiddenService -Name 'ai' -WorkingDirectory (Join-Path $rootPath 'ai-service') -Executable $aiPython -Arguments @('-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000') | Out-Null
        if (-not (Wait-LocalPort 8000 30)) { throw "AI 服务未就绪，请查看 $logPath\ai.err.log" }
    } else {
        Write-Host '[2/4] 复用 8000 端口的智能服务。' -ForegroundColor DarkGray
    }
} else {
    $env:VITE_AI_ENABLED = 'false'
    Write-Host '[2/4] 跳过可选智能/语音服务。' -ForegroundColor DarkGray
}

if ($IncludeSpring) {
    if (-not $SkipMySql) {
        if (Test-LocalPort 3306) {
            Write-Host '[3/4] 复用 3306 端口的 MySQL。' -ForegroundColor DarkGray
        } else {
            $dockerPath = (Get-Command docker.exe -ErrorAction SilentlyContinue).Source
            if ($dockerPath) {
                & $dockerPath compose -f $composeFile up -d mysql
                if ($LASTEXITCODE -ne 0) { throw 'MySQL 容器启动失败。' }
                for ($index = 0; $index -lt 60 -and (Get-MySqlHealth $dockerPath) -ne 'healthy'; $index++) { Start-Sleep -Seconds 1 }
                if ((Get-MySqlHealth $dockerPath) -ne 'healthy') { throw 'MySQL 在 60 秒内没有进入 healthy 状态。' }
            } else {
                Start-NativeMySql
            }
        }
    }

    if (-not (Test-LocalPort 8080)) {
        $backendPath = Join-Path $rootPath 'backend'
        $jarPath = Join-Path $backendPath 'target\forgemind-backend-0.1.0.jar'
        $javaPath = Resolve-Java17
        $mvnPath = (Get-Command mvn.cmd -ErrorAction SilentlyContinue).Source
        if ($javaPath -and (Test-Path -LiteralPath $jarPath) -and -not $ForceRebuild) {
            Start-HiddenService -Name 'spring' -WorkingDirectory $backendPath -Executable $javaPath -Arguments @('-jar', $jarPath) | Out-Null
        } elseif ($mvnPath) {
            $mavenSettings = Join-Path $backendPath '.mvn\forgemind-global-settings.xml'
            $mavenArguments = if (Test-Path -LiteralPath $mavenSettings) { @('-gs', $mavenSettings, 'spring-boot:run') } else { @('spring-boot:run') }
            Start-HiddenService -Name 'spring' -WorkingDirectory $backendPath -Executable $mvnPath -Arguments $mavenArguments | Out-Null
        } else {
            throw '找不到可运行的后端 JAR 或 Maven。默认前端模式不需要 Spring，可移除 -IncludeSpring。'
        }
        if (-not (Wait-LocalPort 8080 45)) { throw "Spring Boot 未就绪，请查看 $logPath\spring.err.log" }
    }
    Write-Host '[3/4] Spring Boot 已就绪。' -ForegroundColor Green
} else {
    Write-Host '[3/4] 跳过可选 Spring Boot/MySQL。' -ForegroundColor DarkGray
}

$frontendUrl = "http://127.0.0.1:$Port"
if (Test-LocalPort $Port) {
    if (-not (Test-ForgeMindFrontend $Port)) { throw "端口 $Port 已被其他程序占用，请使用 -Port 指定其他端口。" }
    Write-Host '[4/4] ForgeMind 前端已运行，直接复用。' -ForegroundColor DarkGray
} else {
    Write-Host "[4/4] 启动 ForgeMind 前端（端口 $Port）..." -ForegroundColor Yellow
    $viteEntry = Join-Path $rootPath 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $viteEntry)) { throw "缺少 Vite 启动文件：$viteEntry" }
    Start-HiddenService -Name 'frontend' -WorkingDirectory $rootPath -Executable $nodePath -Arguments @($viteEntry, '--host', '127.0.0.1', '--port', "$Port", '--strictPort') | Out-Null
    if (-not (Wait-LocalPort $Port 30)) { throw "前端未就绪，请查看 $logPath\frontend.err.log" }
}

if ($IncludeVoiceChat) {
    $voicePython = Join-Path $rootPath 'voice-chat\venv\Scripts\python.exe'
    $voiceScript = Join-Path $rootPath 'voice-chat\voice_chat.py'
    if (Test-Path -LiteralPath $voicePython) {
        Start-HiddenService -Name 'voice' -WorkingDirectory (Join-Path $rootPath 'voice-chat') -Executable $voicePython -Arguments @($voiceScript) | Out-Null
    } else {
        Write-Warning '未找到 voice-chat\venv，已保留网页和规则助手，跳过独立语音控制台。'
    }
}

Write-Host ''
Write-Host "ForgeMind 已启动：$frontendUrl" -ForegroundColor Green
if ($IncludeAI) { Write-Host '可选智能服务：http://127.0.0.1:8000/api/ai/health' }
if ($IncludeSpring) { Write-Host '认证后端：http://127.0.0.1:8080/api/factory/health' }
Write-Host "运行日志：$logPath" -ForegroundColor DarkGray
Write-Host '停止服务：双击 stop-forgemind.bat' -ForegroundColor DarkGray
if (-not $NoBrowser) { Start-Process -FilePath $frontendUrl | Out-Null }
