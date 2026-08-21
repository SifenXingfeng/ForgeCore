# ForgeMind 可选智能服务

FastAPI 服务负责受限规则助手、可选远程 DeepSeek、工厂需求约束提取、工具协议、ASR/TTS 网关和视觉检测辅助。它不进入实时仿真 tick，也不是默认启动依赖。

## 默认原则

- 默认 `FORGEMIND_LLM_PROVIDER=rule`，不安装、不启动、不探测本地大语言模型。
- 前端未启用本服务时，生成式工厂继续使用确定性规则解析，助手使用浏览器内规则降级。
- 模型不能直接生成布局坐标、碰撞结论、路线或仿真指标。
- 工具动作必须经过服务端基础校验和前端二次校验；高风险动作仍需确认。

## 启动

项目根目录推荐：

```powershell
.\start-forgemind.bat -IncludeAI
```

也可以手动启动：

```powershell
cd ai-service
py -3 -m venv .venv
.venv\Scripts\python -m pip install -r requirements-core.txt
.venv\Scripts\python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

前端只有在启动时设置 `VITE_AI_ENABLED=true` 才会访问该服务；一键启动器使用 `-IncludeAI` 时会自动设置。

`requirements-core.txt` 只安装规则/远程助手所需的轻量 Web 依赖；需要视觉、ASR 或本地 TTS 时，再安装完整的 `requirements.txt`。两者都不包含本地大语言模型。

## 可选 DeepSeek

```powershell
$env:FORGEMIND_LLM_PROVIDER = 'deepseek'
$env:DEEPSEEK_API_KEY = '<本机密钥>'
$env:DEEPSEEK_MODEL = 'deepseek-chat'
.\start-forgemind.bat -IncludeAI
```

密钥只由服务端读取。未配置密钥、远程请求失败或响应不符合约束时，服务返回规则/降级结果，不会再回退到本地 Qwen。

## 可选语音

ASR/TTS 默认不预热。需要语音时显式设置 `FORGEMIND_VOICE_ENABLED=true`，并准备 `voice-chat/models/` 下的 Paraformer/VITS 文件或外部 TTS 服务。语音模型缺失不影响规则助手、视觉检测和核心前端。

## 主要接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/ai/health` | 服务、协议、provider 和语音状态 |
| GET | `/api/ai/tools` | `1.0.0` 工具目录 |
| POST | `/api/ai/assistant` | 规则/远程助手和受限动作信封 |
| POST | `/api/ai/assistant/stream` | NDJSON 兼容响应 |
| POST | `/api/ai/factory-spec` | 只提取受限生成约束 |
| POST | `/api/ai/asr` | 可选 WAV 中文识别 |
| POST | `/api/ai/tts` | 可选语音合成 |
| POST | `/api/vision/detect` | 视觉检测辅助 |

## 验证

```powershell
py -3 -m py_compile main.py vision.py
```

启动后检查 `http://127.0.0.1:8000/api/ai/health`，应显示 `localModelRequired: false`。规则模式下可用 `/api/ai/assistant` 测试“查询工厂状态”“启动仿真”“暂停仿真”“设置 2 倍速”和“重置仿真”。
