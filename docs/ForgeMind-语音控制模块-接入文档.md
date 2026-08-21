# ForgeMind 语音/AI 控制模块 — 接入文档

> **2026-08-19 融合更新：** 本文的 Ollama/Qwen、`D:\Code\factory` 和 `D:\local` 内容作为历史接入记录保留，不再是当前部署要求。当前独立语音控制台调用 `ai-service` 的规则/远程助手接口；默认一键启动不会启动语音、Python 或本地大语言模型。当前启动和 provider 配置以根目录 `README.md`、`ForgeMind 项目方案.md` 与 `ai-service/README.md` 为准。

> **实现更新（协议 1.0.0）：** 当前权威动作目录已迁移到 `contracts/forgemind-assistant-tools.json`，安全校验与执行说明见《ForgeMind-智能管家工具协议》。`ai-service` 当前默认使用规则 Provider，可选远程 DeepSeek；下文 Ollama 链路与 §4 的 `line_id:int`、单线调速和单机暂停均为早期设计，不应直接用于执行。

> 当前实现接入文档。模块已具备：本地 LLM、语音识别（ASR）、BT-7274 语音合成（TTS）、中文→结构化控制意图的工具调用，以及网页端手动录音/`BT` 关键字唤醒。动作由 `contracts/forgemind-assistant-tools.json` 定义，前端执行层负责二次校验、确认和写回。

## 0. 一句话架构

```
前端/调用方
  └─(HTTP)→ ai-service(端口8000)                           ← 编排中枢
              ├─→ Ollama qwen2.5:7b (11434)  本地LLM，输出文本或结构化动作
              ├─→ BT-7274 TTS (8001)         Bert-VITS2，中文语音合成
              └─→ sherpa ASR (可复用 voice_chat.py 的 transcribe)
```

原则（§8.1 红线）：**LLM 只输出「动作 + 参数」，不直接改工厂**；执行前必须做合法性校验，产出数字以副本仿真回算为准。

---

## 1. 服务清单

| 服务 | 端口 | 启动 | 模型/依赖位置 | venv |
|---|---|---|---|---|
| Ollama (LLM) | 11434 | `start_voice_demo.bat` 或手动 | `OLLAMA_MODELS=D:\local\ollama\models` | 独立（Ollama 自带） |
| BT-7274 TTS | 8001 | `cd D:\local\bt7274-space && venv\Scripts\python bt_tts_server.py` | `D:\local\bt7274-space` | `D:\local\bt7274-space\venv` |
| ai-service (编排) | 8000 | 见 §5，已实现 | `D:\Code\factory\ai-service` | 需自行建 venv（Python 3.10） |
| 语音助手(参考) | — | `cd D:\Code\factory\voice-chat && venv\Scripts\python voice_chat.py` | `D:\Code\factory\voice-chat` | `D:\Code\factory\voice-chat\venv` |

**一键启动**：`D:\Code\factory\voice-chat\start_voice_demo.bat`（自动起 Ollama + BT TTS + 语音助手）。

---

## 2. Ollama 接口（LLM，端口 11434）

基础信息：
- 模型：`qwen2.5:7b`（Q4_K_M，约 4.4GB，显存约 4.8GB，33 token/s）
- 同时兼容 OpenAI 格式：`POST /v1/chat/completions`（**支持 tools/function calling**）

### 2.1 流式聊天 `POST /api/chat`

请求：
```json
{
  "model": "qwen2.5:7b",
  "messages": [
    {"role": "system", "content": "你是机甲AI BT-7274…（见 §6 系统提示）"},
    {"role": "user", "content": "把仿真速度调到 2 倍"}
  ],
  "stream": true,
  "options": {"num_predict": 100}
}
```

响应（`stream:true` 时是 NDJSON，每行一个 JSON）：
```json
{"model":"qwen2.5:7b","message":{"role":"assistant","content":"收到，"},"done":false}
{"model":"qwen2.5:7b","message":{"role":"assistant","content":"已调到80%。"},"done":true}
```

### 2.2 工具调用（结构化动作）— 控制意图的关键

标准 OpenAI tools 格式，定义动作库 schema（§4）。模型会返回 `message.tool_calls`：
```json
{"message": {"role": "assistant", "tool_calls": [
  {"function": {"name": "set_simulation_speed", "arguments": "{\"speed\":2}"}}
]}}
```

> ⚠️ 实测教训：复合指令下模型可能把 `action` 输出成嵌套 `{"type":...}`。**接收端必须做规范化 + 枚举校验**，不要盲信 schema 输出。

---

## 3. BT-7274 语音服务（TTS，端口 8001）

FastAPI，CPU 推理，模型常驻内存。

### 3.1 健康检查 `GET /health`
```json
{"status": "ok", "tts": "bt7274", "device": "cpu"}
```

