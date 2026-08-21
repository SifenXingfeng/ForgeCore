"""
ForgeMind 可选智能服务（FastAPI）—— 规则助手、远程 LLM、语音和视觉网关。

职责边界（§5.2）：
- 绝不进实时仿真链路（AGV/产能/瓶颈在 Java 引擎侧）。
- 默认规则模式不依赖本地部署大模型；远程模型只能显式启用。
- 只暴露辅助入口：受限助手、需求约束提取、语音和视觉网关。
- 当前通过 HTTP 被前端调用；Redis Stream/Kafka 仅是未来多实例部署的异步通信方案。
"""
import base64
import io
import json
import os
import re
import threading
import urllib.error
import urllib.request
import wave
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

PROTOCOL_PATH = Path(__file__).resolve().parent.parent / "contracts" / "forgemind-assistant-tools.json"
with PROTOCOL_PATH.open("r", encoding="utf-8") as protocol_file:
    TOOL_CATALOG: dict[str, Any] = json.load(protocol_file)

PROTOCOL_VERSION = TOOL_CATALOG["protocolVersion"]
TOOL_NAMES = {tool["name"] for tool in TOOL_CATALOG["tools"]}
TOOL_BY_NAME = {tool["name"]: tool for tool in TOOL_CATALOG["tools"]}
LLM_PROVIDER = os.getenv("FORGEMIND_LLM_PROVIDER", "rule").lower()
if LLM_PROVIDER not in {"rule", "deepseek"}:
    LLM_PROVIDER = "rule"
LLM_TIMEOUT_SEC = float(os.getenv("FORGEMIND_LLM_TIMEOUT", "45"))
DEEPSEEK_BASE_URL = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
VOICE_ENABLED = os.getenv("FORGEMIND_VOICE_ENABLED", "false").lower() in {"1", "true", "yes", "on"}
TTS_BASE_URL = os.getenv("FORGEMIND_TTS_URL", "http://127.0.0.1:8001").rstrip("/")
TTS_TIMEOUT_SEC = float(os.getenv("FORGEMIND_TTS_TIMEOUT", "45"))
TTS_BACKEND = os.getenv("FORGEMIND_TTS_BACKEND", "bt").lower()
TTS_SID = int(os.getenv("FORGEMIND_TTS_SID", "1"))
TTS_MODEL_DIR = Path(os.getenv(
    "FORGEMIND_TTS_MODEL_DIR",
    str(PROTOCOL_PATH.parent.parent / "voice-chat" / "models" / "sherpa-onnx-vits-zh-ll"),
))
ASR_MODEL_DIR = Path(os.getenv(
    "FORGEMIND_ASR_MODEL_DIR",
    str(PROTOCOL_PATH.parent.parent / "voice-chat" / "models" / "sherpa-onnx-paraformer-zh-2023-09-14"),
))
_asr_recognizer: Any = None
_asr_lock = threading.Lock()
_fast_tts: Any = None
_fast_tts_lock = threading.Lock()

SYSTEM_PROMPT = """你是 ForgeMind 工厂的智能管家 BT-7274。
你称呼用户为“驾驶员”，语气沉稳、冷静、专业、简洁；对简短问候正常回应，不使用活泼语气词。
你只能依据提供的工厂上下文回答，不得编造设备、配方、产量或运行状态。
当用户要求查询或控制工厂时，使用工具调用；工具参数必须使用上下文中的真实字符串 ID，不要把自然语言编号当成 ID。
如果对象名称有歧义，先让驾驶员确认，不要猜测。控制动作只提出建议，ForgeMind 前端会在执行前再次校验并决定是否需要确认。
普通回答不超过两句话；工具调用同时给出一句简短的中文播报。"""

@asynccontextmanager
async def lifespan(_: FastAPI):
    if VOICE_ENABLED:
        threading.Thread(target=preload_asr, name="forgemind-asr-preload", daemon=True).start()
        if TTS_BACKEND == "sherpa":
            threading.Thread(target=preload_fast_tts, name="forgemind-tts-preload", daemon=True).start()
        else:
            threading.Thread(target=preload_bt_tts, name="forgemind-bt-tts-preload", daemon=True).start()
    yield


