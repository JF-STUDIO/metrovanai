import json
import math
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import numpy as np
import requests
from PIL import Image


RAW_EXTENSIONS = {".arw", ".cr2", ".cr3", ".nef", ".raf", ".dng", ".rw2", ".orf"}
JPEG_EXTENSIONS = {".jpg", ".jpeg"}
HDR_LONG_EDGE = 3000


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def find_tool(env_name: str, names: list[str]) -> str:
    configured = env(env_name)
    if configured and Path(configured).exists():
        return configured
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    return ""


TOOLS = {
    "exiftool": find_tool("METROVAN_EXIFTOOL", ["exiftool"]),
    "magick": find_tool("METROVAN_MAGICK", ["magick", "convert"]),
    "align": find_tool("METROVAN_ALIGN_IMAGE_STACK", ["align_image_stack"]),
    "enfuse": find_tool("METROVAN_ENFUSE", ["enfuse"]),
    "rawtherapee": find_tool("METROVAN_RAWTHERAPEE_CLI", ["rawtherapee-cli"]),
}


def run_process(command: str, args: list[str], cwd: Path, timeout: int = 300) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        [command, *args],
        cwd=str(cwd),
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
    return result


def trim_error(value: str) -> str:
    value = (value or "").replace("\r", " ").replace("\n", " ").strip()
    return value[:300]


def is_raw(path: Path) -> bool:
    return path.suffix.lower() in RAW_EXTENSIONS


def download_url(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=180) as response:
        response.raise_for_status()
        with target.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    output.write(chunk)


def sanitize_file_name(value: str, fallback: str) -> str:
    name = Path(value or fallback).name.replace("\\", "_").replace("/", "_")
    return name or fallback


def download_source(source: dict[str, Any], index: int, target_dir: Path) -> Path:
    file_name = sanitize_file_name(
        str(source.get("originalName") or source.get("fileName") or source.get("storageKey") or f"source_{index}"),
        f"source_{index}",
    )
    target = target_dir / f"{index:04d}_{file_name}"
    url = str(source.get("downloadUrl") or "").strip()
    if not url:
        raise RuntimeError(f"Source {file_name} does not include a download URL.")
    download_url(url, target)
    return target


def build_rawtherapee_profile(mode: str, resize_long_edge: int = HDR_LONG_EDGE) -> str:
    setting = "Camera" if mode == "camera" else mode
    return "\n".join(
        [
            "[Exposure]",
            "Auto=false",
            "HistogramMatching=true",
            "",
            "[HLRecovery]",
            "Enabled=true",
            "Method=Coloropp",
            "",
            "[LensProfile]",
            "LcMode=lfauto",
            "UseDistortion=true",
            "UseVignette=true",
            "UseCA=true",
            "",
            "[RAW]",
            "CA=true",
            "",
            "[White Balance]",
            "Enabled=true",
            f"Setting={setting}",
            "Temperature=5000",
            "Green=1",
            "Equal=1",
            "TemperatureBias=0",
            "StandardObserver=TWO_DEGREES",
            "Itcwb_green=0",
            "Itcwb_rangegreen=1",
            "Itcwb_nopurple=false",
            "Itcwb_alg=false",
            "Itcwb_prim=beta",
            "Itcwb_sampling=false",
            "CompatibilityVersion=2",
            "",
            "[Color Management]",
            "InputProfile=(cameraICC)",
            "ToneCurve=true",
            "ApplyLookTable=true",
            "ApplyBaselineExposureOffset=true",
            "ApplyHueSatMap=true",
            "DCPIlluminant=0",
            "WorkingProfile=ProPhoto",
            "OutputProfile=RT_sRGB",
            "OutputProfileIntent=Relative",
            "OutputBPC=true",
            "",
            "[RAW Preprocess WB]",
            "Mode=1",
            "",
            "[Resize]",
            "Enabled=true",
            "Scale=1",
            "AppliesTo=Cropped area",
            "Method=Lanczos",
            "DataSpecified=3",
            f"Width={resize_long_edge}",
            f"Height={resize_long_edge}",
            "AllowUpscaling=false",
            "",
        ]
    )


