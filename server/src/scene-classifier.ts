import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ExposureFile, HdrItem, SceneType } from './types.js';
import { toolPaths, runProcess } from './native-tools.js';
import { ensureDir, safeRemoveDir } from './utils.js';

interface ScenePrediction {
  fileName: string;
  roomType: string;
  confidence: number;
}

const EXTERIOR_NAME_HINTS = [
  'exterior',
  'outside',
  'outdoor',
  'front',
  'rear',
  'backyard',
  'yard',
  'patio',
  'deck',
  'balcony',
  'driveway',
  'garage',
  'entry',
  'entrance',
  'gate',
  'street',
  'road',
  'lane',
  'facade',
  'elevation',
  'building',
  'townhome',
  'townhouse',
  'condo',
  'roof',
  'pool',
  'garden',
  'courtyard',
  'view',
  'twilight',
  'aerial'
] as const;

const INTERIOR_NAME_HINTS = [
  'interior',
  'kitchen',
  'living',
  'bed',
  'bedroom',
  'bath',
  'bathroom',
  'dining',
  'family',
  'office',
  'laundry',
  'closet',
  'hall',
  'hallway',
  'foyer',
  'stair',
  'basement',
  'den',
  'fireplace',
  'pantry',
  'suite'
] as const;

const EXTERIOR_ROOM_HINTS = new Set([
  ...EXTERIOR_NAME_HINTS,
  'outside view',
  'front exterior',
  'rear exterior',
  'front yard',
  'back yard'
]);

const INTERIOR_ROOM_HINTS = new Set([
  ...INTERIOR_NAME_HINTS,
  'primary bedroom',
  'primary bath',
  'powder room',
  'great room'
]);

function trimError(value: string) {
  const normalized = (value ?? '').replace(/\r/g, ' ').replace(/\n/g, ' ').trim();
  return normalized.length > 500 ? normalized.slice(0, 500) : normalized;
}

function normalizeRoomType(roomType: string) {
  return String(roomType ?? '').trim().toLowerCase();
}

function inferSceneTypeFromRoomType(roomType: string): SceneType | null {
  const normalized = normalizeRoomType(roomType);
  if (!normalized) {
    return null;
  }

  if (EXTERIOR_ROOM_HINTS.has(normalized)) {
    return 'exterior';
  }

  if (INTERIOR_ROOM_HINTS.has(normalized)) {
    return 'interior';
  }

  if (normalized.includes('exterior') || normalized.includes('outdoor')) {
    return 'exterior';
  }

  if (
    normalized.includes('interior') ||
    normalized.includes('kitchen') ||
    normalized.includes('living') ||
    normalized.includes('bed') ||
    normalized.includes('bath')
  ) {
    return 'interior';
  }

  return null;
}

function pickNearestExposure(exposures: ExposureFile[], targetExposure: number) {
  const ranked = exposures
    .filter((exposure) => exposure.previewPath && fs.existsSync(exposure.previewPath))
    .sort((left, right) => {
      const leftValue = Number.isFinite(left.exposureCompensation) ? Number(left.exposureCompensation) : Number.POSITIVE_INFINITY;
      const rightValue = Number.isFinite(right.exposureCompensation) ? Number(right.exposureCompensation) : Number.POSITIVE_INFINITY;
      return Math.abs(leftValue - targetExposure) - Math.abs(rightValue - targetExposure);
    });

  return ranked[0] ?? null;
}

function pickDarkestExposure(exposures: ExposureFile[]) {
  const ranked = exposures
    .filter((exposure) => exposure.previewPath && fs.existsSync(exposure.previewPath) && Number.isFinite(exposure.exposureCompensation))
    .sort((left, right) => Number(left.exposureCompensation) - Number(right.exposureCompensation));

  return ranked[0] ?? null;
}

function pickClassificationExposures(hdrItem: HdrItem) {
  const candidates: ExposureFile[] = [];
  const neutral = pickNearestExposure(hdrItem.exposures, 0);
  const darkest = pickDarkestExposure(hdrItem.exposures);

  if (neutral) {
    candidates.push(neutral);
  }

  if (darkest && (!neutral || darkest.id !== neutral.id)) {
    candidates.push(darkest);
  }

  if (!candidates.length) {
    const fallback =
      hdrItem.exposures.find((exposure) => exposure.id === hdrItem.selectedExposureId && exposure.previewPath && fs.existsSync(exposure.previewPath)) ??
      hdrItem.exposures.find((exposure) => exposure.previewPath && fs.existsSync(exposure.previewPath)) ??
      null;
    if (fallback) {
      candidates.push(fallback);
    }
  }

  return candidates;
}