app = FastAPI(title="ForgeMind AI Service", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AssistantRequest(BaseModel):
    """AI 助手请求：自然语言问题 + 可选的工厂统计数据上下文。"""
    question: str
    context: dict | None = None


class AssistantToolCall(BaseModel):
    """模型建议的动作。该结构仍须由 ForgeMind 执行层重新校验。"""

    model_config = ConfigDict(populate_by_name=True)

    protocol_version: Literal["1.0.0"] = Field(alias="protocolVersion")
    name: Literal[
        "query_factory_status",
        "inspect_object",
        "select_object",
        "set_simulation_running",
        "set_simulation_speed",
        "reset_simulation",
        "change_machine_recipe",
        "bind_source_item",
    ]
    arguments: dict[str, Any]


class AssistantReply(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    answer: str
    source: Literal["rule", "llm", "stub", "fallback"]
    note: str | None = None
    protocol_version: Literal["1.0.0"] = Field(default="1.0.0", alias="protocolVersion")
    action: AssistantToolCall | None = None
    validated: bool = False
    requires_confirmation: bool = Field(default=False, alias="requiresConfirmation")


class FactorySpecRequest(BaseModel):
    """自然语言工厂需求；只负责提取约束，不让模型直接生成布局对象。"""

    brief: str
    defaults: dict[str, Any] = Field(default_factory=dict)


class FactorySpecReply(BaseModel):
    spec: dict[str, Any]
    source: Literal["deepseek", "rule", "fallback"]
    note: str | None = None


@app.get("/api/ai/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": "forgemind-ai",
        "protocolVersion": PROTOCOL_VERSION,
        "tools": len(TOOL_NAMES),
        "llm": {
            "provider": LLM_PROVIDER,
            "deepseekConfigured": bool(DEEPSEEK_API_KEY),
            "localModelRequired": False,
        },
        "voiceEnabled": VOICE_ENABLED,
        "tts": {
            "backend": TTS_BACKEND,
            "model": str(TTS_MODEL_DIR) if TTS_BACKEND == "sherpa" else TTS_BASE_URL,
            "fallback": "sherpa" if TTS_BACKEND == "bt" else None,
        },
    }


@app.get("/api/ai/tools")
def tools() -> dict[str, Any]:
    """向前端和本地 LLM 编排器公开同一份版本化工具目录。"""
    return TOOL_CATALOG


@app.post("/api/ai/factory-spec", response_model=FactorySpecReply)
def factory_spec(req: FactorySpecRequest) -> FactorySpecReply:
    """把需求提取为受限 GenerationSpec；布局和仿真仍由前端确定性规划器负责。"""
    brief = req.brief.strip()
    defaults = normalize_factory_spec(req.defaults)
    if not brief:
        return FactorySpecReply(spec=defaults, source="rule", note="需求为空，使用表单约束。")

    if LLM_PROVIDER != "deepseek":
        return FactorySpecReply(spec=defaults, source="rule", note="规则模式：使用前端已提取并校验的约束。")
    if not DEEPSEEK_API_KEY:
        return FactorySpecReply(spec=defaults, source="fallback", note="未配置 DeepSeek API Key，使用规则约束。")
    try:
        raw = deepseek_factory_spec(brief, defaults)
        return FactorySpecReply(spec=normalize_factory_spec(raw, defaults), source="deepseek", note="DeepSeek 已完成受限约束提取。")
    except Exception as exc:  # noqa: BLE001
        return FactorySpecReply(spec=defaults, source="fallback", note=f"远程模型不可用，使用规则约束：{exc}")


class AsrReply(BaseModel):
    text: str
    sampleRate: int = 16000


class TtsRequest(BaseModel):
    text: str
    length_scale: float = 1.0


@app.post("/api/ai/asr", response_model=AsrReply)
async def asr(request: Request) -> AsrReply:
    """接收浏览器录制的 PCM WAV，使用本地 Paraformer 返回中文文本。"""
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="音频为空")
    try:
        text = transcribe_wav(audio)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except (ValueError, wave.Error) as exc:
        raise HTTPException(status_code=400, detail=f"WAV 音频无效：{exc}") from exc
    return AsrReply(text=text, sampleRate=16000)


@app.post("/api/ai/tts")
def tts(req: TtsRequest) -> Response:
    """低延迟本地 TTS；默认保留 BT 音色，失联时回退 sherpa VITS。"""
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="播报文本为空")
    if TTS_BACKEND == "sherpa":
        try:
            return Response(content=synthesize_fast_tts(text, req.length_scale), media_type="audio/wav")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"本地快速 TTS 失败：{exc}") from exc

    try:
        return proxy_bt_tts(text, req.length_scale)
    except HTTPException:
        try:
            return Response(content=synthesize_fast_tts(text, req.length_scale), media_type="audio/wav")
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=f"BT 与备用 TTS 均不可用：{exc}") from exc