def render_raw_to_jpeg(source: Path, destination: Path, quality: int, mode: str, resize_long_edge: int = HDR_LONG_EDGE) -> None:
    rawtherapee = TOOLS["rawtherapee"]
    if not rawtherapee:
        raise RuntimeError("rawtherapee-cli is not available in the worker image.")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="metrovan-rt-") as temp_root:
        temp_dir = Path(temp_root)
        profile = temp_dir / "render.pp3"
        rendered = temp_dir / "rendered.jpg"
        profile.write_text(build_rawtherapee_profile(mode, resize_long_edge), encoding="utf-8")
        result = run_process(
            rawtherapee,
            ["-q", "-Y", "-d", "-p", str(profile), "-o", str(rendered), f"-j{quality}", "-c", str(source)],
            temp_dir,
            timeout=420,
        )
        if result.returncode != 0 or not rendered.exists():
            raise RuntimeError(f"rawtherapee conversion failed: {trim_error(result.stderr or result.stdout)}")
        shutil.copyfile(rendered, destination)


def resize_with_pillow(source: Path, destination: Path, quality: int, long_edge: int | None = None) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(source).convert("RGB")
    if long_edge and max(image.size) > long_edge:
        scale = long_edge / float(max(image.size))
        new_size = (max(1, round(image.size[0] * scale)), max(1, round(image.size[1] * scale)))
        image = image.resize(new_size, Image.Resampling.LANCZOS)
    image.save(destination, quality=max(1, min(100, quality)), subsampling=0, optimize=True)


def convert_to_jpeg(source: Path, destination: Path, quality: int, long_edge: int | None = None) -> None:
    if is_raw(source):
        render_raw_to_jpeg(source, destination, quality, "camera", long_edge or HDR_LONG_EDGE)
        return
    resize_with_pillow(source, destination, quality, long_edge)


def pick_reference(inputs: list[dict[str, Any]]) -> dict[str, Any]:
    with_exposure = [item for item in inputs if isinstance(item.get("exposureCompensation"), (int, float))]
    if with_exposure:
        return sorted(with_exposure, key=lambda item: abs(float(item.get("exposureCompensation") or 0)))[0]
    return inputs[len(inputs) // 2]


def load_rgb(path: Path) -> np.ndarray:
    image = Image.open(path).convert("RGB")
    return np.asarray(image, dtype=np.float32) / 255.0


def saturation(rgb: np.ndarray) -> np.ndarray:
    channel_max = rgb.max(axis=2)
    channel_min = rgb.min(axis=2)
    return (channel_max - channel_min) / np.maximum(channel_max, 1e-6)


def luminance(rgb: np.ndarray) -> np.ndarray:
    return 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]


def robust_channel_median(rgb: np.ndarray, mask: np.ndarray) -> tuple[float, float, float] | None:
    if np.count_nonzero(mask) < 500:
        return None
    values = rgb[mask]
    if values.size == 0:
        return None
    luma = luminance(values.reshape(-1, 1, 3)).reshape(-1)
    low, high = np.percentile(luma, [15, 85])
    trimmed = values[(luma >= low) & (luma <= high)]
    if trimmed.shape[0] < 300:
        trimmed = values
    medians = np.median(trimmed, axis=0)
    if not np.all(np.isfinite(medians)) or np.min(medians) <= 1e-4:
        return None
    return float(medians[0]), float(medians[1]), float(medians[2])


def compute_white_priority_gains(camera: np.ndarray) -> dict[str, float] | None:
    luma = luminance(camera)
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
    if np.count_nonzero(mask) < 1000:
        mask = (
            (luma > 0.24)
            & (luma < 0.96)
            & (sat < 0.3)
            & (channel_spread < 0.22)
            & (channel_max < 0.99)
            & (channel_min > 0.03)
        )
    medians = robust_channel_median(camera, mask)
    if medians is None:
        return None
    r_median, g_median, b_median = medians
    return {
        "r": max(0.7, min(1.5, g_median / max(r_median, 1e-6))),
        "g": 1.0,
        "b": max(0.7, min(1.5, g_median / max(b_median, 1e-6))),
    }


