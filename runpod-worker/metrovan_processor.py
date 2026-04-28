import json
import math
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import numpy as np
import requests
from PIL import Image

try:
    import cv2
except ImportError:  # pragma: no cover - checked at runtime in worker images
    cv2 = None

try:
    import lensfunpy
except ImportError:  # pragma: no cover - checked at runtime in worker images
    lensfunpy = None

try:
    import rawpy
except ImportError:  # pragma: no cover - checked at runtime in worker images
    rawpy = None


RAW_EXTENSIONS = {
    ".arw",
    ".cr2",
    ".cr3",
    ".crw",
    ".nef",
    ".nrw",
    ".raf",
    ".dng",
    ".rw2",
    ".rwl",
    ".orf",
    ".srw",
    ".3fr",
    ".fff",
    ".iiq",
    ".pef",
    ".erf",
}
JPEG_EXTENSIONS = {".jpg", ".jpeg"}
HDR_LONG_EDGE = 3000
RAW_WB_SEARCH_LONG_EDGE = 900
RAW_PREVIEW_FALLBACK_ENV = "METROVAN_ALLOW_RAW_PREVIEW_FALLBACK"
RAW_WB_GAIN_MIN = 0.7
RAW_WB_GAIN_MAX = 1.5
RAWPY_BRIGHT_ENV = "METROVAN_RAWPY_BRIGHT"
RAWPY_HDR_BRIGHT_ENV = "METROVAN_RAWPY_HDR_BRIGHT"
RAWPY_AUTO_WB_BLEND_ENV = "METROVAN_RAWPY_AUTO_WB_BLEND"


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def env_enabled(name: str, default: str = "false") -> bool:
    return env(name, default).lower() in {"1", "true", "yes", "on"}


def env_float(name: str, default: float, min_value: float, max_value: float) -> float:
    try:
        value = float(env(name, str(default)))
    except ValueError:
        value = default
    if not np.isfinite(value):
        value = default
    return max(min_value, min(max_value, value))


ACR_LCP_CACHE_DIR = Path(env("METROVAN_ACR_LCP_CACHE_DIR", "/tmp/metrovan-acr-lcp"))
ACR_LCP_ZIP_MARKER = ACR_LCP_CACHE_DIR / ".ready"
_LCP_PROFILE_CACHE: list[dict[str, Any]] | None = None
_LENSFUN_DB: Any | None = None


COMMON_TOOL_PATHS = {
    "METROVAN_ALIGN_IMAGE_STACK": [
        "C:/Program Files/Hugin/bin/align_image_stack.exe",
        "C:/Program Files (x86)/Hugin/bin/align_image_stack.exe",
    ],
    "METROVAN_ENFUSE": [
        "C:/Program Files/Hugin/bin/enfuse.exe",
        "C:/Program Files (x86)/Hugin/bin/enfuse.exe",
    ],
}


def find_tool(env_name: str, names: list[str]) -> str:
    configured = env(env_name)
    if configured and Path(configured).exists():
        return configured
    for candidate in COMMON_TOOL_PATHS.get(env_name, []):
        if Path(candidate).exists():
            return candidate
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


def split_path_list(value: str) -> list[str]:
    if not value:
        return []
    separator = ";" if ";" in value else os.pathsep
    return [item.strip() for item in value.split(separator) if item.strip()]


def normalize_lens_text(value: Any) -> str:
    text = str(value or "").lower().replace("contemporary", "c").replace("|", " ")
    return " ".join(re.findall(r"[a-z0-9.]+", text))


def text_tokens(value: Any) -> set[str]:
    tokens = set(normalize_lens_text(value).split())
    expanded: set[str] = set()
    for token in tokens:
        compact = token.replace(".", "")
        expanded.add(token)
        expanded.add(compact)
    return {token for token in expanded if token}


def parse_number(value: Any) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", str(value or ""))
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def read_raw_lens_metadata(source: Path) -> dict[str, Any]:
    exiftool = TOOLS["exiftool"]
    if not exiftool:
        return {}

    result = run_process(
        exiftool,
        ["-j", "-Make", "-Model", "-LensModel", "-LensID", "-LensInfo", "-FocalLength", "-FNumber", str(source)],
        source.parent,
        timeout=60,
    )
    if result.returncode != 0:
        return {}

    try:
        rows = json.loads(result.stdout or "[]")
    except json.JSONDecodeError:
        return {}
    return rows[0] if isinstance(rows, list) and rows and isinstance(rows[0], dict) else {}