def proxy_bt_tts(text: str, length_scale: float) -> Response:
    payload = json.dumps(
        {"text": text, "length_scale": length_scale},
        ensure_ascii=False,
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{TTS_BASE_URL}/tts",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TTS_TIMEOUT_SEC) as upstream:
            audio = upstream.read()
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"BT TTS 返回 {exc.code}") from exc
    except (OSError, urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(status_code=503, detail="BT TTS 服务未连接") from exc
    return Response(content=audio, media_type="audio/wav")


def preload_bt_tts() -> None:
    """触发 Bert-VITS2 首次推理初始化，避免第一句额外等待数秒。"""
    try:
        proxy_bt_tts("系统就绪。", 1.0)
    except Exception:
        # 8001 未启动时先准备快速本地兜底。
        preload_fast_tts()


def preload_fast_tts() -> None:
    try:
        get_fast_tts()
        # 第一次推理会初始化内部执行计划，启动阶段先完成这一步。
        synthesize_fast_tts("系统就绪。", 1.0)
    except Exception:
        return


def get_fast_tts():
    global _fast_tts
    if _fast_tts is not None:
        return _fast_tts
    with _fast_tts_lock:
        if _fast_tts is not None:
            return _fast_tts
        import sherpa_onnx

        config = sherpa_onnx.OfflineTtsConfig(
            model=sherpa_onnx.OfflineTtsModelConfig(
                vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                    model=str(TTS_MODEL_DIR / "model.onnx"),
                    tokens=str(TTS_MODEL_DIR / "tokens.txt"),
                    lexicon=str(TTS_MODEL_DIR / "lexicon.txt"),
                    dict_dir=str(TTS_MODEL_DIR / "dict"),
                    data_dir=str(TTS_MODEL_DIR),
                ),
                num_threads=4,
            ),
            rule_fsts=f"{TTS_MODEL_DIR / 'date.fst'},{TTS_MODEL_DIR / 'number.fst'}",
        )
        _fast_tts = sherpa_onnx.OfflineTts(config)
        return _fast_tts


def synthesize_fast_tts(text: str, length_scale: float) -> bytes:
    import numpy as np

    engine = get_fast_tts()
    speed = max(0.7, min(1.4, 1.0 / max(0.7, min(1.4, length_scale))))
    with _fast_tts_lock:
        audio = engine.generate(text, sid=TTS_SID, speed=speed)
    samples = np.asarray(audio.samples, dtype=np.float32)
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(audio.sample_rate)
        wav.writeframes(pcm)
    return output.getvalue()


@app.post("/api/ai/assistant", response_model=AssistantReply)
def assistant(req: AssistantRequest) -> AssistantReply:
    """使用规则助手或显式配置的远程模型生成 ForgeMind 1.0.0 动作信封。"""
    question = req.question.strip()
    if not question:
        return fallback_reply("驾驶员，请告诉我需要检查或调整什么。", "问题不能为空。")
    return create_assistant_reply(question, req.context or {})


