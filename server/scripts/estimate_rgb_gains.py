import argparse
import json
import sys

import numpy as np
from PIL import Image


def load_rgb(path: str) -> np.ndarray:
    image = Image.open(path).convert("RGB")
    return np.asarray(image, dtype=np.float32) / 255.0


def saturation(rgb: np.ndarray) -> np.ndarray:
    channel_max = rgb.max(axis=2)
    channel_min = rgb.min(axis=2)
    denom = np.maximum(channel_max, 1e-6)
    return (channel_max - channel_min) / denom


def compute_mask(camera: np.ndarray, auto: np.ndarray) -> np.ndarray:
    camera_luma = 0.2126 * camera[:, :, 0] + 0.7152 * camera[:, :, 1] + 0.0722 * camera[:, :, 2]
    auto_luma = 0.2126 * auto[:, :, 0] + 0.7152 * auto[:, :, 1] + 0.0722 * auto[:, :, 2]
    sat = np.minimum(saturation(camera), saturation(auto))

    mask = (
        (camera_luma > 0.08)
        & (camera_luma < 0.92)
        & (auto_luma > 0.08)
        & (auto_luma < 0.92)
        & (sat < 0.35)
    )

    if np.count_nonzero(mask) < 500:
        mask = (
            (camera_luma > 0.05)
            & (camera_luma < 0.95)
            & (auto_luma > 0.05)
            & (auto_luma < 0.95)
        )

    return mask


def compute_white_priority_mask(camera: np.ndarray) -> np.ndarray:
    luma = 0.2126 * camera[:, :, 0] + 0.7152 * camera[:, :, 1] + 0.0722 * camera[:, :, 2]
    sat = saturation(camera)
    channel_max = camera.max(axis=2)
    channel_min = camera.min(axis=2)
    channel_spread = channel_max - channel_min

    mask = (
        (luma > 0.32)
        & (luma < 0.94)
        & (sat < 0.22)
        & (channel_spread < 0.16)
        & (channel_max < 0.985)
        & (channel_min > 0.04)
    )

    if np.count_nonzero(mask) >= 1000:
        return mask

    return (
        (luma > 0.24)
        & (luma < 0.96)
        & (sat < 0.3)
        & (channel_spread < 0.22)
        & (channel_max < 0.99)
        & (channel_min > 0.03)
    )


def robust_channel_median(rgb: np.ndarray, mask: np.ndarray) -> tuple[float, float, float] | None:
    if np.count_nonzero(mask) < 500:
        return None

    values = rgb[mask]
    if values.size == 0:
        return None

    # Trim extremes so lamps, windows, and dark furniture do not dominate the white target.
    luma = 0.2126 * values[:, 0] + 0.7152 * values[:, 1] + 0.0722 * values[:, 2]
    low, high = np.percentile(luma, [15, 85])
    trimmed = values[(luma >= low) & (luma <= high)]
    if trimmed.shape[0] < 300:
        trimmed = values

    medians = np.median(trimmed, axis=0)
    if not np.all(np.isfinite(medians)) or np.min(medians) <= 1e-4:
        return None

    return float(medians[0]), float(medians[1]), float(medians[2])


def compute_white_priority_gains(camera: np.ndarray) -> dict[str, float] | None:
    medians = robust_channel_median(camera, compute_white_priority_mask(camera))
    if medians is None:
        return None

    r_median, g_median, b_median = medians
    if g_median <= 1e-6:
        return None

    # Normalize to green, matching RawTherapee/Sony-style relative RGB gains.
    return {
        "r": max(0.7, min(1.5, g_median / r_median)),
        "g": 1.0,
        "b": max(0.7, min(1.5, g_median / b_median)),
    }


def blend_gains(auto_gains: dict[str, float], white_gains: dict[str, float] | None) -> dict[str, float]:
    if white_gains is None:
        return auto_gains

    # White Priority should strongly neutralize walls/cabinets, but keep some auto-WB context.
    white_weight = 0.72
    auto_weight = 1.0 - white_weight

    return {
        "r": max(0.7, min(1.5, white_gains["r"] * white_weight + auto_gains["r"] * auto_weight)),
        "g": 1.0,
        "b": max(0.7, min(1.5, white_gains["b"] * white_weight + auto_gains["b"] * auto_weight)),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", required=True)
    parser.add_argument("--auto", required=True)
    args = parser.parse_args()

    camera = load_rgb(args.camera)
    auto = load_rgb(args.auto)

    if camera.shape != auto.shape:
        auto_image = Image.fromarray(np.clip(auto * 255.0, 0, 255).astype(np.uint8), mode="RGB")
        auto_image = auto_image.resize((camera.shape[1], camera.shape[0]), Image.Resampling.BILINEAR)
        auto = np.asarray(auto_image, dtype=np.float32) / 255.0

    mask = compute_mask(camera, auto)
    safe_camera = np.maximum(camera, 1e-4)
    ratios = auto / safe_camera

    if np.count_nonzero(mask) == 0:
        mask = np.ones(camera.shape[:2], dtype=bool)

    channel_ratios = []
    for channel_index in range(3):
        channel_values = ratios[:, :, channel_index][mask]
        finite_values = channel_values[np.isfinite(channel_values)]
        if finite_values.size == 0:
            channel_ratios.append(1.0)
        else:
            channel_ratios.append(float(np.median(finite_values)))

    r_ratio, g_ratio, b_ratio = channel_ratios
    if not np.isfinite(g_ratio) or g_ratio <= 1e-6:
        g_ratio = 1.0

    auto_gains = {
        "r": max(0.7, min(1.5, r_ratio / g_ratio)),
        "g": 1.0,
        "b": max(0.7, min(1.5, b_ratio / g_ratio)),
    }
    gains = blend_gains(auto_gains, compute_white_priority_gains(camera))

    sys.stdout.write(json.dumps(gains))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