def ensure_acr_lcp_zip() -> Path | None:
    url = env("METROVAN_ACR_LCP_ZIP_URL")
    s3_config = get_acr_lcp_s3_config()
    if not url and not s3_config:
        print("ACR lens profiles not configured; continuing without external lens profile package.", flush=True)
        return None
    if ACR_LCP_ZIP_MARKER.exists():
        return ACR_LCP_CACHE_DIR

    ACR_LCP_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = ACR_LCP_CACHE_DIR / "profiles.zip"
    if url:
        print("Downloading ACR lens profiles from configured URL.", flush=True)
        download_url(url, zip_path)
    elif s3_config:
        download_s3_object(s3_config, zip_path)
    extract_zip_safe(zip_path, ACR_LCP_CACHE_DIR)
    try:
        zip_path.unlink()
    except OSError:
        pass
    ACR_LCP_ZIP_MARKER.write_text("ready", encoding="utf-8")
    print(f"ACR lens profiles ready: {ACR_LCP_CACHE_DIR}", flush=True)
    return ACR_LCP_CACHE_DIR


def get_acr_lcp_s3_config() -> dict[str, str] | None:
    key = env("METROVAN_ACR_LCP_S3_KEY") or env("METROVAN_ACR_LCP_OBJECT_KEY") or "system/acr-lens-profiles.zip"
    if not key:
        return None

    endpoint = env("METROVAN_ACR_LCP_S3_ENDPOINT") or env("METROVAN_R2_ENDPOINT") or env("METROVAN_OBJECT_STORAGE_ENDPOINT")
    bucket = env("METROVAN_ACR_LCP_S3_BUCKET") or env("METROVAN_R2_BUCKET") or env("METROVAN_OBJECT_STORAGE_BUCKET")
    access_key_id = (
        env("METROVAN_ACR_LCP_S3_ACCESS_KEY_ID")
        or env("METROVAN_R2_ACCESS_KEY_ID")
        or env("METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID")
    )
    secret_access_key = (
        env("METROVAN_ACR_LCP_S3_SECRET_ACCESS_KEY")
        or env("METROVAN_R2_SECRET_ACCESS_KEY")
        or env("METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY")
    )
    region = env("METROVAN_ACR_LCP_S3_REGION") or env("METROVAN_R2_REGION") or env("METROVAN_OBJECT_STORAGE_REGION", "auto")
    if not endpoint or not bucket or not access_key_id or not secret_access_key:
        return None

    return {
        "endpoint": endpoint.rstrip("/"),
        "bucket": bucket,
        "key": key.lstrip("/"),
        "access_key_id": access_key_id,
        "secret_access_key": secret_access_key,
        "region": region,
    }


def get_storage_s3_config(storage_key: str) -> dict[str, str] | None:
    if not storage_key:
        return None

    endpoint = env("METROVAN_R2_ENDPOINT") or env("METROVAN_OBJECT_STORAGE_ENDPOINT")
    bucket = env("METROVAN_R2_BUCKET") or env("METROVAN_OBJECT_STORAGE_BUCKET")
    access_key_id = env("METROVAN_R2_ACCESS_KEY_ID") or env("METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID")
    secret_access_key = env("METROVAN_R2_SECRET_ACCESS_KEY") or env("METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY")
    region = env("METROVAN_R2_REGION") or env("METROVAN_OBJECT_STORAGE_REGION", "auto")
    if not endpoint or not bucket or not access_key_id or not secret_access_key:
        return None

    return {
        "endpoint": endpoint.rstrip("/"),
        "bucket": bucket,
        "key": storage_key.lstrip("/"),
        "access_key_id": access_key_id,
        "secret_access_key": secret_access_key,
        "region": region,
    }


def download_s3_object(config: dict[str, str], target: Path) -> None:
    try:
        import boto3
        from botocore.config import Config
    except ImportError as error:
        raise RuntimeError("boto3 is required to download private object storage files.") from error

    target.parent.mkdir(parents=True, exist_ok=True)
    client = boto3.client(
        "s3",
        endpoint_url=config["endpoint"],
        aws_access_key_id=config["access_key_id"],
        aws_secret_access_key=config["secret_access_key"],
        region_name=config["region"],
        config=Config(signature_version="s3v4", retries={"max_attempts": 3, "mode": "standard"}),
    )
    print(f"Downloading ACR lens profiles from object storage: {config['bucket']}/{config['key']}", flush=True)
    client.download_file(config["bucket"], config["key"], str(target))