@app.post("/api/ai/assistant/stream")
def assistant_stream(req: AssistantRequest) -> StreamingResponse:
    """返回前端可消费的 NDJSON；工具动作只在最终校验后发出。"""
    question = req.question.strip()
    if not question:
        reply = fallback_reply("驾驶员，请告诉我需要检查或调整什么。", "问题不能为空。")
        return StreamingResponse(
            iter([stream_event("done", reply=reply.model_dump(by_alias=True))]),
            media_type="application/x-ndjson",
        )
    return StreamingResponse(
        iter_assistant_events(question, req.context or {}),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


FACTORY_SPEC_PROMPT = """你是 ForgeMind 的工厂需求解析器。
只从用户需求中提取生产约束，不设计机器、不生成布局、不解释过程。
必须只返回 JSON 对象，字段只能是：product、targetThroughputPerHour、floorWidth、floorDepth、cncLimit、agvLimit、objective。
objective 只能是 balanced、throughput、energy；缺失字段沿用默认值。
"""


def deepseek_factory_spec(brief: str, defaults: dict[str, Any]) -> dict[str, Any]:
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": FACTORY_SPEC_PROMPT},
            {"role": "user", "content": json.dumps({"defaults": defaults, "brief": brief}, ensure_ascii=False)},
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
        "temperature": 0.05,
        "max_tokens": 160,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=LLM_TIMEOUT_SEC) as response:
        result = json.loads(response.read().decode("utf-8"))
    choices = result.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("DeepSeek 需求解析缺少 choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("DeepSeek 需求解析缺少 message")
    return parse_json_object(message.get("content"))


def parse_json_object(content: Any) -> dict[str, Any]:
    if not isinstance(content, str):
        raise ValueError("模型没有返回 JSON 文本")
    text = content.strip()
    if text.startswith("```"):
        text = text.strip("`").replace("json", "", 1).strip()
    value = json.loads(text)
    if not isinstance(value, dict):
        raise ValueError("需求解析结果不是对象")
    return value


def normalize_factory_spec(value: dict[str, Any] | None, defaults: dict[str, Any] | None = None) -> dict[str, Any]:
    source = {**(defaults or {
        "product": "齿轮箱",
        "targetThroughputPerHour": 120,
        "floorWidth": 30,
        "floorDepth": 20,
        "cncLimit": 4,
        "agvLimit": 3,
        "objective": "energy",
    }), **(value or {})}
    objective = source.get("objective") if source.get("objective") in {"balanced", "throughput", "energy"} else "energy"
    return {
        "product": str(source.get("product") or "齿轮箱")[:80],
        "targetThroughputPerHour": clamp_number(source.get("targetThroughputPerHour"), 120, 1, 100000),
        "floorWidth": clamp_number(source.get("floorWidth"), 30, 10, 200),
        "floorDepth": clamp_number(source.get("floorDepth"), 20, 10, 200),
        "cncLimit": int(clamp_number(source.get("cncLimit"), 4, 1, 32)),
        "agvLimit": int(clamp_number(source.get("agvLimit"), 3, 1, 32)),
        "objective": objective,
    }


def clamp_number(value: Any, fallback: float, minimum: float, maximum: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    return max(minimum, min(maximum, number))


def create_assistant_reply(question: str, context: dict[str, Any]) -> AssistantReply:
    if LLM_PROVIDER == "deepseek" and DEEPSEEK_API_KEY:
        try:
            message = deepseek_assistant_message(question, context)
            return assistant_reply_from_message(message, context)
        except Exception as exc:  # noqa: BLE001
            return rule_assistant_reply(question, context, f"远程模型不可用，已切换规则助手：{exc}")
    return rule_assistant_reply(question, context, "规则助手不需要本地大语言模型。")


def deepseek_assistant_message(question: str, context: dict[str, Any]) -> dict[str, Any]:
    context_text = json.dumps(compact_model_context(context), ensure_ascii=False, separators=(",", ":"))
    payload = {
        "model": DEEPSEEK_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"工厂实时上下文：{context_text}\n\n驾驶员请求：{question}"},
        ],
        "tools": llm_tools(),
        "tool_choice": "auto",
        "stream": False,
        "temperature": 0.15,
        "max_tokens": 240,
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{DEEPSEEK_BASE_URL}/chat/completions",
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {DEEPSEEK_API_KEY}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=LLM_TIMEOUT_SEC) as response:
        result = json.loads(response.read().decode("utf-8"))
    choices = result.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise ValueError("DeepSeek 助手响应缺少 choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("DeepSeek 助手响应缺少 message")
    return message


def assistant_reply_from_message(message: dict[str, Any], context: dict[str, Any]) -> AssistantReply:
    action = parse_tool_call(message.get("tool_calls"))
    if action is None:
        return AssistantReply(
            answer=clean_answer(message.get("content", "")) or "收到，驾驶员。当前没有需要执行的动作。",
            source="llm",
            note="远程模型文本回复",
            protocolVersion=PROTOCOL_VERSION,
            action=None,
            validated=False,
            requiresConfirmation=False,
        )
    valid, note = validate_action(action, context)
    definition = TOOL_BY_NAME[action.name]
    return AssistantReply(
        answer=clean_answer(message.get("content", "")) or action_ack(action),
        source="llm",
        note=note if not valid else "动作已通过服务端基础校验；前端执行层仍须再次校验。",
        protocolVersion=PROTOCOL_VERSION,
        action=action,
        validated=valid,
        requiresConfirmation=bool(definition.get("requiresConfirmation", False)),
    )


def rule_assistant_reply(question: str, context: dict[str, Any], note: str) -> AssistantReply:
    normalized = "".join(question.lower().split())
    action: AssistantToolCall | None = None
    if any(word in normalized for word in ("重置仿真", "重新开始", "清空进度")):
        action = AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="reset_simulation", arguments={})
    else:
        speed_match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(?:倍|x)", normalized)
        if speed_match and any(word in normalized for word in ("倍率", "倍速", "速度", "调到", "设置")):
            action = AssistantToolCall(
                protocolVersion=PROTOCOL_VERSION,
                name="set_simulation_speed",
                arguments={"speed": float(speed_match.group(1))},
            )
        elif any(word in normalized for word in ("暂停仿真", "停止仿真", "暂停生产")):
            action = AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="set_simulation_running", arguments={"running": False})
        elif any(word in normalized for word in ("启动仿真", "开始仿真", "开始生产", "继续仿真")):
            action = AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="set_simulation_running", arguments={"running": True})
        elif any(word in normalized for word in ("工厂状态", "运行情况", "生产情况", "累计产出", "在途物料")):
            action = AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name="query_factory_status", arguments={})

    if action is None:
        return AssistantReply(
            answer="规则助手已就绪。可查询工厂状态、启动或暂停仿真、调整倍率，也可发起仿真重置确认。",
            source="rule",
            note=note,
            protocolVersion=PROTOCOL_VERSION,
            action=None,
            validated=False,
            requiresConfirmation=False,
        )

    valid, validation_note = validate_action(action, context)
    definition = TOOL_BY_NAME[action.name]
    return AssistantReply(
        answer=action_ack(action),
        source="rule",
        note=validation_note if not valid else note,
        protocolVersion=PROTOCOL_VERSION,
        action=action,
        validated=valid,
        requiresConfirmation=bool(definition.get("requiresConfirmation", False)),
    )


