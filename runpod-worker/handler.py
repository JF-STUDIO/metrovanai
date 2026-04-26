import json
import mimetypes
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import boto3
import requests
import runpod
from PIL import Image


RAW_EXTENSIONS = {".arw", ".cr2", ".cr3", ".nef", ".raf", ".dng", ".rw2", ".orf"}


def env(name: str, default: str = "") -> str:
    return os.getenv(name, default).strip()


def sanitize_file_name(value: str, fallback: str = "input") -> str:
    name = Path(value or fallback).name.replace("\\", "_").replace("/", "_")
    return name or fallback


def s3_client():
    endpoint = env("METROVAN_R2_ENDPOINT") or env("METROVAN_OBJECT_STORAGE_ENDPOINT")
    access_key = env("METROVAN_R2_ACCESS_KEY_ID") or env("METROVAN_OBJECT_STORAGE_ACCESS_KEY_ID")
    secret_key = env("METROVAN_R2_SECRET_ACCESS_KEY") or env("METROVAN_OBJECT_STORAGE_SECRET_ACCESS_KEY")
    region = env("METROVAN_R2_REGION", "auto") or "auto"

    if not endpoint or not access_key or not secret_key:
        raise RuntimeError("R2/S3 credentials are not configured in the worker.")

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )


def bucket_name() -> str:
    bucket = env("METROVAN_R2_BUCKET") or env("METROVAN_OBJECT_STORAGE_BUCKET")
    if not bucket:
        raise RuntimeError("METROVAN_R2_BUCKET is required.")
    return bucket


def download_url(url: str, target_path: Path) -> None:
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        with target_path.open("wb") as output:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    output.write(chunk)


def download_object(storage_key: str, target_path: Path) -> None:
    s3_client().download_file(bucket_name(), storage_key, str(target_path))


def download_source(source: dict[str, Any], target_dir: Path) -> Path:
    file_name = sanitize_file_name(
        source.get("originalName") or source.get("fileName") or source.get("storageKey") or "source"
    )
    target_path = target_dir / file_name

    if source.get("downloadUrl"):
        download_url(str(source["downloadUrl"]), target_path)
        return target_path

    if source.get("storageKey"):
        download_object(str(source["storageKey"]), target_path)
        return target_path

    raise RuntimeError(f"Source {file_name} does not include a download URL or storage key.")


def choose_reference_file(exposures: list[dict[str, Any]], downloaded: dict[str, Path]) -> Path:
    def exposure_score(item: dict[str, Any]) -> float:
        value = item.get("exposureCompensation")
        try:
            return abs(float(value))
        except (TypeError, ValueError):
            return 99.0

    ordered = sorted(exposures, key=exposure_score)
    for exposure in ordered:
        path = downloaded.get(str(exposure.get("id")))
        if path and path.suffix.lower() not in RAW_EXTENSIONS:
            return path

    for path in downloaded.values():
        if path.suffix.lower() not in RAW_EXTENSIONS:
            return path

    raise RuntimeError("METROVAN_PROCESSOR_COMMAND is required for RAW-only jobs.")


def copy_or_convert_to_jpeg(source_path: Path, output_path: Path) -> None:
    if source_path.suffix.lower() in RAW_EXTENSIONS:
        raise RuntimeError("RAW input requires METROVAN_PROCESSOR_COMMAND.")

    try:
        with Image.open(source_path) as image:
            image.convert("RGB").save(output_path, quality=95, optimize=True)
    except Exception:
        shutil.copyfile(source_path, output_path)