### 3.2 合成 `POST /tts`

请求：
```json
{"text": "我是毕提七二七四，随时待命。", "length_scale": 1.0}
```
响应：`audio/wav`（44.1kHz 单声道 float32）。

内置处理：
- **英文→中文读音归一化**：`BT→毕提`、`AI→人工智能`、`AGV→自动导引车`、`OK→收到`、其余字母逐个转中文读音；数字由 cn2an 读成中文。**调用方可直接传含英文的原文。**
- `length_scale`：语速（<1 更快，默认 1.0）。

实测性能：CPU 合成约 **1.0s/句**。首次调用含 ~20s 模型加载（服务启动时完成，之后常驻）。

---

## 4. 控制层契约（当前实现）

LLM 通过工具调用产出「控制意图」。定义如下动作库：

### 4.1 当前动作库

权威目录是 `contracts/forgemind-assistant-tools.json`，协议版本为 `1.0.0`。当前实现支持：

| name | 风险/确认 | 说明 |
|---|---|---|
| `query_factory_status` | 只读 / 否 | 查询仿真时间、运行状态、在途物料和产出 |
| `inspect_object` | 只读 / 否 | 读取指定对象配置和运行态 |
| `select_object` | 可逆 / 否 | 在界面中定位对象 |
| `set_simulation_running` | 可逆 / 否 | 启动或暂停全局仿真 |
| `set_simulation_speed` | 可逆 / 否 | 设置 0.1–4 倍仿真倍率 |
| `reset_simulation` | 运行态破坏 / 是 | 清空运行进度并重建仿真 |
| `change_machine_recipe` | 配置变更 / 是 | 修改机器配方绑定 |
| `bind_source_item` | 配置变更 / 是 | 修改来料站产出物品绑定 |

工具 schema（传给 Ollama 的 `tools` 字段）建议**扁平化**（扁平结构模型输出更准，见 §2.2 教训）。

### 4.2 工厂状态上下文

每次调用需把仿真当前状态序列化成 JSON 放进 `messages`（作为 user/system 上下文），LLM 才有依据：
```json
{
  "protocolVersion": "1.0.0",
  "simulation": {"running": true, "speed": 1, "timeSec": 120, "inTransit": 2,
    "consumed": {"item_blank": 8}, "produced": {"item_motor": 6}},
  "objects": [{"id":"obj_1","type":"conveyor","role":"conveyor",
    "pos":{"x":0,"z":0},"rotation":0,"recipeId":null,"itemId":null}],
  "items": [], "recipes": []
}
```
> 真实结构对应 `src/game/assistantProtocol.ts` 的 `FactoryAssistantContext`，不是 `FactorySave` 的直接替代品；上下文由前端从当前 store 和仿真快照生成。

### 4.3 校验与执行边界

执行动作前：
1. **协议校验**：工具调用必须是版本 `1.0.0` 的 JSON 对象，名称必须在权威目录内。
2. **参数和引用校验**：前后端均检查字段集合、类型、对象 ID、对象角色，以及 recipe/item 引用是否存在。
3. **确认门控**：重置仿真、修改配方和绑定来料在前端执行前进入待确认状态。
4. **执行写回**：通过 `src/game/assistantExecutor.ts` 调用 Zustand actions，配置变更会触发仿真重建。
5. **后续增强**：副本仿真回算、吞吐差异报告和负增益回退尚未实现，不能在当前接口上宣称已具备优化验证能力。

### 4.4 ai-service 编排接口（8000）

当前 `ai-service/main.py` 提供规则/可选远程编排（`POST /api/ai/assistant`，并支持 `/api/ai/assistant/stream`）。下列内容记录旧 Ollama 版本的接入方式；现行调用方应遵循版本化工具协议，不直接复用本节早期的动作字段：

```
POST /api/ai/assistant
请求: {"question": "现在工厂运行情况怎么样？", "context": {<工厂状态快照>}}
响应: {
  "answer": "工厂运行中，在途物料 2 件，累计产出 6 件。", // 给用户的自然语言
  "source": "llm",
  "protocolVersion": "1.0.0",
  "action": {"protocolVersion":"1.0.0","name":"query_factory_status","arguments":{}},
  "validated": true,
  "requiresConfirmation": false
}
```

语音入口由网页端先调用 `POST /api/ai/asr`，再调用 `/api/ai/assistant/stream`；播报调用 `POST /api/ai/tts`。当前没有 `/api/ai/voice` 聚合接口。

---

## 5. ai-service 环境