def iter_assistant_events(question: str, context: dict[str, Any]):
    try:
        reply = create_assistant_reply(question, context)
        if reply.answer:
            yield stream_event("delta", text=reply.answer)
        yield stream_event("done", reply=reply.model_dump(by_alias=True))
    except Exception as exc:  # noqa: BLE001
        yield stream_event("error", message=f"智能助手调用失败：{exc}")


def compact_model_context(context: dict[str, Any]) -> dict[str, Any]:
    """只给模型决策所需字段；完整上下文仍保留在服务端用于动作校验。"""
    objects = context.get("objects", [])
    items = context.get("items", [])
    recipes = context.get("recipes", [])
    return {
        "protocolVersion": context.get("protocolVersion", PROTOCOL_VERSION),
        "simulation": context.get("simulation", {}),
        "objects": [
            {
                key: item.get(key)
                for key in ("id", "label", "role", "recipeId", "itemId", "runtime")
                if key in item
            }
            for item in objects
            if isinstance(item, dict)
        ],
        "items": [
            {key: item.get(key) for key in ("id", "name", "category") if key in item}
            for item in items
            if isinstance(item, dict)
        ],
        "recipes": [
            {key: item.get(key) for key in ("id", "name", "durationSec") if key in item}
            for item in recipes
            if isinstance(item, dict)
        ],
    }