def estimate_rgb_gains(camera_path: Path, auto_path: Path) -> dict[str, float] | None:
    camera = load_rgb(camera_path)
    auto = load_rgb(auto_path)
    if camera.shape != auto.shape:
        auto_image = Image.fromarray(np.clip(auto * 255.0, 0, 255).astype(np.uint8), mode="RGB")
        auto_image = auto_image.resize((camera.shape[1], camera.shape[0]), Image.Resampling.BILINEAR)
        auto = np.asarray(auto_image, dtype=np.float32) / 255.0

    camera_luma = luminance(camera)
    auto_luma = luminance(auto)
    sat = np.minimum(saturation(camera), saturation(auto))
    mask = (
        (camera_luma > 0.08)
        & (camera_luma < 0.92)
        & (auto_luma > 0.08)
        & (auto_luma < 0.92)
        & (sat < 0.35)
    )
    if np.count_nonzero(mask) < 500:
        mask = (camera_luma > 0.05) & (camera_luma < 0.95) & (auto_luma > 0.05) & (auto_luma < 0.95)
    if np.count_nonzero(mask) == 0:
        mask = np.ones(camera.shape[:2], dtype=bool)

    ratios = auto / np.maximum(camera, 1e-4)
    channel_ratios: list[float] = []
    for channel_index in range(3):
        values = ratios[:, :, channel_index][mask]
        values = values[np.isfinite(values)]
        channel_ratios.append(float(np.median(values)) if values.size else 1.0)

    r_ratio, g_ratio, b_ratio = channel_ratios
    g_ratio = g_ratio if np.isfinite(g_ratio) and g_ratio > 1e-6 else 1.0
    auto_gains = {
        "r": max(0.7, min(1.5, r_ratio / g_ratio)),
        "g": 1.0,
        "b": max(0.7, min(1.5, b_ratio / g_ratio)),
    }
    white_gains = compute_white_priority_gains(camera)
    if not white_gains:
        return auto_gains
    return {
        "r": max(0.7, min(1.5, white_gains["r"] * 0.72 + auto_gains["r"] * 0.28)),
        "g": 1.0,
        "b": max(0.7, min(1.5, white_gains["b"] * 0.72 + auto_gains["b"] * 0.28)),
    }


def estimate_tone_adjustments(source_path: Path, target_path: Path, gains: dict[str, float] | None = None) -> dict[str, float] | None:
    source = load_rgb(source_path)
    target = load_rgb(target_path)
    if source.shape[:2] != target.shape[:2]:
        target_image = Image.fromarray(np.clip(target * 255.0, 0, 255).astype(np.uint8), mode="RGB")
        target_image = target_image.resize((source.shape[1], source.shape[0]), Image.Resampling.BILINEAR)
        target = np.asarray(target_image, dtype=np.float32) / 255.0

    if gains:
        source[:, :, 0] *= gains.get("r", 1.0)
        source[:, :, 1] *= gains.get("g", 1.0)
        source[:, :, 2] *= gains.get("b", 1.0)
        source = np.clip(source, 0.0, 1.0)

    source_luma = luminance(source)
    target_luma = luminance(target)
    mask = (source_luma > 0.02) & (source_luma < 0.98) & (target_luma > 0.05) & (target_luma < 0.95)
    if np.count_nonzero(mask) < 500:
        mask = np.ones(source_luma.shape, dtype=bool)

    source_vals = source_luma[mask]
    target_vals = target_luma[mask]
    source_p50 = float(np.percentile(source_vals, 50))
    source_p75 = float(np.percentile(source_vals, 75))
    target_p50 = max(float(np.percentile(target_vals, 50)), 0.28)
    target_p75 = max(float(np.percentile(target_vals, 75)), 0.5)

    delta_p50 = target_p50 - source_p50
    delta_p75 = target_p75 - source_p75
    exposure = 1.0 if source_p75 <= 1e-6 else max(0.9, min(1.25, target_p75 / source_p75))
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
    gamma = 1.0 if abs(x - 1.0) < 1e-6 else math.log(y) / math.log(x)
    gamma = max(0.9, min(1.25, gamma))
    if delta_p50 <= 0.015 and delta_p75 <= 0.02:
        gamma = 1.0
    elif source_p50 >= 0.52:
        gamma = min(gamma, 1.06)
    elif source_p50 >= 0.45:
        gamma = min(gamma, 1.12)
    if target_p75 <= source_p75 and target_p50 <= source_p50:
        gamma = min(gamma, 1.0)

    if max(abs(exposure - 1.0), abs(gamma - 1.0)) <= 0.01:
        return None
    return {"exposure": exposure, "gamma": gamma}