def extract_zip_safe(zip_path: Path, destination: Path) -> None:
    destination_root = destination.resolve()
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            target = (destination / member.filename).resolve()
            if destination_root != target and destination_root not in target.parents:
                raise RuntimeError(f"Unsafe path in ACR lens profile archive: {member.filename}")
        archive.extractall(destination)


def get_acr_lcp_roots() -> list[Path]:
    roots = [Path(entry) for entry in split_path_list(env("METROVAN_ACR_LCP_DIR"))]
    extracted = ensure_acr_lcp_zip()
    if extracted:
        roots.append(extracted)
    roots.extend(
        [
            Path("/opt/metrovan/lcp-profiles"),
            Path("/opt/metrovan/acr-lcp"),
            Path("/usr/share/lensprofiles"),
            Path("C:/ProgramData/Adobe/CameraRaw/LensProfiles/1.0"),
        ]
    )

    unique: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        if not root.exists():
            continue
        try:
            key = str(root.resolve())
        except OSError:
            key = str(root)
        if key in seen:
            continue
        seen.add(key)
        unique.append(root)
    return unique


def parse_lcp_profile(profile_path: Path) -> dict[str, Any] | None:
    try:
        text = profile_path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None

    def attr(name: str) -> str:
        match = re.search(rf'stCamera:{name}="([^"]*)"', text)
        return match.group(1) if match else ""

    focals = [float(value) for value in re.findall(r'stCamera:FocalLength="(\d+(?:\.\d+)?)"', text)]
    make = attr("Make")
    lens = attr("Lens")
    lens_pretty = attr("LensPrettyName")
    profile_name = attr("ProfileName")
    search_text = " ".join([profile_path.stem, make, lens, lens_pretty, profile_name])
    return {
        "path": profile_path,
        "make": normalize_lens_text(make),
        "tokens": text_tokens(search_text),
        "focals": focals,
    }


def load_lcp_profiles() -> list[dict[str, Any]]:
    global _LCP_PROFILE_CACHE
    if _LCP_PROFILE_CACHE is not None:
        return _LCP_PROFILE_CACHE

    profiles: list[dict[str, Any]] = []
    roots = get_acr_lcp_roots()
    for root in roots:
        for profile_path in root.rglob("*.lcp"):
            parsed = parse_lcp_profile(profile_path)
            if parsed:
                profiles.append(parsed)

    _LCP_PROFILE_CACHE = profiles
    root_list = ", ".join(str(root) for root in roots) or "none"
    print(f"Loaded {len(profiles)} ACR LCP profiles from: {root_list}", flush=True)
    return profiles


def find_acr_lcp_profile(source: Path) -> Path | None:
    metadata = read_raw_lens_metadata(source)
    lens_text = " ".join(str(metadata.get(key) or "") for key in ("LensModel", "LensID", "LensInfo"))
    lens_tokens = text_tokens(lens_text)
    if not lens_tokens:
        print(f"No lens metadata found for ACR profile matching: {source.name}", flush=True)
        return None

    make = normalize_lens_text(metadata.get("Make"))
    focal = parse_number(metadata.get("FocalLength"))
    best_profile: dict[str, Any] | None = None
    best_score = 0.0
    for profile in load_lcp_profiles():
        if make and profile["make"] and make not in profile["make"] and profile["make"] not in make:
            continue

        overlap = lens_tokens.intersection(profile["tokens"])
        score = float(len(overlap) * 10)
        if focal is not None and profile["focals"]:
            min_focal = min(profile["focals"])
            max_focal = max(profile["focals"])
            if min_focal - 0.25 <= focal <= max_focal + 0.25:
                score += 25
            else:
                score -= min(abs(focal - min_focal), abs(focal - max_focal))

        if score > best_score:
            best_score = score
            best_profile = profile

    if best_profile and best_score >= 35:
        print(
            f"Matched ACR lens profile for {source.name}: {best_profile['path'].name} "
            f"(score={best_score:.1f}, lens='{lens_text.strip()}', focal={focal})",
            flush=True,
        )
        return best_profile["path"]

    best_name = best_profile["path"].name if best_profile else "none"
    print(
        f"No ACR lens profile match for {source.name}: best={best_name} "
        f"score={best_score:.1f}, lens='{lens_text.strip()}', focal={focal}, profiles={len(load_lcp_profiles())}",
        flush=True,
    )
    return None


