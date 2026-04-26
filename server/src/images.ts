import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolPaths, runProcess } from './native-tools.js';
import { ensureDir, isRawExtension } from './utils.js';

export interface HdrSourceInput {
  path: string;
  exposureCompensation?: number | null;
  isRaw?: boolean;
}

export interface RgbGains {
  r: number;
  g: number;
  b: number;
}

const HDR_LONG_EDGE = 3000;

interface ToneAdjustments {
  exposure: number;
  gamma: number;
}

function getToneAdjustmentMagnitude(adjustments: ToneAdjustments | null) {
  if (!adjustments) {
    return 0;
  }

  return Math.max(Math.abs(adjustments.exposure - 1), Math.abs(adjustments.gamma - 1));
}

type RawWhiteBalanceMode = 'camera' | 'autitcgreen' | 'autold';

interface PreparedHdrInputs {
  prepared: string[];
  referenceInput: HdrSourceInput | null;
  referencePreparedPath: string | null;
}

export interface HdrFuseOptions {
  whiteBalanceGains?: RgbGains | null;
  disableToneAdjustments?: boolean;
  fastPreprocess?: boolean;
}

export interface JpegVariantSize {
  longEdge?: number | null;
  width?: number | null;
  height?: number | null;
}

const estimateRgbGainsScriptPath = fileURLToPath(new URL('../scripts/estimate_rgb_gains.py', import.meta.url));
const estimateToneAdjustmentsScriptPath = fileURLToPath(
  new URL('../scripts/estimate_tone_adjustments.py', import.meta.url)
);
const applyImageAdjustmentsScriptPath = fileURLToPath(
  new URL('../scripts/apply_image_adjustments.py', import.meta.url)
);

function trimError(value: string) {
  const normalized = (value ?? '').replace(/\r/g, ' ').replace(/\n/g, ' ').trim();
  return normalized.length > 300 ? normalized.slice(0, 300) : normalized;
}

function ensureParent(targetPath: string) {
  ensureDir(path.dirname(targetPath));
}

function deleteIfExists(targetPath: string) {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }
}

const FALLBACK_PREVIEW_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/ASP/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/ASP/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Ar//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/IV//2gAMAwEAAgADAAAAEP/EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQMBAT8QH//EABQRAQAAAAAAAAAAAAAAAAAAABD/2gAIAQIBAT8QH//EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8QH//Z',
  'base64'
);

function writeFallbackPreview(destinationPath: string) {
  ensureParent(destinationPath);
  fs.writeFileSync(destinationPath, FALLBACK_PREVIEW_JPEG);
}

function isJpegExtension(extension: string) {
  return extension === '.jpg' || extension === '.jpeg';
}

function pickReferenceInput(inputs: HdrSourceInput[]) {
  const withExposure = inputs.filter((input) => Number.isFinite(input.exposureCompensation));
  const exposureValues = withExposure.map((input) => Number(input.exposureCompensation ?? 0));
  const uniqueExposureValues = new Set(exposureValues.map((value) => value.toFixed(6)));

  if (withExposure.length >= 3 && uniqueExposureValues.size <= 1) {
    return inputs[Math.floor(inputs.length / 2)] ?? inputs[0] ?? null;
  }

  const sortedByExposure = withExposure.sort(
    (left, right) =>
      Math.abs(Number(left.exposureCompensation ?? 0)) - Math.abs(Number(right.exposureCompensation ?? 0))
  );

  return sortedByExposure[0] ?? inputs[Math.floor(inputs.length / 2)] ?? inputs[0] ?? null;
}

function clampGain(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0.7, Math.min(1.5, value));
}

function clampWhiteBalanceRelativeGain(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }

  return Math.max(0.84, Math.min(1.18, value));
}