def apply_image_adjustments(
    source_path: Path,
    destination_path: Path,
    quality: int,
    gains: dict[str, float] | None = None,
    tone: dict[str, float] | None = None,
) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(source_path).convert("RGB")
    array = np.asarray(image, dtype=np.float32) / 255.0
    if gains:
        array[:, :, 0] *= gains.get("r", 1.0)
        array[:, :, 1] *= gains.get("g", 1.0)
        array[:, :, 2] *= gains.get("b", 1.0)
    if tone:
        array *= tone.get("exposure", 1.0)
        array = np.power(np.clip(array, 0.0, 1.0), tone.get("gamma", 1.0))
    array = np.clip(array, 0.0, 1.0)
    output = Image.fromarray(np.clip(array * 255.0, 0, 255).astype(np.uint8), mode="RGB")
    output.save(destination_path, quality=max(1, min(100, quality)), subsampling=0, optimize=True)


def prepare_inputs(exposures: list[dict[str, Any]], source_paths: dict[str, Path], work_dir: Path) -> tuple[list[Path], dict[str, Any], Path | None]:
    inputs_dir = work_dir / "prepared"
    inputs_dir.mkdir(parents=True, exist_ok=True)
    reference = pick_reference(exposures)
    prepared: list[Path] = []
    reference_prepared: Path | None = None

    for index, exposure in enumerate(exposures, start=1):
        source = source_paths[str(exposure.get("id"))]
        prepared_path = inputs_dir / f"{index:04d}_{source.stem}.jpg"
        if is_raw(source):
            render_raw_to_jpeg(source, prepared_path, 95, "camera", HDR_LONG_EDGE)
        else:
            convert_to_jpeg(source, prepared_path, 95, HDR_LONG_EDGE)
        if exposure is reference:
            reference_prepared = prepared_path
        prepared.append(prepared_path)

    return prepared, reference, reference_prepared


def estimate_group_gains(reference: dict[str, Any], source_paths: dict[str, Path], reference_prepared: Path, work_dir: Path) -> dict[str, float] | None:
    source = source_paths[str(reference.get("id"))]
    if not is_raw(source):
        return None
    auto_path = work_dir / "reference-auto.jpg"
    render_raw_to_jpeg(source, auto_path, 95, "autold", HDR_LONG_EDGE)
    return estimate_rgb_gains(reference_prepared, auto_path)


def apply_group_gains(prepared: list[Path], gains: dict[str, float], work_dir: Path) -> list[Path]:
    adjusted_dir = work_dir / "wb-prepared"
    adjusted_dir.mkdir(parents=True, exist_ok=True)
    adjusted: list[Path] = []
    for index, source in enumerate(prepared, start=1):
        target = adjusted_dir / f"{index:04d}_wb.jpg"
        apply_image_adjustments(source, target, 95, gains, None)
        adjusted.append(target)
    return adjusted