def get_lensfun_db() -> Any | None:
    global _LENSFUN_DB
    if lensfunpy is None:
        return None
    if _LENSFUN_DB is None:
        _LENSFUN_DB = lensfunpy.Database()
    return _LENSFUN_DB


def lens_text_variants(value: Any, make: str = "") -> list[str]:
    text = " ".join(str(value or "").replace("/", " ").split())
    if not text:
        return []

    variants: list[str] = []

    def add(candidate: str) -> None:
        candidate = " ".join(candidate.split())
        if candidate and candidate not in variants:
            variants.append(candidate)

    add(text)
    add(re.sub(r"\b(RF|EF|EF-S|EF-M)(?=\d)", r"\1 ", text))
    add(text.replace(" F4 L", " F4L").replace(" F2.8 L", " F2.8L"))
    add(re.sub(r"\bf/(\d+(?:\.\d+)?)\b", r"F\1", text, flags=re.IGNORECASE))

    if make and not text.lower().startswith(make.lower()):
        for candidate in list(variants):
            add(f"{make} {candidate}")

    return variants


def lensfun_lens_score(lens: Any, query: str, focal: float | None, make: str) -> float:
    lens_model = str(getattr(lens, "model", ""))
    lens_make = str(getattr(lens, "maker", ""))
    score = float(getattr(lens, "score", 0) or 0) * 0.1
    lens_tokens = text_tokens(lens_model)
    query_tokens = text_tokens(query)
    score += len(lens_tokens.intersection(query_tokens)) * 8.0
    if normalize_lens_text(query) == normalize_lens_text(lens_model):
        score += 80.0
    if make and normalize_lens_text(make) in normalize_lens_text(lens_make):
        score += 15.0
    if focal is not None:
        min_focal = getattr(lens, "min_focal", None)
        max_focal = getattr(lens, "max_focal", None)
        if min_focal and max_focal and float(min_focal) - 0.25 <= focal <= float(max_focal) + 0.25:
            score += 25.0
    return score


def find_lensfun_camera_and_lens(metadata: dict[str, Any]) -> tuple[Any, Any, float, float] | None:
    db = get_lensfun_db()
    if db is None:
        print("Lens correction skipped: lensfunpy is not available.", flush=True)
        return None

    make = str(metadata.get("Make") or "").strip()
    model = str(metadata.get("Model") or "").strip()
    focal = parse_number(metadata.get("FocalLength"))
    aperture = parse_number(metadata.get("FNumber")) or 8.0
    if not make or not model or focal is None:
        return None

    cameras = db.find_cameras(make, model, loose_search=False) or db.find_cameras(make, model, loose_search=True)
    if not cameras:
        print(f"Lens correction skipped: no Lensfun camera match for {make} {model}.", flush=True)
        return None

    camera = cameras[0]
    queries: list[str] = []
    for key in ("LensID", "LensModel", "LensInfo"):
        for variant in lens_text_variants(metadata.get(key), make):
            if variant not in queries:
                queries.append(variant)

    best_lens: Any | None = None
    best_score = 0.0
    best_query = ""
    for query in queries:
        candidates = db.find_lenses(camera, lens=query, loose_search=False) or db.find_lenses(camera, lens=query, loose_search=True)
        for lens in candidates:
            score = lensfun_lens_score(lens, query, focal, make)
            if score > best_score:
                best_lens = lens
                best_score = score
                best_query = query

    if best_lens is None:
        lens_text = " / ".join(str(metadata.get(key) or "") for key in ("LensID", "LensModel", "LensInfo"))
        print(f"Lens correction skipped: no Lensfun lens match for {lens_text}.", flush=True)
        return None

    print(
        "Lensfun correction matched "
        f"{getattr(camera, 'maker', make)} {getattr(camera, 'model', model)} + {getattr(best_lens, 'model', best_query)} "
        f"at {focal:g}mm f/{aperture:g}",
        flush=True,
    )
    return camera, best_lens, float(focal), float(aperture)


