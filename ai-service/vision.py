"""工业视觉检测：分割橙色被测件 → 内部缺陷检测（划痕/毛刺/凹痕）→ 判定。

输入：OpenCV BGR 图像（质检相机截图，橙色零件置于深色检测台上）。
输出：结构化缺陷列表 + verdict。
"""
from __future__ import annotations

import cv2
import numpy as np

# 橙色被测件（HSV 范围，放宽以兼容不同光照下的渲染）
_ORANGE_LOWER = np.array([5, 25, 60])
_ORANGE_UPPER = np.array([35, 255, 255])


def detect(image_bgr: np.ndarray) -> dict:
    masks = _compute_masks(image_bgr)
    return _classify(image_bgr, masks)


def detect_debug(image_bgr: np.ndarray, save_dir) -> dict:
    import os
    os.makedirs(save_dir, exist_ok=True)
    masks = _compute_masks(image_bgr)
    cv2.imwrite(os.path.join(save_dir, "input.png"), image_bgr)
    cv2.imwrite(os.path.join(save_dir, "orange_mask.png"), masks["mask"])
    cv2.imwrite(os.path.join(save_dir, "interior.png"), masks["interior"])
    cv2.imwrite(os.path.join(save_dir, "dark_mask.png"), masks["dark_mask"])
    return _classify(image_bgr, masks)


def _compute_masks(image_bgr: np.ndarray) -> dict:
    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, _ORANGE_LOWER, _ORANGE_UPPER)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return {"mask": mask, "interior": None, "dark_mask": None, "contours": []}
    part = max(contours, key=cv2.contourArea)

    interior = np.zeros_like(mask)
    cv2.drawContours(interior, [part], -1, 255, -1)
    interior = cv2.erode(interior, np.ones((5, 5), np.uint8))

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    interior_gray = cv2.bitwise_and(gray, gray, mask=interior)
    # 自适应暗区阈值：相对零件内部中位灰度（零件渲染亮暗都稳定）
    values = interior_gray[interior > 0]
    median = float(np.median(values)) if len(values) else 0.0
    dark_threshold = max(30.0, median * 0.55)
    _, dark_mask = cv2.threshold(interior_gray, dark_threshold, 255, cv2.THRESH_BINARY_INV)
    dark_mask = cv2.bitwise_and(dark_mask, dark_mask, mask=interior)
    dark_mask = cv2.morphologyEx(dark_mask, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
    return {"mask": mask, "interior": interior, "dark_mask": dark_mask, "contours": [part], "threshold": dark_threshold}


def _classify(image_bgr: np.ndarray, masks: dict) -> dict:
    part = masks["contours"][0] if masks["contours"] else None
    if part is None:
        return {"verdict": "error", "defects": [], "confidence": 0.0, "note": "未检测到被测件"}
    x, y, w, h = cv2.boundingRect(part)
    part_area = float(cv2.contourArea(part))
    interior = masks["interior"]
    dark_mask = masks["dark_mask"]
    if interior is None or dark_mask is None or part_area <= 0:
        return {"verdict": "error", "defects": [], "confidence": 0.0, "note": "未检测到被测件"}

    # 内部暗区连通域 → 按形状分类缺陷
    defects: list[dict] = []
    n, labels, stats, cents = cv2.connectedComponentsWithStats(dark_mask, connectivity=8)
    for i in range(1, n):
        area = float(stats[i, cv2.CC_STAT_AREA])
        if area < 6:
            continue
        # 用最小外接矩形求真实伸长率（斜向划痕的 bbox 是方的，会误判）
        comp = np.where(labels == i, 255, 0).astype(np.uint8)
        cnts, _ = cv2.findContours(comp, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        cnt = max(cnts, key=cv2.contourArea)
        (_, _), (mw, mh), _ = cv2.minAreaRect(cnt)
        long_side = max(mw, mh)
        short_side = min(mw, mh)
        elongation = long_side / max(1.0, short_side)
        cx, cy = float(cents[i][0]), float(cents[i][1])
        rel = area / max(part_area, 1.0)
        severity = round(min(rel * 20, 1.0), 2)
        if severity < 0.02:
            continue  # 微小噪点，忽略
        if elongation > 2.0:
            dtype = "scratch"
        elif rel > 0.05:
            dtype = "dent"
        else:
            dtype = "burr"
        defects.append({
            "type": dtype,
            "x": int(cx), "y": int(cy),
            "size": int(long_side),
            "severity": severity,
        })

    verdict = "fail" if defects else "pass"
    confidence = round(max(0.5, 0.92 - 0.04 * len(defects)), 2)
    return {
        "verdict": verdict,
        "defects": defects,
        "confidence": confidence,
        "note": f"零件区域 {w}x{h}px",
    }
