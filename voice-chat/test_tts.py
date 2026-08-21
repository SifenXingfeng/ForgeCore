"""TTS 独立测试：用 VITS-zh-ll 合成一段中文语音，保存成 wav 验证。"""
import time
import sherpa_onnx
import soundfile as sf

MODEL_DIR = "models/sherpa-onnx-vits-zh-ll"

tts_config = sherpa_onnx.OfflineTtsConfig(
    model=sherpa_onnx.OfflineTtsModelConfig(
        vits=sherpa_onnx.OfflineTtsVitsModelConfig(
            model=f"{MODEL_DIR}/model.onnx",
            tokens=f"{MODEL_DIR}/tokens.txt",
            lexicon=f"{MODEL_DIR}/lexicon.txt",
            dict_dir=f"{MODEL_DIR}/dict",
            data_dir=f"{MODEL_DIR}/",
        ),
        num_threads=4,
    ),
    rule_fsts=f"{MODEL_DIR}/date.fst,{MODEL_DIR}/number.fst",
)

tts = sherpa_onnx.OfflineTts(tts_config)
print(f"采样率: {tts.sample_rate}, 可用说话人: 0-2 (共3个)")

text = "你好，我是智慧工厂的控制助手。现在生产线的效率是百分之八十五。"
for sid in range(3):
    t0 = time.time()
    audio = tts.generate(text, sid=sid, speed=1.0)
    elapsed = time.time() - t0
    wav = f"tts_test_sid{sid}.wav"
    sf.write(wav, audio.samples, samplerate=audio.sample_rate)
    print(f"说话人{sid}: 合成 {len(audio.samples)/audio.sample_rate:.1f}s 语音, 耗时 {elapsed:.2f}s → {wav}")