function createRunnerScript(scriptPath: string) {
  const content = [
    'import importlib.util',
    'import json',
    'import pathlib',
    'import sys',
    'import traceback',
    '',
    'def main():',
    '    request_path = pathlib.Path(sys.argv[1])',
    "    req = json.loads(request_path.read_text(encoding='utf-8-sig'))",
    "    node_path = pathlib.Path(req['node_path'])",
    "    spec = importlib.util.spec_from_file_location('metrovan_wall_color_aligner', str(node_path))",
    '    module = importlib.util.module_from_spec(spec)',
    '    spec.loader.exec_module(module)',
    '    grouper = module.WallFolderColorGrouper()',
    '    _overview, _report, groups_json = grouper.group_folder_colors(',
    "        folder=req['input_folder'],",
    "        patterns='*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.tif;*.tiff',",
    '        recursive=False,',
    "        sort_by='name',",
    '        start_index=0,',
    "        max_images=int(req.get('max_images', 10000)),",
    "        long_edge=int(req.get('long_edge', 768)),",
    "        cluster_delta_e=float(req.get('cluster_delta_e', 8.0)),",
    '        cluster_min_count=1,',
    "        lightness_weight=float(req.get('lightness_weight', 0.35)),",
    "        manual_merge_ranges='',",
    '        save_visuals=False,',
    '        copy_group_files=False,',
    "        output_folder=req['output_folder'],",
    "        filename_prefix='scene_classifier',",
    "        batch_mode='all_images_together',",
    '        series_digits=3,',
    "        group_strategy='scene_aware_clip',",
    "        scene_similarity_threshold=float(req.get('scene_similarity_threshold', 0.08)),",
    "        room_mismatch_scene_threshold=float(req.get('room_mismatch_scene_threshold', 0.055)),",
    "        clip_device=req.get('clip_device', 'auto'),",
    '    )',
    '    data = json.loads(groups_json)',
    "    result_path = pathlib.Path(req['result_json'])",
    "    result_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')",
    "    print('METROVAN_SCENE_CLASSIFIER_RESULT ' + str(result_path))",
    '',
    "if __name__ == '__main__':",
    '    try:',
    '        main()',
    '    except Exception:',
    '        traceback.print_exc()',
    '        sys.exit(1)'
  ].join('\n');
  fs.writeFileSync(scriptPath, content, 'utf8');
}

function readPredictions(resultJsonPath: string, fileMap: Map<string, string>) {
  const parsed = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8')) as {
    items?: Array<Record<string, unknown>>;
  };

  const predictions = new Map<string, ScenePrediction[]>();
  for (const item of parsed.items ?? []) {
    const fileName = String(item.filename ?? '').trim();
    const hdrItemId = fileMap.get(fileName);
    if (!hdrItemId) {
      continue;
    }

    const next: ScenePrediction = {
      fileName,
      roomType: String(item.room_type ?? ''),
      confidence: Number(item.room_confidence ?? 0)
    };

    const list = predictions.get(hdrItemId) ?? [];
    list.push(next);
    predictions.set(hdrItemId, list);
  }

  return predictions;
}

function aggregateSceneType(predictions: ScenePrediction[]): SceneType {
  if (!predictions.length) {
    return 'pending';
  }

  const normalized = predictions.map((prediction) => ({
    ...prediction,
    roomType: normalizeRoomType(prediction.roomType),
    inferredSceneType: inferSceneTypeFromRoomType(prediction.roomType)
  }));

  const exteriorPredictions = normalized.filter((prediction) => prediction.inferredSceneType === 'exterior');
  const interiorPredictions = normalized.filter((prediction) => prediction.inferredSceneType === 'interior');

  const strongestExterior = exteriorPredictions.reduce((max, prediction) => Math.max(max, prediction.confidence), 0);
  const strongestInterior = interiorPredictions.reduce((max, prediction) => Math.max(max, prediction.confidence), 0);
  const exteriorScore = exteriorPredictions.reduce((sum, prediction) => sum + Math.max(0.18, prediction.confidence), 0);
  const interiorScore = interiorPredictions.reduce((sum, prediction) => sum + Math.max(0.18, prediction.confidence), 0);

  if (strongestExterior >= 0.72 && strongestExterior >= strongestInterior + 0.1) {
    return 'exterior';
  }

  if (strongestInterior >= 0.45 && strongestInterior >= strongestExterior + 0.08) {
    return 'interior';
  }

  if (exteriorScore > 0 && interiorScore === 0) {
    return 'exterior';
  }

  if (interiorScore > 0 && exteriorScore === 0) {
    return 'interior';
  }

  if (exteriorScore >= 0.78 && exteriorScore >= interiorScore * 1.18) {
    return 'exterior';
  }

  if (interiorScore >= exteriorScore) {
    return 'interior';
  }

  return 'interior';
}