function stabilizeRgbGains(gains: RgbGains): RgbGains {
  const safeGreen = clampGain(gains.g);
  const normalizationBase = safeGreen > 0.001 ? safeGreen : 1;

  return {
    r: clampWhiteBalanceRelativeGain(clampGain(gains.r) / normalizationBase),
    g: 1,
    b: clampWhiteBalanceRelativeGain(clampGain(gains.b) / normalizationBase)
  };
}

async function convertToJpegWithMagick(
  sourcePath: string,
  destinationPath: string,
  quality: number,
  resize?: number | JpegVariantSize
) {
  if (!toolPaths.magick) {
    throw new Error('ImageMagick is not available.');
  }

  const tempPath = `${destinationPath}.magick.tmp.jpg`;
  deleteIfExists(tempPath);

  const args = [sourcePath];
  const resizeExpression = resolveResizeExpression(resize);
  if (resizeExpression) {
    args.push('-resize', resizeExpression);
  }
  args.push('-quality', String(quality), tempPath);

  const result = await runProcess(toolPaths.magick, args, {
    cwd: path.dirname(sourcePath),
    timeoutSeconds: 180
  });

  if (result.exitCode !== 0 || !fs.existsSync(tempPath)) {
    deleteIfExists(tempPath);
    throw new Error(`magick jpeg conversion failed: ${trimError(result.stderr || result.stdout)}`);
  }

  fs.copyFileSync(tempPath, destinationPath);
  deleteIfExists(tempPath);
}

function resolveResizeExpression(resize?: number | JpegVariantSize) {
  if (!resize) {
    return null;
  }

  if (typeof resize === 'number') {
    return resize > 0 ? `${resize}x${resize}>` : null;
  }

  if (resize.longEdge && resize.longEdge > 0) {
    return `${resize.longEdge}x${resize.longEdge}>`;
  }

  const width = resize.width && resize.width > 0 ? resize.width : null;
  const height = resize.height && resize.height > 0 ? resize.height : null;
  if (!width && !height) {
    return null;
  }

  return `${width ?? ''}x${height ?? ''}>`;
}

export async function writeJpegVariant(
  sourcePath: string,
  destinationPath: string,
  quality: number,
  resize?: number | JpegVariantSize
) {
  ensureParent(destinationPath);
  const extension = path.extname(sourcePath).toLowerCase();
  if (!resolveResizeExpression(resize) && (extension === '.jpg' || extension === '.jpeg')) {
    fs.copyFileSync(sourcePath, destinationPath);
    return;
  }

  await convertToJpegWithMagick(sourcePath, destinationPath, quality, resize);
}

function buildRawTherapeeProfile(mode: RawWhiteBalanceMode, resizeLongEdge = HDR_LONG_EDGE) {
  return [
    '[Exposure]',
    'Auto=false',
    'HistogramMatching=true',
    '',
    '[HLRecovery]',
    'Enabled=true',
    'Method=Coloropp',
    '',
    '[LensProfile]',
    'LcMode=lfauto',
    'UseDistortion=true',
    'UseVignette=true',
    'UseCA=true',
    '',
    '[RAW]',
    'CA=true',
    '',
    '[White Balance]',
    'Enabled=true',
    `Setting=${mode === 'camera' ? 'Camera' : mode}`,
    'Temperature=5000',
    'Green=1',
    'Equal=1',
    'TemperatureBias=0',
    'StandardObserver=TWO_DEGREES',
    'Itcwb_green=0',
    'Itcwb_rangegreen=1',
    'Itcwb_nopurple=false',
    'Itcwb_alg=false',
    'Itcwb_prim=beta',
    'Itcwb_sampling=false',
    'CompatibilityVersion=2',
    '',
    '[Color Management]',
    'InputProfile=(cameraICC)',
    'ToneCurve=true',
    'ApplyLookTable=true',
    'ApplyBaselineExposureOffset=true',
    'ApplyHueSatMap=true',
    'DCPIlluminant=0',
    'WorkingProfile=ProPhoto',
    'OutputProfile=RT_sRGB',
    'OutputProfileIntent=Relative',
    'OutputBPC=true',
    '',
    '[RAW Preprocess WB]',
    'Mode=1',
    '',
    '[Resize]',
    'Enabled=true',
    'Scale=1',
    'AppliesTo=Cropped area',
    'Method=Lanczos',
    'DataSpecified=3',
    `Width=${resizeLongEdge}`,
    `Height=${resizeLongEdge}`,
    'AllowUpscaling=false',
    ''
  ].join('\n');
}