- Python 必须 **3.10**（`py -3.10`，3.14 无 pydantic-core wheel）。
- 依赖：`fastapi uvicorn[standard] pydantic`，加 ASR 则 `sherpa-onnx soundfile numpy`，加 LLM 调用用标准库 `urllib` 即可。
- **国内网络必须用镜像**：
  ```bash
  pip install -i https://pypi.tuna.tsinghua.edu.cn/simple <包>
  ```
  torch CPU 用 `--index-url https://mirror.sjtu.edu.cn/pytorch-wheels/cpu`。
- **坑**：setuptools 必须 <81（`pip install "setuptools<81"`），否则 librosa 0.9.1 的 `pkg_resources` 崩。
- pip 缓存/临时目录建议指到 D 盘：`PIP_CACHE_DIR=D:\local\pip-cache TMPDIR=D:\local\pip-tmp`。

---

## 6. BT-7274 系统提示词（few-shot，直接可用）

`voice_chat.py` 的 `SYSTEM_PROMPT`（效果已验证）：

```
你是泰坦陨落2里的机甲AI BT-7274。说话必须像BT：沉稳、冷静、专业、极简，带一点机械式礼貌。
称呼用户为「驾驶员」。禁止「你好呀」「嗨」「哦」「呢」「啦」等活泼语气词，禁止寒暄客套。
每次回答不超过一句话（20字以内），直接说结论。

风格示例：
用户：你好
你：收到，驾驶员。需要什么帮助？
用户：今天辛苦了
你：收到，驾驶员。已记录你的付出。
用户：传送带好像卡住了
你：系统检测到传送带异常，建议排查。
用户：介绍一下你自己
你：我是BT七二七四，你的机甲AI，随时待命。
用户：把仿真速度调到 2 倍
你：收到，仿真倍率已设为 2。
```

> 控制场景建议再加一句：`当你需要执行动作时，只能调用 contracts/forgemind-assistant-tools.json 中的工具；不要编造工具名或参数。需要确认的动作先向驾驶员说明并等待确认。`

---

## 7. 参考实现（可直接复用/迁移）

### 7.1 语音助手全链路 `D:\Code\factory\voice-chat\voice_chat.py`

核心函数：
- `transcribe(audio: np.ndarray[16k mono f32]) -> str` — ASR，sherpa-onnx Paraformer-zh，1s 音频约 0.16s。
- `ask_llm(messages) -> str` — 非流式聊天。
- `ask_llm_stream(messages, on_clause) -> str` — **流式 + 断句回调**（`。！？；，、\n` 切分），每出断句立即回调，用于边生成边 TTS 播放（开口时间从 ~1.8s 降到 ~1.2s）。
- `trim_history(messages, max_turns=6)` — 历史裁剪。
- `speak(text)` — 调 BT TTS（8001）播放，服务不可用回退本地 sherpa。
- 录音：`record_until_enter()`（按回车开始/结束，16k mono float32）。

### 7.2 BT TTS 服务 `D:\local\bt7274-space\bt_tts_server.py`
- `normalize_tts_text(text)` — 英文→中文归一化（§3.2）。
- 合成核心 `bt_tts.synth_array(text, **kw) -> (np.ndarray, 44100)`。

### 7.3 前端现有接入点 `D:\Code\factory\src\game\api.ts`
`src/game/api.ts` 提供 `askAssistant` 和 `streamAssistant`，后者消费 NDJSON 增量文本和最终动作信封。`src/game/assistantVoice.ts` 负责浏览器录音、16 kHz WAV 编码、ASR 与 `BT` 唤醒；`src/game/assistantRuntime.ts` 负责短句 TTS 队列和动作执行。

---

## 8. 前端仿真可控制对象（动作库的物理依据）

`src/game/types.ts` 的 `BuildType`：
`source | conveyor | splitter | merger | machine | smelter | press | assembler | inspection | washing | agv | storage`

实体 `FactoryObject { id, type, pos, rotation, recipeId?, itemId? }`。
当前执行器实际支持查询/定位、仿真启停、倍率、重置、机器配方绑定和 source 物品绑定；不支持本节早期设计中的单线调速、单机暂停/恢复、`line_id` 或 `machine_id` 动作。动作库必须以 §4.1 和 JSON 合约为准。

---

## 9. 集成自检清单（当前状态）

- [x] ai-service `POST /api/ai/assistant` 和 `/stream` 返回 1.0.0 契约，`action` 结构稳定
- [x] 所有动作经过服务端和前端的协议/参数/存在性校验，非法输入被拒绝并给出自然语言解释
- [x] 网页端支持手动录音、`BT` 关键字唤醒、ASR、流式回答和 TTS 播放
- [x] BT TTS 能播报结果；不可用时由 FastAPI 尝试回退本地 Sherpa VITS
- [x] 三个服务可被 `start_voice_demo.bat` 一键拉起；网页端仍需浏览器麦克风授权
- [ ] 副本仿真回算、吞吐差异报告和优化建议自动回退