def apply_lensfun_correction(image: Image.Image, source: Path) -> Image.Image:
    if lensfunpy is None or cv2 is None:
        print("Lens correction skipped: lensfunpy/opencv is not available.", flush=True)
        return image

    metadata = read_raw_lens_metadata(source)
    match = find_lensfun_camera_and_lens(metadata)
    if match is None:
        return image

    camera, lens, focal, aperture = match
    width, height = image.size
    modifier = lensfunpy.Modifier(lens, float(getattr(camera, "crop_factor", 1.0) or 1.0), width, height)
    modifier.initialize(
        focal,
        aperture,
        distance=1000.0,
        pixel_format=np.float32,
        flags=lensfunpy.ModifyFlags.ALL,
    )

    array = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    color_changed = bool(modifier.apply_color_modification(array))

    coords = modifier.apply_subpixel_geometry_distortion()
    geometry_changed = coords is not None
    if coords is not None:
        channels = []
        for channel_index in range(3):
            channel_coords = coords[:, :, channel_index, :]
            channels.append(
                cv2.remap(
                    array[:, :, channel_index],
                    channel_coords[:, :, 0].astype(np.float32),
                    channel_coords[:, :, 1].astype(np.float32),
                    interpolation=cv2.INTER_LANCZOS4,
                    borderMode=cv2.BORDER_REPLICATE,
                )
            )
        array = np.stack(channels, axis=2)
    else:
        coords = modifier.apply_geometry_distortion()
        geometry_changed = coords is not None
        if coords is not None:
            array = cv2.remap(
                array,
                coords[:, :, 0].astype(np.float32),
                coords[:, :, 1].astype(np.float32),
                interpolation=cv2.INTER_LANCZOS4,
                borderMode=cv2.BORDER_REPLICATE,
            )

    if not geometry_changed and not color_changed:
        print(f"Lens correction skipped: profile has no usable correction data for {source.name}.", flush=True)
        return image

    return Image.fromarray(np.clip(array * 255.0, 0, 255).astype(np.uint8), mode="RGB")


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
        storage_key = str(source.get("storageKey") or "").strip()
        s3_config = get_storage_s3_config(storage_key)
        if s3_config:
            download_s3_object(s3_config, target)
            return target
        raise RuntimeError(f"Source {file_name} does not include a download URL or storage key.")
    download_url(url, target)
    return target


def require_rawpy() -> None:
    if rawpy is None:
        raise RuntimeError("rawpy/libraw is required for RAW-stage white balance rendering.")


def normalize_raw_user_wb(values: Any) -> list[float]:
    array = np.asarray(values, dtype=np.float32).reshape(-1)
    if array.size < 4 or not np.all(np.isfinite(array[:4])) or np.min(array[:4]) <= 0:
        array = np.asarray([1.0, 1.0, 1.0, 1.0], dtype=np.float32)
    else:
        array = array[:4]
    green = float((array[1] + array[3]) / 2.0) if array[3] > 0 else float(array[1])
    if not np.isfinite(green) or green <= 0:
        green = 1.0
    normalized = np.clip(array / green, 0.2, 8.0)
    return [float(value) for value in normalized]


def resize_rgb_array(rgb: np.ndarray, long_edge: int | None = None) -> Image.Image:
    image = Image.fromarray(np.asarray(rgb, dtype=np.uint8), mode="RGB")
    if long_edge and max(image.size) > long_edge:
        scale = long_edge / float(max(image.size))
        size = (max(1, round(image.size[0] * scale)), max(1, round(image.size[1] * scale)))
        image = image.resize(size, Image.Resampling.LANCZOS)
    return image


def postprocess_raw_to_rgb(
    source: Path,
    raw_user_wb: list[float] | None = None,
    half_size: bool = False,
    auto_wb: bool = False,
    bright: float | None = None,
) -> np.ndarray:
    require_rawpy()
    with rawpy.imread(str(source)) as raw:
        options: dict[str, Any] = {
            "output_color": rawpy.ColorSpace.sRGB,
            "output_bps": 8,
            "no_auto_bright": True,
            "bright": bright if bright is not None else env_float(RAWPY_BRIGHT_ENV, 16.0, 1.0, 32.0),
            "gamma": (2.222, 4.5),
            "highlight_mode": rawpy.HighlightMode.Blend,
            "use_auto_wb": auto_wb,
            "use_camera_wb": raw_user_wb is None and not auto_wb,
            "half_size": half_size,
        }
        if raw_user_wb is not None:
            options["user_wb"] = raw_user_wb
        return raw.postprocess(**options)


def get_camera_user_wb(source: Path) -> list[float]:
    require_rawpy()
    with rawpy.imread(str(source)) as raw:
        return normalize_raw_user_wb(raw.camera_whitebalance)