async function renderRawToJpegWithRawTherapee(
  sourcePath: string,
  destinationPath: string,
  quality: number,
  mode: RawWhiteBalanceMode,
  resizeLongEdge = HDR_LONG_EDGE
) {
  if (!toolPaths.rawTherapeeCli) {
    throw new Error('RawTherapee CLI is not available.');
  }

  ensureParent(destinationPath);
  const tempRoot = path.join(os.tmpdir(), `metrovan_rt_render_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  ensureDir(tempRoot);

  try {
    const profilePath = path.join(tempRoot, 'render.pp3');
    fs.writeFileSync(profilePath, buildRawTherapeeProfile(mode, resizeLongEdge), 'utf8');

    const renderedPath = path.join(tempRoot, 'rendered.jpg');
    const result = await runProcess(
      toolPaths.rawTherapeeCli,
      ['-q', '-Y', '-d', '-p', profilePath, '-o', renderedPath, `-j${Math.max(1, Math.min(100, Math.round(quality)))}`, '-c', sourcePath],
      {
        cwd: tempRoot,
        timeoutSeconds: 300
      }
    );

    if (result.exitCode !== 0 || !fs.existsSync(renderedPath)) {
      throw new Error(`rawtherapee conversion failed: ${trimError(result.stderr || result.stdout)}`);
    }

    fs.copyFileSync(renderedPath, destinationPath);
  } finally {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function estimateRgbGains(cameraImagePath: string, autoImagePath: string): Promise<RgbGains | null> {
  if (!toolPaths.comfyPython || !fs.existsSync(estimateRgbGainsScriptPath)) {
    return null;
  }

  const result = await runProcess(
    toolPaths.comfyPython,
    [estimateRgbGainsScriptPath, '--camera', cameraImagePath, '--auto', autoImagePath],
    {
      cwd: path.dirname(estimateRgbGainsScriptPath),
      timeoutSeconds: 120
    }
  );

  if (result.exitCode !== 0) {
    console.warn('[white-balance] gain estimation failed:', trimError(result.stderr || result.stdout));
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as Partial<RgbGains>;
    const gains = stabilizeRgbGains({
      r: clampGain(Number(parsed.r)),
      g: clampGain(Number(parsed.g)),
      b: clampGain(Number(parsed.b))
    });
    return gains;
  } catch (error) {
    console.warn(
      '[white-balance] gain estimation parse failed:',
      error instanceof Error ? error.message : String(error),
      trimError(result.stdout)
    );
    return null;
  }
}

async function estimateToneAdjustments(
  sourceImagePath: string,
  targetImagePath: string,
  gains: RgbGains | null
): Promise<ToneAdjustments | null> {
  if (!toolPaths.comfyPython || !fs.existsSync(estimateToneAdjustmentsScriptPath)) {
    return null;
  }

  const args = [
    estimateToneAdjustmentsScriptPath,
    '--source',
    sourceImagePath,
    '--target',
    targetImagePath
  ];

  if (gains) {
    args.push('--gain-r', String(gains.r), '--gain-g', String(gains.g), '--gain-b', String(gains.b));
  }

  const result = await runProcess(toolPaths.comfyPython, args, {
    cwd: path.dirname(estimateToneAdjustmentsScriptPath),
    timeoutSeconds: 120
  });

  if (result.exitCode !== 0) {
    console.warn('[tone-map] tone estimation failed:', trimError(result.stderr || result.stdout));
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as Partial<ToneAdjustments>;
    const adjustments: ToneAdjustments = {
      exposure: Math.max(0.9, Math.min(1.25, Number(parsed.exposure) || 1)),
      gamma: Math.max(0.9, Math.min(1.25, Number(parsed.gamma) || 1))
    };
    return getToneAdjustmentMagnitude(adjustments) <= 0.01 ? null : adjustments;
  } catch (error) {
    console.warn(
      '[tone-map] tone estimation parse failed:',
      error instanceof Error ? error.message : String(error),
      trimError(result.stdout)
    );
    return null;
  }
}

async function applyRgbGainsWithMagick(sourcePath: string, destinationPath: string, quality: number, gains: RgbGains) {
  if (!toolPaths.magick) {
    throw new Error('ImageMagick is not available.');
  }

  const absoluteSourcePath = path.resolve(sourcePath);
  const absoluteDestinationPath = path.resolve(destinationPath);
  ensureParent(absoluteDestinationPath);
  const tempPath = `${absoluteDestinationPath}.wb.tmp.jpg`;
  deleteIfExists(tempPath);

  const args = [
    absoluteSourcePath,
    '-channel',
    'R',
    '-evaluate',
    'Multiply',
    gains.r.toFixed(6),
    '+channel',
    '-channel',
    'G',
    '-evaluate',
    'Multiply',
    gains.g.toFixed(6),
    '+channel',
    '-channel',
    'B',
    '-evaluate',
    'Multiply',
    gains.b.toFixed(6),
    '+channel',
    '-quality',
    String(quality),
    tempPath
  ];

  const result = await runProcess(toolPaths.magick, args, {
    cwd: path.dirname(absoluteSourcePath),
    timeoutSeconds: 180
  });

  if (result.exitCode !== 0 || !fs.existsSync(tempPath)) {
    deleteIfExists(tempPath);
    throw new Error(`magick rgb gain apply failed: ${trimError(result.stderr || result.stdout)}`);
  }

  fs.copyFileSync(tempPath, absoluteDestinationPath);
  deleteIfExists(tempPath);
}

async function applyImageAdjustments(
  sourcePath: string,
  destinationPath: string,
  quality: number,
  gains: RgbGains | null,
  toneAdjustments: ToneAdjustments | null
) {
  const absoluteSourcePath = path.resolve(sourcePath);
  const absoluteDestinationPath = path.resolve(destinationPath);

  if (toolPaths.comfyPython && fs.existsSync(applyImageAdjustmentsScriptPath)) {
    const args = [
      applyImageAdjustmentsScriptPath,
      '--source',
      absoluteSourcePath,
      '--output',
      absoluteDestinationPath,
      '--quality',
      String(quality)
    ];

    if (gains) {
      args.push('--gain-r', String(gains.r), '--gain-g', String(gains.g), '--gain-b', String(gains.b));
    }

    if (toneAdjustments) {
      args.push('--exposure', String(toneAdjustments.exposure), '--gamma', String(toneAdjustments.gamma));
    }

    const result = await runProcess(toolPaths.comfyPython, args, {
      cwd: path.dirname(applyImageAdjustmentsScriptPath),
      timeoutSeconds: 180
    });

    if (result.exitCode === 0 && fs.existsSync(absoluteDestinationPath)) {
      return;
    }

    console.warn('[tone-map] python apply fallback:', trimError(result.stderr || result.stdout));
  }

  if (gains) {
    await applyRgbGainsWithMagick(absoluteSourcePath, absoluteDestinationPath, quality, gains);
    return;
  }

  await convertToJpegWithMagick(absoluteSourcePath, absoluteDestinationPath, quality);
}

async function applyGroupWhiteBalanceToPreparedInputs(
  preparedPaths: string[],
  gains: RgbGains,
  outputDir: string
) {
  const adjustedPaths: string[] = [];

  for (let index = 0; index < preparedPaths.length; index += 1) {
    const preparedPath = preparedPaths[index]!;
    const adjustedPath = path.join(outputDir, `${String(index + 1).padStart(4, '0')}_wb.jpg`);
    await applyImageAdjustments(preparedPath, adjustedPath, 95, gains, null);
    adjustedPaths.push(adjustedPath);
  }

  return adjustedPaths;
}

async function prepareHdrInputs(
  inputs: HdrSourceInput[],
  inputsDir: string,
  preferEmbeddedRawPreview = false
): Promise<PreparedHdrInputs> {
  const prepared: string[] = [];
  const referenceInput = pickReferenceInput(inputs);
  let referencePreparedPath: string | null = null;

  for (let index = 0; index < inputs.length; index += 1) {
    const input = inputs[index]!;
    const sourcePath = input.path;
    const preparedPath = path.join(
      inputsDir,
      `${String(index + 1).padStart(4, '0')}_${path.basename(sourcePath, path.extname(sourcePath))}.jpg`
    );

    if (preferEmbeddedRawPreview) {
      await extractPreviewOrConvertToJpeg(sourcePath, preparedPath, 95, HDR_LONG_EDGE);
    } else if ((input.isRaw ?? isRawExtension(path.extname(sourcePath))) && toolPaths.rawTherapeeCli) {
      await renderRawToJpegWithRawTherapee(sourcePath, preparedPath, 95, 'camera', HDR_LONG_EDGE);
    } else {
      await extractPreviewOrConvertToJpeg(sourcePath, preparedPath, 95, HDR_LONG_EDGE);
    }

    if (referenceInput?.path === input.path) {
      referencePreparedPath = preparedPath;
    }

    prepared.push(preparedPath);
  }

  return {
    prepared,
    referenceInput,
    referencePreparedPath
  };
}

export async function estimateReferenceWhiteBalanceGains(sourceInputs: Array<string | HdrSourceInput>) {
  const inputs = sourceInputs.map((input) =>
    typeof input === 'string' ? { path: input, isRaw: isRawExtension(path.extname(input)) } : input
  );
  const referenceInput = pickReferenceInput(inputs);
  if (
    !referenceInput ||
    !(referenceInput.isRaw ?? isRawExtension(path.extname(referenceInput.path))) ||
    !toolPaths.rawTherapeeCli
  ) {
    return null;
  }

  const workRoot = path.join(process.env.TEMP ?? process.cwd(), `metrovan_wb_ref_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  ensureDir(workRoot);

  try {
    const referenceCameraPath = path.join(workRoot, 'reference-camera.jpg');
    const referenceAutoPath = path.join(workRoot, 'reference-auto.jpg');
    await renderRawToJpegWithRawTherapee(referenceInput.path, referenceCameraPath, 95, 'camera', HDR_LONG_EDGE);
    await renderRawToJpegWithRawTherapee(referenceInput.path, referenceAutoPath, 95, 'autold', HDR_LONG_EDGE);
    return await estimateRgbGains(referenceCameraPath, referenceAutoPath);
  } finally {
    try {
      fs.rmSync(workRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

export async function extractPreviewOrConvertToJpeg(
  sourcePath: string,
  destinationPath: string,
  quality = 92,
  resizeLongEdge?: number
) {
  const extension = path.extname(sourcePath).toLowerCase();
  ensureParent(destinationPath);

  if (isJpegExtension(extension) && (!resizeLongEdge || !toolPaths.magick)) {
    fs.copyFileSync(sourcePath, destinationPath);
    return;
  }

  if (isRawExtension(extension) && toolPaths.exiftool) {
    const tempPath = `${destinationPath}.preview.tmp.jpg`;
    deleteIfExists(tempPath);

    for (const tag of ['-JpgFromRaw', '-PreviewImage']) {
      deleteIfExists(tempPath);
      const result = await runProcess(toolPaths.exiftool, [tag, '-b', sourcePath], {
        cwd: path.dirname(sourcePath),
        timeoutSeconds: 60,
        stdoutPath: tempPath
      });
      if (result.exitCode === 0 && fs.existsSync(tempPath) && fs.statSync(tempPath).size > 0) {
        if (resizeLongEdge && toolPaths.magick) {
          await convertToJpegWithMagick(tempPath, destinationPath, quality, resizeLongEdge);
          deleteIfExists(tempPath);
          return;
        }

        fs.copyFileSync(tempPath, destinationPath);
        deleteIfExists(tempPath);
        return;
      }
    }

    deleteIfExists(tempPath);
    console.warn(`RAW preview extraction failed, using fallback preview: ${path.basename(sourcePath)}`);
  }

  if (toolPaths.magick) {
    try {
      await convertToJpegWithMagick(sourcePath, destinationPath, quality, resizeLongEdge);
      return;
    } catch (error) {
      if (!isRawExtension(extension)) {
        throw error;
      }

      console.warn(
        `RAW preview conversion failed, using fallback preview: ${path.basename(sourcePath)} ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (isRawExtension(extension)) {
    writeFallbackPreview(destinationPath);
    return;
  }

  throw new Error(`No preview conversion path available for ${path.basename(sourcePath)}`);
}

export async function fuseToJpeg(
  sourceInputs: Array<string | HdrSourceInput>,
  outputPath: string,
  quality = 95,
  options: HdrFuseOptions = {}
) {
  if (!sourceInputs.length) {
    throw new Error('No HDR inputs provided.');
  }

  const inputs = sourceInputs.map((input) =>
    typeof input === 'string' ? { path: input, isRaw: isRawExtension(path.extname(input)) } : input
  );

  if (inputs.length === 1) {
    const only = inputs[0]!;
    const whiteBalanceGains = options.whiteBalanceGains ?? null;
    const isRaw = only.isRaw ?? isRawExtension(path.extname(only.path));

    if (!options.fastPreprocess && isRaw && toolPaths.rawTherapeeCli && whiteBalanceGains) {
      const workRoot = path.join(
        process.env.TEMP ?? process.cwd(),
        `metrovan_single_hdr_${Date.now()}_${Math.random().toString(16).slice(2)}`
      );
      ensureDir(workRoot);

      try {
        const cameraPath = path.join(workRoot, 'single-camera.jpg');
        await renderRawToJpegWithRawTherapee(only.path, cameraPath, quality, 'camera', HDR_LONG_EDGE);

        let toneAdjustments: ToneAdjustments | null = null;
        if (!options.disableToneAdjustments) {
          const autoPath = path.join(workRoot, 'single-auto.jpg');
          await renderRawToJpegWithRawTherapee(only.path, autoPath, quality, 'autold', HDR_LONG_EDGE);
          toneAdjustments = await estimateToneAdjustments(cameraPath, autoPath, whiteBalanceGains);
        }

        await applyImageAdjustments(cameraPath, outputPath, quality, whiteBalanceGains, toneAdjustments);
      } finally {
        try {
          fs.rmSync(workRoot, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
      return;
    }

    if (whiteBalanceGains) {
      const workRoot = path.join(
        process.env.TEMP ?? process.cwd(),
        `metrovan_single_balance_${Date.now()}_${Math.random().toString(16).slice(2)}`
      );
      ensureDir(workRoot);

      try {
        const preparedPath = path.join(workRoot, 'single-base.jpg');
        if (options.fastPreprocess) {
          await extractPreviewOrConvertToJpeg(only.path, preparedPath, quality, HDR_LONG_EDGE);
        } else if (isRaw && toolPaths.rawTherapeeCli) {
          await renderRawToJpegWithRawTherapee(only.path, preparedPath, quality, 'camera', HDR_LONG_EDGE);
        } else {
          await extractPreviewOrConvertToJpeg(only.path, preparedPath, quality, HDR_LONG_EDGE);
        }

        await applyImageAdjustments(preparedPath, outputPath, quality, whiteBalanceGains, null);
      } finally {
        try {
          fs.rmSync(workRoot, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
      return;
    }

    if (isRaw && toolPaths.rawTherapeeCli) {
      await renderRawToJpegWithRawTherapee(only.path, outputPath, quality, 'autold', HDR_LONG_EDGE);
    } else {
      await extractPreviewOrConvertToJpeg(only.path, outputPath, quality, HDR_LONG_EDGE);
    }
    return;
  }

  if (!toolPaths.alignImageStack || !toolPaths.enfuse) {
    throw new Error('HDR alignment tools are missing: align_image_stack / enfuse');
  }

  const workRoot = path.join(process.env.TEMP ?? process.cwd(), `metrovan_hdr_${Date.now()}_${Math.random().toString(16).slice(2)}`);
  const inputsDir = path.join(workRoot, 'inputs');
  const wbInputsDir = path.join(workRoot, 'wb-inputs');
  const alignedDir = path.join(workRoot, 'aligned');
  ensureDir(inputsDir);
  ensureDir(wbInputsDir);
  ensureDir(alignedDir);

  try {
    const fastPreprocess = options.fastPreprocess ?? false;
    const { prepared, referenceInput, referencePreparedPath } = await prepareHdrInputs(inputs, inputsDir, fastPreprocess);

    let groupGains: RgbGains | null = options.whiteBalanceGains ?? null;
    let referenceAutoPath: string | null = null;
    let preparedForAlign = prepared;
    let toneTargetPath = referencePreparedPath;
    if (
      referenceInput &&
      referencePreparedPath &&
      (referenceInput.isRaw ?? isRawExtension(path.extname(referenceInput.path))) &&
      toolPaths.rawTherapeeCli
    ) {
      if (!groupGains || !options.disableToneAdjustments) {
        referenceAutoPath = path.join(workRoot, 'reference-auto.jpg');
        await renderRawToJpegWithRawTherapee(referenceInput.path, referenceAutoPath, 95, 'autold', HDR_LONG_EDGE);
      }
      if (!groupGains) {
        groupGains = referenceAutoPath ? await estimateRgbGains(referencePreparedPath, referenceAutoPath) : null;
      }
      if (groupGains && !fastPreprocess) {
        preparedForAlign = await applyGroupWhiteBalanceToPreparedInputs(prepared, groupGains, wbInputsDir);
        toneTargetPath = referenceAutoPath;
      }
    }

    const alignResult = await runProcess(
      toolPaths.alignImageStack,
      ['-a', 'aligned_', '-c', '12', '-g', '6', '-t', '2.0', '-s', '0', ...preparedForAlign],
      {
        cwd: alignedDir,
        timeoutSeconds: 180
      }
    );
    if (alignResult.exitCode !== 0) {
      throw new Error(`align_image_stack failed: ${trimError(alignResult.stderr || alignResult.stdout)}`);
    }

    const aligned = fs
      .readdirSync(alignedDir)
      .filter((name) => /^aligned_.*\.tif$/i.test(name))
      .map((name) => path.join(alignedDir, name))
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));

    if (aligned.length < 2) {
      throw new Error('align_image_stack did not output enough aligned TIFF files.');
    }

    const fusedTif = path.join(workRoot, 'fused.tif');
    const enfuseResult = await runProcess(toolPaths.enfuse, ['-o', fusedTif, ...aligned], {
      cwd: workRoot,
      timeoutSeconds: 180
    });
    if (enfuseResult.exitCode !== 0 || !fs.existsSync(fusedTif)) {
      throw new Error(`enfuse failed: ${trimError(enfuseResult.stderr || enfuseResult.stdout)}`);
    }

    let toneAdjustments: ToneAdjustments | null = null;
    if (!options.disableToneAdjustments && toneTargetPath && fs.existsSync(toneTargetPath)) {
      toneAdjustments = await estimateToneAdjustments(fusedTif, toneTargetPath, null);
    }

    await applyImageAdjustments(fusedTif, outputPath, quality, fastPreprocess ? groupGains : null, toneAdjustments);
  } finally {
    try {
      fs.rmSync(workRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