def stream_event(event_type: str, **payload: Any) -> bytes:
    return (json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n").encode("utf-8")


def llm_tools() -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": tool["name"],
                "description": tool["description"],
                "parameters": tool["parameters"],
            },
        }
        for tool in TOOL_CATALOG["tools"]
    ]


def parse_tool_call(raw_calls: Any) -> AssistantToolCall | None:
    if not isinstance(raw_calls, list) or not raw_calls:
        return None
    raw = raw_calls[0]
    if not isinstance(raw, dict):
        return None
    function = raw.get("function") if isinstance(raw.get("function"), dict) else raw
    name = function.get("name")
    arguments = function.get("arguments", {})
    if not isinstance(name, str) or name not in TOOL_NAMES:
        return None
    if isinstance(arguments, str):
        try:
            arguments = json.loads(arguments)
        except json.JSONDecodeError:
            return None
    if not isinstance(arguments, dict):
        return None
    return AssistantToolCall(protocolVersion=PROTOCOL_VERSION, name=name, arguments=arguments)


def validate_action(action: AssistantToolCall, context: dict[str, Any]) -> tuple[bool, str]:
    args = action.arguments
    definition = TOOL_BY_NAME[action.name]
    properties = definition["parameters"].get("properties", {})
    if set(args) != set(properties):
        return False, "动作参数字段与协议不一致，前端将拒绝执行。"
    if action.name in {"query_factory_status", "reset_simulation"}:
        return True, ""
    if action.name == "set_simulation_running":
        return isinstance(args.get("running"), bool), "running 必须是布尔值。"
    if action.name == "set_simulation_speed":
        speed = args.get("speed")
        return isinstance(speed, (int, float)) and 0.1 <= speed <= 4, "speed 必须在 0.1 到 4 之间。"
    objects = context.get("objects", [])
    object_id = args.get("objectId")
    obj = next((item for item in objects if isinstance(item, dict) and item.get("id") == object_id), None)
    if action.name in {"inspect_object", "select_object"}:
        return (obj is not None, "对象不存在，前端将拒绝执行。" if obj is None else "")
    if obj is None:
        return False, "对象不存在，前端将拒绝执行。"
    if action.name == "change_machine_recipe":
        if obj.get("role") != "machine":
            return False, "对象不是加工设备，前端将拒绝执行。"
        recipe_id = args.get("recipeId")
        recipes = context.get("recipes", [])
        valid = recipe_id is None or any(isinstance(item, dict) and item.get("id") == recipe_id for item in recipes)
        return valid, "配方不存在，前端将拒绝执行。" if not valid else ""
    if action.name == "bind_source_item":
        if obj.get("role") != "source":
            return False, "对象不是来料站，前端将拒绝执行。"
        item_id = args.get("itemId")
        items = context.get("items", [])
        valid = item_id is None or any(isinstance(item, dict) and item.get("id") == item_id for item in items)
        return valid, "物品不存在，前端将拒绝执行。" if not valid else ""
    return True, ""


def action_ack(action: AssistantToolCall) -> str:
    return {
        "query_factory_status": "正在读取工厂状态。",
        "inspect_object": "正在读取设备状态。",
        "select_object": "正在定位目标设备。",
        "set_simulation_running": "正在调整仿真运行状态。",
        "set_simulation_speed": "正在调整仿真倍率。",
        "reset_simulation": "仿真重置需要驾驶员确认。",
        "change_machine_recipe": "设备配方变更需要驾驶员确认。",
        "bind_source_item": "来料绑定变更需要驾驶员确认。",
    }[action.name]


def clean_answer(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.strip().split())[:240]


def fallback_reply(answer: str, note: str) -> AssistantReply:
    return AssistantReply(
        answer=answer,
        source="fallback",
        note=note,
        protocolVersion=PROTOCOL_VERSION,
        action=None,
        validated=False,
        requiresConfirmation=False,
    )