function inferSceneTypeFromNames(hdrItem: HdrItem): SceneType | null {
  const haystack = hdrItem.exposures
    .flatMap((exposure) => [exposure.originalName, exposure.fileName])
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  if (!haystack) {
    return null;
  }

  const exteriorHits = EXTERIOR_NAME_HINTS.filter((keyword) => haystack.includes(keyword)).length;
  const interiorHits = INTERIOR_NAME_HINTS.filter((keyword) => haystack.includes(keyword)).length;

  if (exteriorHits > interiorHits && exteriorHits > 0) {
    return 'exterior';
  }

  if (interiorHits > 0) {
    return 'interior';
  }

  return null;
}

function applyHeuristicFallback(hdrItems: HdrItem[]) {
  return hdrItems.map((hdrItem) => {
    const inferredSceneType = inferSceneTypeFromNames(hdrItem);
    if (!inferredSceneType || inferredSceneType === hdrItem.sceneType) {
      return hdrItem;
    }

    return {
      ...hdrItem,
      sceneType: inferredSceneType
    };
  });
}

export async function classifyHdrScenes(hdrItems: HdrItem[]) {
  if (!hdrItems.length || !toolPaths.comfyPython || !toolPaths.wallColorAlignerNode) {
    return applyHeuristicFallback(hdrItems);
  }

  const tempRoot = path.join(os.tmpdir(), `metrovan_scene_classifier_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const inputDir = path.join(tempRoot, 'input');
  const outputDir = path.join(tempRoot, 'output');
  const requestPath = path.join(tempRoot, 'request.json');
  const resultJsonPath = path.join(tempRoot, 'scene_result.json');
  const scriptPath = path.join(tempRoot, 'run_scene_classifier.py');
  ensureDir(inputDir);
  ensureDir(outputDir);

  try {
    const fileMap = new Map<string, string>();
    hdrItems.forEach((hdrItem, index) => {
      const exposures = pickClassificationExposures(hdrItem);
      exposures.forEach((exposure, exposureIndex) => {
        if (!exposure.previewPath || !fs.existsSync(exposure.previewPath)) {
          return;
        }

        const stagedFileName = `${String(index + 1).padStart(4, '0')}_${String(exposureIndex + 1).padStart(2, '0')}__${path.basename(exposure.previewPath)}`;
        fs.copyFileSync(exposure.previewPath, path.join(inputDir, stagedFileName));
        fileMap.set(stagedFileName, hdrItem.id);
      });
    });

    if (!fileMap.size) {
      return applyHeuristicFallback(hdrItems);
    }

    createRunnerScript(scriptPath);
    fs.writeFileSync(
      requestPath,
      JSON.stringify(
        {
          node_path: toolPaths.wallColorAlignerNode,
          input_folder: inputDir,
          output_folder: outputDir,
          result_json: resultJsonPath,
          max_images: fileMap.size,
          long_edge: 768,
          cluster_delta_e: 8.0,
          lightness_weight: 0.35,
          scene_similarity_threshold: 0.08,
          room_mismatch_scene_threshold: 0.055,
          clip_device: 'auto'
        },
        null,
        2
      ),
      'utf8'
    );

    const result = await runProcess(toolPaths.comfyPython, [scriptPath, requestPath], {
      cwd: tempRoot,
      timeoutSeconds: Math.max(300, fileMap.size * 45)
    });

    if (result.exitCode !== 0 || !fs.existsSync(resultJsonPath)) {
      throw new Error(`scene classifier failed: ${trimError(result.stderr || result.stdout)}`);
    }

    const predictions = readPredictions(resultJsonPath, fileMap);
    return hdrItems.map((hdrItem) => {
      const predictionList = predictions.get(hdrItem.id);
      if (!predictionList?.length) {
        const inferredSceneType = inferSceneTypeFromNames(hdrItem);
        return inferredSceneType ? { ...hdrItem, sceneType: inferredSceneType } : hdrItem;
      }

      return {
        ...hdrItem,
        sceneType: aggregateSceneType(predictionList)
      };
    });
  } catch (error) {
    console.warn('[scene-classifier] fallback to existing scene types:', trimError(String(error)));
    return applyHeuristicFallback(hdrItems);
  } finally {
    safeRemoveDir(tempRoot);
  }
}