def align_and_fuse(prepared: list[Path], output_path: Path, work_dir: Path, tone_target: Path | None, gains: dict[str, float] | None) -> None:
    align_tool = TOOLS["align"]
    enfuse_tool = TOOLS["enfuse"]
    if not align_tool or not enfuse_tool:
        raise RuntimeError("HDR alignment tools are missing: align_image_stack / enfuse.")

    aligned_dir = work_dir / "aligned"
    aligned_dir.mkdir(parents=True, exist_ok=True)
    result = run_process(
        align_tool,
        ["-a", "aligned_", "-c", "12", "-g", "6", "-t", "2.0", "-s", "0", *[str(path) for path in prepared]],
        aligned_dir,
        timeout=240,
    )
    if result.returncode != 0:
        raise RuntimeError(f"align_image_stack failed: {trim_error(result.stderr or result.stdout)}")

    aligned = sorted(aligned_dir.glob("aligned_*.tif"))
    if len(aligned) < 2:
        raise RuntimeError("align_image_stack did not output enough aligned TIFF files.")

    fused_tif = work_dir / "fused.tif"
    result = run_process(enfuse_tool, ["-o", str(fused_tif), *[str(path) for path in aligned]], work_dir, timeout=240)
    if result.returncode != 0 or not fused_tif.exists():
        raise RuntimeError(f"enfuse failed: {trim_error(result.stderr or result.stdout)}")

    tone = estimate_tone_adjustments(fused_tif, tone_target, None) if tone_target and tone_target.exists() else None
    apply_image_adjustments(fused_tif, output_path, 95, gains, tone)


def process_default(input_payload: dict[str, Any], output_path: Path) -> None:
    exposures = input_payload.get("exposures")
    if not isinstance(exposures, list) or not exposures:
        raise RuntimeError("Job is missing exposures.")

    with tempfile.TemporaryDirectory(prefix="metrovan-process-") as temp_root:
        work_dir = Path(temp_root)
        sources_dir = work_dir / "sources"
        source_paths: dict[str, Path] = {}
        normalized_exposures: list[dict[str, Any]] = []
        for index, exposure in enumerate(exposures, start=1):
            if not isinstance(exposure, dict):
                continue
            source_path = download_source(exposure, index, sources_dir)
            source_id = str(exposure.get("id") or index)
            exposure["id"] = source_id
            source_paths[source_id] = source_path
            normalized_exposures.append(exposure)

        if not normalized_exposures:
            raise RuntimeError("No valid exposures were downloaded.")

        if len(normalized_exposures) == 1:
            exposure = normalized_exposures[0]
            source = source_paths[str(exposure.get("id"))]
            if is_raw(source):
                camera = work_dir / "single-camera.jpg"
                auto = work_dir / "single-auto.jpg"
                render_raw_to_jpeg(source, camera, 95, "camera", HDR_LONG_EDGE)
                render_raw_to_jpeg(source, auto, 95, "autold", HDR_LONG_EDGE)
                gains = estimate_rgb_gains(camera, auto)
                tone = estimate_tone_adjustments(camera, auto, gains)
                apply_image_adjustments(camera, output_path, 95, gains, tone)
            else:
                convert_to_jpeg(source, output_path, 95, HDR_LONG_EDGE)
            return

        prepared, reference, reference_prepared = prepare_inputs(normalized_exposures, source_paths, work_dir)
        gains = estimate_group_gains(reference, source_paths, reference_prepared, work_dir) if reference_prepared else None
        prepared_for_align = apply_group_gains(prepared, gains, work_dir) if gains else prepared

        tone_target = None
        reference_source = source_paths[str(reference.get("id"))]
        if is_raw(reference_source):
            tone_target = work_dir / "reference-auto-tone.jpg"
            render_raw_to_jpeg(reference_source, tone_target, 95, "autold", HDR_LONG_EDGE)

        align_and_fuse(prepared_for_align, output_path, work_dir, tone_target, None)


def process_regenerate(input_payload: dict[str, Any], output_path: Path) -> None:
    source = input_payload.get("sourceImage")
    if not isinstance(source, dict):
        raise RuntimeError("Regeneration job is missing sourceImage.")
    with tempfile.TemporaryDirectory(prefix="metrovan-regenerate-") as temp_root:
        source_path = download_source(source, 1, Path(temp_root))
        # Color-card regeneration can be replaced by a model command later. The default
        # path preserves the image and writes a clean JPEG so the cloud contract works.
        convert_to_jpeg(source_path, output_path, 95, None)


def main() -> int:
    input_json = Path(os.environ["METROVAN_INPUT_JSON"])
    output_path = Path(os.environ["METROVAN_OUTPUT_PATH"])
    payload = json.loads(input_json.read_text(encoding="utf-8"))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    mode = str(payload.get("workflowMode") or "default")
    if mode == "regenerate":
        process_regenerate(payload, output_path)
    else:
        process_default(payload, output_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
