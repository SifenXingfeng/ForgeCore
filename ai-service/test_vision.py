"""合成测试：验证 /api/vision/detect 对干净件/划痕/毛刺/凹痕的分类与判定。"""
import base64
import json
import urllib.request

import cv2
import numpy as np

URL = "http://127.0.0.1:8000/api/vision/detect"


def make_part(defects: list[str]) -> str:
    img = np.full((384, 512, 3), (45, 42, 35), np.uint8)
    pt = (48, 127, 255)
    cv2.rectangle(img, (160, 130), (360, 260), pt, -1)
    for d in defects:
        if d == "scratch":
            cv2.line(img, (200, 160), (305, 242), (20, 18, 15), 3)
        elif d == "burr":
            cv2.circle(img, (240, 200), 7, (15, 13, 10), -1)
        elif d == "dent":
            cv2.circle(img, (260, 200), 30, (30, 28, 25), -1)
    ok, buf = cv2.imencode(".png", img)
    return base64.b64encode(buf.tobytes()).decode()


def detect(b64: str) -> dict:
    body = json.dumps({"image": b64, "partId": "t"}).encode()
    req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=30).read().decode())


cases = {
    "clean": [],
    "scratch": ["scratch"],
    "burr": ["burr"],
    "dent": ["dent"],
    "multi": ["scratch", "burr", "burr"],
}
for name, defects in cases.items():
    result = detect(make_part(defects))
    types = [d["type"] for d in result["defects"]]
    print(f"{name:9s} -> verdict={result['verdict']:6s} conf={result['confidence']} defects={types}")