def run_command(command: str, input_dir: Path, output_path: Path, input_json_path: Path) -> None:
    env_vars = os.environ.copy()
    env_vars["METROVAN_INPUT_DIR"] = str(input_dir)
    env_vars["METROVAN_INPUT_JSON"] = str(input_json_path)
    env_vars["METROVAN_OUTPUT_PATH"] = str(output_path)
    result = subprocess.run(
        command,
        shell=True,
        check=False,
        cwd=str(input_dir),
        env=env_vars,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=int(env("METROVAN_PROCESSOR_TIMEOUT_SECONDS", "1800") or "1800"),
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").replace("\r", " ").replace("\n", " ").strip()
        raise RuntimeError(
            f"Processor command failed with exit code {result.returncode}: {detail[:1600] or command}"
        )


def produce_result(input_payload: dict[str, Any], work_dir: Path, output_path: Path) -> None:
    input_json_path = work_dir / "metrovan-input.json"
    input_json_path.write_text(json.dumps(input_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    mode = input_payload.get("workflowMode") or "default"
    command = env("METROVAN_REGEN_COMMAND") if mode == "regenerate" else env("METROVAN_PROCESSOR_COMMAND")
    if not command:
        command = env("METROVAN_PROCESSOR_COMMAND")
    if not command:
        command = "python /app/metrovan_processor.py"

    if command:
        run_command(command, work_dir, output_path, input_json_path)
        if not output_path.exists():
            raise RuntimeError("Processor command finished without creating the output file.")
        return

    if mode == "regenerate":
        source = input_payload.get("sourceImage")
        if not isinstance(source, dict):
            raise RuntimeError("Regeneration job is missing sourceImage.")
        source_path = download_source(source, work_dir)
        copy_or_convert_to_jpeg(source_path, output_path)
        return

    exposures = input_payload.get("exposures")
    if not isinstance(exposures, list) or not exposures:
        raise RuntimeError("Job is missing exposures.")

    downloaded: dict[str, Path] = {}
    for exposure in exposures:
        if not isinstance(exposure, dict):
            continue
        exposure_path = download_source(exposure, work_dir)
        downloaded[str(exposure.get("id"))] = exposure_path

    reference = choose_reference_file(exposures, downloaded)
    copy_or_convert_to_jpeg(reference, output_path)


def upload_result(output_path: Path, output: dict[str, Any]) -> str:
    storage_key = str(output.get("storageKey") or "").strip()
    if not storage_key:
        raise RuntimeError("Output storageKey is required.")

    content_type = str(output.get("contentType") or mimetypes.guess_type(output_path.name)[0] or "image/jpeg")
    s3_client().upload_file(
        str(output_path),
        bucket_name(),
        storage_key,
        ExtraArgs={"ContentType": content_type},
    )
    return storage_key


def produce_batch_results(input_payload: dict[str, Any], work_dir: Path) -> list[dict[str, Any]]:
    items = input_payload.get("items")
    if not isinstance(items, list) or not items:
        raise RuntimeError("Batch job input must include a non-empty items array.")

    common_payload = {key: value for key, value in input_payload.items() if key not in {"items", "output"}}
    results: list[dict[str, Any]] = []
    for index, raw_item in enumerate(items):
        if not isinstance(raw_item, dict):
            results.append({"hdrItemId": f"item-{index}", "errorMessage": "Batch item must be an object."})
            continue

        hdr_item_id = str(raw_item.get("hdrItemId") or f"item-{index}")
        item_output = raw_item.get("output")
        if not isinstance(item_output, dict):
            results.append({"hdrItemId": hdr_item_id, "errorMessage": "Batch item output contract is missing."})
            continue

        item_dir = work_dir / f"item_{index:03d}_{sanitize_file_name(hdr_item_id, f'item-{index}')}"
        item_dir.mkdir(parents=True, exist_ok=True)
        item_payload = {**common_payload, **raw_item}
        output_file_name = sanitize_file_name(str(item_output.get("fileName") or f"{hdr_item_id}.jpg"), f"{hdr_item_id}.jpg")
        output_path = item_dir / output_file_name

        try:
            produce_result(item_payload, item_dir, output_path)
            storage_key = upload_result(output_path, item_output)
            results.append(
                {
                    "hdrItemId": hdr_item_id,
                    "storageKey": storage_key,
                    "fileName": output_file_name,
                    "progress": 100,
                }
            )
        except Exception as exc:
            results.append({"hdrItemId": hdr_item_id, "errorMessage": str(exc)})

    return results


def handler(job: dict[str, Any]) -> dict[str, Any]:
    input_payload = job.get("input")
    if not isinstance(input_payload, dict):
        raise RuntimeError("Runpod job input must be an object.")

    if isinstance(input_payload.get("items"), list):
        with tempfile.TemporaryDirectory(prefix="metrovan-runpod-batch-") as temp_root:
            work_dir = Path(temp_root)
            results = produce_batch_results(input_payload, work_dir)
        return {
            "results": results,
            "progress": 100,
        }

    output = input_payload.get("output")
    if not isinstance(output, dict):
        raise RuntimeError("Job output contract is missing.")

    with tempfile.TemporaryDirectory(prefix="metrovan-runpod-") as temp_root:
        work_dir = Path(temp_root)
        output_file_name = sanitize_file_name(str(output.get("fileName") or "result.jpg"), "result.jpg")
        output_path = work_dir / output_file_name
        produce_result(input_payload, work_dir, output_path)
        storage_key = upload_result(output_path, output)

    return {
        "storageKey": storage_key,
        "fileName": output_file_name,
        "progress": 100,
    }


runpod.serverless.start({"handler": handler})
