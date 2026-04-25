import argparse
import json
import math

import numpy as np
from PIL import Image


def load_rgb(path: str) -> np.ndarray:
    image = Image.open(path).convert("RGB")
    return np.asarray(image, dtype=np.float32) / 255.0


def resize_to_match(source: np.ndarray, target: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    if source.shape[:2] == target.shape[:2]:
        return source, target

    target_image = Image.fromarray(np.clip(target * 255.0, 0, 255).astype(np.uint8), mode="RGB")
    target_image = target_image.resize((source.shape[1], source.shape[0]), Image.Resampling.BILINEAR)
    target = np.asarray(target_image, dtype=np.float32) / 255.0
    return source, target


def luminance(rgb: np.ndarray) -> np.ndarray:
    return 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--target", required=True)
    parser.add_argument("--gain-r", type=float, default=1.0)
    parser.add_argument("--gain-g", type=float, default=1.0)
    parser.add_argument("--gain-b", type=float, default=1.0)
    args = parser.parse_args()

    source = load_rgb(args.source)
    target = load_rgb(args.target)
    source, target = resize_to_match(source, target)

    source[:, :, 0] *= args.gain_r
    source[:, :, 1] *= args.gain_g
    source[:, :, 2] *= args.gain_b
    source = np.clip(source, 0.0, 1.0)

    source_luma = luminance(source)
    target_luma = luminance(target)

    mask = (
        (source_luma > 0.02)
        & (source_luma < 0.98)
        & (target_luma > 0.05)
        & (target_luma < 0.95)
    )
    if np.count_nonzero(mask) < 500:
        mask = np.ones(source_luma.shape, dtype=bool)

    source_vals = source_luma[mask]
    target_vals = target_luma[mask]

    source_p50 = float(np.percentile(source_vals, 50))
    source_p75 = float(np.percentile(source_vals, 75))
    target_p50 = float(np.percentile(target_vals, 50))
    target_p75 = float(np.percentile(target_vals, 75))

    target_p50 = max(target_p50, 0.28)
    target_p75 = max(target_p75, 0.5)
    delta_p50 = target_p50 - source_p50
    delta_p75 = target_p75 - source_p75

    if source_p75 <= 1e-6:
        exposure = 1.0
    else:
        exposure = target_p75 / source_p75
    exposure = max(0.9, min(1.25, exposure))

    if delta_p50 <= 0.015 and delta_p75 <= 0.02:
        exposure = 1.0
    elif source_p75 >= 0.72:
        exposure = min(exposure, 1.08)
    elif source_p75 >= 0.65:
        exposure = min(exposure, 1.14)

    if target_p75 <= source_p75 and target_p50 <= source_p50:
        exposure = min(exposure, 1.0)

    x = max(1e-4, min(0.99, source_p50 * exposure))
    y = max(1e-4, min(0.99, target_p50))
    if abs(x - 1.0) < 1e-6 or x <= 0 or y <= 0:
        gamma = 1.0
    else:
        gamma = math.log(y) / math.log(x)
    gamma = max(0.9, min(1.25, gamma))

    if delta_p50 <= 0.015 and delta_p75 <= 0.02:
        gamma = 1.0
    elif source_p50 >= 0.52:
        gamma = min(gamma, 1.06)
    elif source_p50 >= 0.45:
        gamma = min(gamma, 1.12)

    if target_p75 <= source_p75 and target_p50 <= source_p50:
        gamma = min(gamma, 1.0)

    print(json.dumps({"exposure": exposure, "gamma": gamma}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