def rawpy_decode_bright(hdr_input: bool = False) -> float:
    if hdr_input:
        return env_float(RAWPY_HDR_BRIGHT_ENV, 6.0, 1.0, 32.0)
    return env_float(RAWPY_BRIGHT_ENV, 16.0, 1.0, 32.0)


def estimate_raw_rgb_grey_user_wb(source: Path, hdr_input: bool = False) -> list[float] | None:
    bright = rawpy_decode_bright(hdr_input)
    camera_preview = postprocess_raw_to_rgb(source, None, half_size=True, bright=bright)
    preview_image = resize_rgb_array(camera_preview, RAW_WB_SEARCH_LONG_EDGE)
    preview = np.asarray(preview_image, dtype=np.float32) / 255.0
    auto_preview = postprocess_raw_to_rgb(source, None, half_size=True, auto_wb=True, bright=bright)
    auto_image = resize_rgb_array(auto_preview, RAW_WB_SEARCH_LONG_EDGE)
    auto = np.asarray(auto_image, dtype=np.float32) / 255.0

    auto_gains = estimate_rgb_gains_from_arrays(preview, auto, blend_with_white=False)
    white_gains = compute_white_priority_gains(preview)
    if not auto_gains and not white_gains:
        print(f"RAW RGB grey WB kept camera white balance for {source.name}: no neutral sample.", flush=True)
        return None
    if auto_gains and white_gains:
        auto_blend = env_float(RAWPY_AUTO_WB_BLEND_ENV, 0.65, 0.0, 1.0)
        gains = {
            "r": max(RAW_WB_GAIN_MIN, min(RAW_WB_GAIN_MAX, white_gains["r"] * (1.0 - auto_blend) + auto_gains["r"] * auto_blend)),
            "g": 1.0,
            "b": max(RAW_WB_GAIN_MIN, min(RAW_WB_GAIN_MAX, white_gains["b"] * (1.0 - auto_blend) + auto_gains["b"] * auto_blend)),
        }
    else:
        gains = auto_gains or white_gains

    camera_wb = get_camera_user_wb(source)
    user_wb = normalize_raw_user_wb(
        [
            camera_wb[0] * gains.get("r", 1.0),
            camera_wb[1] * gains.get("g", 1.0),
            camera_wb[2] * gains.get("b", 1.0),
            camera_wb[3] * gains.get("g", 1.0),
        ]
    )
    print(
        "RAW-stage RGB grey WB selected for "
        f"{source.name}: gains R={gains.get('r', 1.0):.4f} B={gains.get('b', 1.0):.4f} "
        f"user_wb=[{user_wb[0]:.4f}, {user_wb[1]:.4f}, {user_wb[2]:.4f}, {user_wb[3]:.4f}]",
        flush=True,
    )
    return user_wb


def render_raw_to_jpeg(
    source: Path,
    destination: Path,
    quality: int,
    raw_user_wb: list[float] | None = None,
    resize_long_edge: int = HDR_LONG_EDGE,
    hdr_input: bool = False,
) -> None:
    if isinstance(raw_user_wb, str):
        if raw_user_wb != "camera":
            raise RuntimeError("Legacy RAW white-balance profile modes are no longer supported.")
        raw_user_wb = None

    destination.parent.mkdir(parents=True, exist_ok=True)
    rgb = postprocess_raw_to_rgb(source, raw_user_wb, half_size=False, bright=rawpy_decode_bright(hdr_input))
    image = resize_rgb_array(rgb, resize_long_edge)
    image = apply_lensfun_correction(image, source)
    image.save(destination, quality=max(1, min(100, quality)), subsampling=0, optimize=True)


def extract_raw_preview_to_jpeg(source: Path, destination: Path, quality: int, resize_long_edge: int | None = None) -> bool:
    exiftool = TOOLS["exiftool"]
    if not exiftool:
        return False

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="metrovan-raw-preview-") as temp_root:
        temp_dir = Path(temp_root)
        embedded = temp_dir / "embedded.jpg"
        for tag in ("JpgFromRaw", "PreviewImage"):
            with embedded.open("wb") as output:
                result = subprocess.run(
                    [exiftool, "-b", f"-{tag}", str(source)],
                    stdout=output,
                    stderr=subprocess.PIPE,
                    check=False,
                )
            if result.returncode == 0 and embedded.exists() and embedded.stat().st_size > 0:
                resize_with_pillow(embedded, destination, quality, resize_long_edge)
                return True
    return False


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
        raw_user_wb = estimate_raw_rgb_grey_user_wb(source)
        render_raw_to_jpeg(source, destination, quality, raw_user_wb, long_edge or HDR_LONG_EDGE)
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