def transcribe_wav(audio: bytes) -> str:
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("ASR 依赖未安装，请安装 numpy。") from exc

    with wave.open(io.BytesIO(audio), "rb") as wav:
        sample_rate = wav.getframerate()
        channels = wav.getnchannels()
        sample_width = wav.getsampwidth()
        frame_count = wav.getnframes()
        raw = wav.readframes(frame_count)
    if sample_width != 2:
        raise ValueError("当前仅支持 16-bit PCM WAV")
    waveform = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if channels > 1:
        waveform = waveform.reshape(-1, channels).mean(axis=1)
    if waveform.size == 0 or float(np.max(np.abs(waveform))) < 0.01:
        return ""
    if sample_rate != 16000:
        target_length = max(1, round(len(waveform) * 16000 / sample_rate))
        source_x = np.linspace(0, 1, len(waveform), endpoint=False)
        target_x = np.linspace(0, 1, target_length, endpoint=False)
        waveform = np.interp(target_x, source_x, waveform).astype(np.float32)

    recognizer = get_asr_recognizer()
    with _asr_lock:
        stream = recognizer.create_stream()
        stream.accept_waveform(sample_rate=16000, waveform=waveform)
        recognizer.decode_stream(stream)
        return str(stream.result.text).strip()


def preload_asr() -> None:
    try:
        get_asr_recognizer()
    except Exception:
        return


def get_asr_recognizer():
    global _asr_recognizer
    if _asr_recognizer is not None:
        return _asr_recognizer
    with _asr_lock:
        if _asr_recognizer is not None:
            return _asr_recognizer
        try:
            import sherpa_onnx
        except ImportError as exc:
            raise RuntimeError("ASR 依赖未安装，请安装 sherpa-onnx。") from exc
        model = ASR_MODEL_DIR / "model.int8.onnx"
        tokens = ASR_MODEL_DIR / "tokens.txt"
        if not model.exists() or not tokens.exists():
            raise RuntimeError(f"找不到 Paraformer 模型：{ASR_MODEL_DIR}")
        _asr_recognizer = sherpa_onnx.OfflineRecognizer.from_paraformer(
            paraformer=str(model),
            tokens=str(tokens),
            num_threads=4,
            sample_rate=16000,
            feature_dim=80,
        )
        return _asr_recognizer


class DetectRequest(BaseModel):
    """视觉检测请求：质检相机截图的 base64 PNG。"""

    image: str
    partId: str = "unknown"


class DetectDefect(BaseModel):
    type: str
    x: int
    y: int
    size: int
    severity: float


class DetectReply(BaseModel):
    verdict: Literal["pass", "fail", "error"]
    defects: list[DetectDefect]
    confidence: float
    note: str | None = None


@app.post("/api/vision/detect", response_model=DetectReply)
def vision_detect(req: DetectRequest) -> DetectReply:
    """工业视觉检测：分割橙色被测件 → 划痕/毛刺/凹痕 → 判定。"""
    try:
        import cv2
        import numpy as np
        import vision
    except ImportError as exc:
        return DetectReply(verdict="error", defects=[], confidence=0.0, note=f"视觉依赖未就绪: {exc}")
    b64 = req.image.split(",", 1)[-1]
    try:
        img_bytes = base64.b64decode(b64)
        arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is None:
            return DetectReply(verdict="error", defects=[], confidence=0.0, note="图片解码失败")
    except Exception as exc:  # noqa: BLE001
        return DetectReply(verdict="error", defects=[], confidence=0.0, note=f"输入异常: {exc}")

    result = vision.detect(img)
    return DetectReply(
        verdict=result["verdict"],
        defects=[DetectDefect(**d) for d in result["defects"]],
        confidence=result["confidence"],
        note=result["note"],
    )


@app.post("/api/vision/debug")
def vision_debug(req: DetectRequest) -> DetectReply:
    """调试：保存输入帧与中间掩膜到 D:/local/vision-debug，并返回判定。"""
    from pathlib import Path as _Path
    b64 = req.image.split(",", 1)[-1]
    img_bytes = base64.b64decode(b64)
    img = cv2.imdecode(np.frombuffer(img_bytes, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return DetectReply(verdict="error", defects=[], confidence=0.0, note="图片解码失败")
    save_dir = _Path(r"D:/local/vision-debug")
    result = vision.detect_debug(img, save_dir)
    return DetectReply(
        verdict=result["verdict"],
        defects=[DetectDefect(**d) for d in result["defects"]],
        confidence=result["confidence"],
        note=f"{result['note']} · 已存 {save_dir}",
    )
