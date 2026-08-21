"""ASR 独立测试：用 Paraformer-zh 识别一段测试音频，验证模型加载与中文识别。"""
import time
import sherpa_onnx
import soundfile as sf  # sherpa_onnx 依赖自带

MODEL_DIR = "models/sherpa-onnx-paraformer-zh-2023-09-14"

rec = sherpa_onnx.OfflineRecognizer.from_paraformer(
    paraformer=f"{MODEL_DIR}/model.int8.onnx",
    tokens=f"{MODEL_DIR}/tokens.txt",
    num_threads=4,
    sample_rate=16000,
    feature_dim=80,
)

# 用模型自带的测试音频
wav_file = f"{MODEL_DIR}/test_wavs/0.wav"
samples, sr = sf.read(wav_file, dtype="float32")

t0 = time.time()
stream = rec.create_stream()
stream.accept_waveform(sample_rate=sr, waveform=samples)
rec.decode_stream(stream)
result = stream.result
elapsed = time.time() - t0

print(f"识别结果: {result.text}")
print(f"音频时长: {len(samples)/sr:.1f}s, 识别耗时: {elapsed:.2f}s, 实时率: {elapsed/(len(samples)/sr):.2f}x")