def estimate_rgb_gains_from_arrays(
    camera: np.ndarray,
    auto: np.ndarray,
    blend_with_white: bool = True,
) -> dict[str, float] | None:
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
    if not white_gains or not blend_with_white:
        return auto_gains
    return {
        "r": max(0.7, min(1.5, white_gains["r"] * 0.72 + auto_gains["r"] * 0.28)),
        "g": 1.0,
        "b": max(0.7, min(1.5, white_gains["b"] * 0.72 + auto_gains["b"] * 0.28)),
    }


def estimate_rgb_gains(camera_path: Path, auto_path: Path) -> dict[str, float] | None:
    return estimate_rgb_gains_from_arrays(load_rgb(camera_path), load_rgb(auto_path))


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


def apply_hdr_tone_adjustments(source_path: Path, destination_path: Path, quality: int) -> None:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    image = Image.open(source_path).convert("RGB")
    array = np.asarray(image, dtype=np.float32) / 255.0
    luma = luminance(array)
    midtone = max(float(np.percentile(luma, 50)), 1e-4)
    target_midtone = 0.35
    gamma = 1.0
    if midtone < target_midtone:
        gamma = math.log(target_midtone) / math.log(midtone)
        gamma = max(0.62, min(0.95, gamma))
    array = np.power(np.clip(array, 0.0, 1.0), gamma)
    output = Image.fromarray(np.clip(array * 255.0, 0, 255).astype(np.uint8), mode="RGB")
    output.save(destination_path, quality=max(1, min(100, quality)), subsampling=0, optimize=True)


def prepare_inputs(
    exposures: list[dict[str, Any]],
    source_paths: dict[str, Path],
    work_dir: Path,
    raw_user_wb: list[float] | None = None,
) -> tuple[list[Path], dict[str, Any], Path | None]:
    inputs_dir = work_dir / "prepared"
    inputs_dir.mkdir(parents=True, exist_ok=True)
    reference = pick_reference(exposures)
    prepared: list[Path] = []
    reference_prepared: Path | None = None

    for index, exposure in enumerate(exposures, start=1):
        source = source_paths[str(exposure.get("id"))]
        prepared_path = inputs_dir / f"{index:04d}_{source.stem}.jpg"
        if is_raw(source):
            render_raw_to_jpeg(source, prepared_path, 95, raw_user_wb, HDR_LONG_EDGE, hdr_input=True)
        else:
            convert_to_jpeg(source, prepared_path, 95, HDR_LONG_EDGE)
        if exposure is reference:
            reference_prepared = prepared_path
        prepared.append(prepared_path)

    return prepared, reference, reference_prepared


def align_and_fuse(prepared: list[Path], output_path: Path, work_dir: Path) -> None:
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
    result = run_process(
        enfuse_tool,
        [
            "-o",
            str(fused_tif),
            "--exposure-weight=1",
            "--saturation-weight=0",
            "--contrast-weight=0",
            "--exposure-optimum=0.30",
            "--exposure-width=0.18",
            *[str(path) for path in aligned],
        ],
        work_dir,
        timeout=240,
    )
    if result.returncode != 0 or not fused_tif.exists():
        raise RuntimeError(f"enfuse failed: {trim_error(result.stderr or result.stdout)}")

    apply_hdr_tone_adjustments(fused_tif, output_path, 96)


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
                raw_user_wb = estimate_raw_rgb_grey_user_wb(source)
                render_raw_to_jpeg(source, output_path, 95, raw_user_wb, HDR_LONG_EDGE)
            else:
                convert_to_jpeg(source, output_path, 95, HDR_LONG_EDGE)
            return

        reference = pick_reference(normalized_exposures)
        reference_source = source_paths[str(reference.get("id"))]
        raw_user_wb = estimate_raw_rgb_grey_user_wb(reference_source, hdr_input=True) if is_raw(reference_source) else None
        prepared, _, _ = prepare_inputs(normalized_exposures, source_paths, work_dir, raw_user_wb)
        align_and_fuse(prepared, output_path, work_dir)


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
