"""
ForgeMind 语音对话助手
录音 → ASR → ForgeMind 可选智能服务 → TTS → 播放。

智能服务默认使用规则模式，也可由服务端显式配置远程 DeepSeek；
本控制台不安装、不启动也不直接访问本地大语言模型。

用法：  ./venv/Scripts/python voice_chat.py
交互：  按回车开始说话 → 说完再按回车 → 听它回答 → 循环。说「退出」结束。
"""
import io
import json
import os
import queue
import threading
import urllib.request

import numpy as np
import sounddevice as sd
import soundfile as sf
import sherpa_onnx

# ---------- 配置 ----------
ASR_DIR = "models/sherpa-onnx-paraformer-zh-2023-09-14"
TTS_DIR = "models/sherpa-onnx-vits-zh-ll"
TTS_SID = int(os.getenv("FORGEMIND_TTS_SID", "1"))
ASSISTANT_URL = os.getenv("FORGEMIND_AI_URL", "http://127.0.0.1:8000/api/ai/assistant")
SAMPLE_RATE = 16000
BT_TTS_URL = "http://127.0.0.1:8001/tts"   # BT-7274 语音服务（Bert-VITS2）
SILENCE_THRESHOLD = 0.01

# ---------- 加载模型 ----------
print("加载 ASR 模型…")
asr = sherpa_onnx.OfflineRecognizer.from_paraformer(
    paraformer=f"{ASR_DIR}/model.int8.onnx",
    tokens=f"{ASR_DIR}/tokens.txt",
    num_threads=4,
    sample_rate=16000,
    feature_dim=80,
)

print("加载本地 TTS（断网兜底）…")
tts_fallback = sherpa_onnx.OfflineTts(
    sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=f"{TTS_DIR}/model.onnx",
                tokens=f"{TTS_DIR}/tokens.txt",
                lexicon=f"{TTS_DIR}/lexicon.txt",
                dict_dir=f"{TTS_DIR}/dict",
                data_dir=f"{TTS_DIR}/",
            ),
            num_threads=4,
        ),
        rule_fsts=f"{TTS_DIR}/date.fst,{TTS_DIR}/number.fst",
    )
)

# ---------- 功能函数 ----------
def record_until_enter():
    """按回车开始录音，再按回车结束。返回 float32 单声道数组。"""
    frames, recording = [], threading.Event()
    recording.set()

    def callback(indata, *_):
        if recording.is_set():
            frames.append(indata.copy())

    input("  按回车开始说话…")
    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="float32", callback=callback):
        print("  正在听，请说话…（再按回车结束）")
        input()
        recording.clear()
    return np.concatenate(frames) if frames else np.zeros(0, dtype="float32")


def transcribe(audio):
    stream = asr.create_stream()
    stream.accept_waveform(sample_rate=SAMPLE_RATE, waveform=audio)
    asr.decode_stream(stream)
    return stream.result.text


def ask_assistant(question):
    body = json.dumps({"question": question, "context": {}}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        ASSISTANT_URL,
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    return str(result.get("answer") or "规则助手没有返回文本。")


def speak(text):
    """BT-7274 语音合成（HTTP 服务），服务不可用时回退本地 sherpa。"""
    try:
        body = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            BT_TTS_URL, data=body, headers={"Content-Type": "application/json"}
        )
        resp = urllib.request.urlopen(req, timeout=120).read()
        data, sr = sf.read(io.BytesIO(resp))
        if data.ndim > 1:
            data = data.mean(axis=1)
        sd.play(data.astype("float32"), samplerate=sr)
        sd.wait()
    except Exception as e:
        print(f"  (BT 语音服务不可用，用本地音色: {e})")
        audio = tts_fallback.generate(text, sid=TTS_SID, speed=1.0)
        sd.play(audio.samples, samplerate=audio.sample_rate)
        sd.wait()


def _tts_worker(q):
    while True:
        item = q.get()
        if item is None:
            break
        try:
            speak(item)
        except Exception as e:
            print(f"  (播放异常: {e})")
        finally:
            q.task_done()


# ---------- 主循环 ----------
def main():
    tts_queue = queue.Queue()
    threading.Thread(target=_tts_worker, args=(tts_queue,), daemon=True).start()
    print("\n语音助手就绪！说「退出」结束。")
    print("-" * 50)

    while True:
        audio = record_until_enter()
        if len(audio) / SAMPLE_RATE < 0.3:
            print("  (录音太短，忽略)\n")
            continue
        if np.max(np.abs(audio)) < SILENCE_THRESHOLD:
            print("  (没听到声音，请靠近麦克风)\n")
            continue

        text = transcribe(audio)
        print(f"你说: {text}")
        if "退出" in text or "再见" in text:
            print("再见！")
            break

        reply = ask_assistant(text)
        tts_queue.put(reply)
        print(f"助手: {reply}")
        tts_queue.join()   # 等所有断句播完
        print()


if __name__ == "__main__":
    main()
