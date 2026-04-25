import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess, toolPaths } from '../src/native-tools.js';
import { ensureDir } from '../src/utils.js';

interface RgbGains {
  r: number;
  g: number;
  b: number;
}

interface ToneAdjustments {
  exposure: number;
  gamma: number;
}

const estimateRgbGainsScriptPath = fileURLToPath(new URL('./estimate_rgb_gains.py', import.meta.url));
const estimateToneAdjustmentsScriptPath = fileURLToPath(new URL('./estimate_tone_adjustments.py', import.meta.url));
const applyImageAdjustmentsScriptPath = fileURLToPath(new URL('./apply_image_adjustments.py', import.meta.url));

function trimError(value: string) {
  const normalized = (value ?? '').replace(/\r/g, ' ').replace(/\n/g, ' ').trim();
  return normalized.length > 300 ? normalized.slice(0, 300) : normalized;
}

function clampGain(value: number) {
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0.7, Math.min(1.5, value));
}

function adjustmentMagnitude(gains: RgbGains | null, toneAdjustments: ToneAdjustments | null) {
  const values = [
    gains ? Math.abs(gains.r - 1) : 0,
    gains ? Math.abs(gains.g - 1) : 0,
    gains ? Math.abs(gains.b - 1) : 0,
    toneAdjustments ? Math.abs(toneAdjustments.exposure - 1) : 0,
    toneAdjustments ? Math.abs(toneAdjustments.gamma - 1) : 0
  ];
  return Math.max(...values);
}

async function estimateRgbGains(sourcePath: string, referencePath: string): Promise<RgbGains | null> {
  if (!toolPaths.comfyPython || !fs.existsSync(estimateRgbGainsScriptPath)) {
    return null;
  }

  const result = await runProcess(
    toolPaths.comfyPython,
    [estimateRgbGainsScriptPath, '--camera', sourcePath, '--auto', referencePath],
    {
      cwd: path.dirname(estimateRgbGainsScriptPath),
      timeoutSeconds: 120
    }
  );

  if (result.exitCode !== 0) {
    console.warn('[reference-calibrate] gain estimation failed:', trimError(result.stderr || result.stdout));
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as Partial<RgbGains>;
    return {
      r: clampGain(Number(parsed.r)),
      g: clampGain(Number(parsed.g)),
      b: clampGain(Number(parsed.b))
    };
  } catch (error) {
    console.warn('[reference-calibrate] gain parse failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function estimateToneAdjustments(
  sourcePath: string,
  referencePath: string,
  gains: RgbGains | null
): Promise<ToneAdjustments | null> {
  if (!toolPaths.comfyPython || !fs.existsSync(estimateToneAdjustmentsScriptPath)) {
    return null;
  }

  const args = [
    estimateToneAdjustmentsScriptPath,
    '--source',
    sourcePath,
    '--target',
    referencePath
  ];

  if (gains) {
    args.push('--gain-r', String(gains.r), '--gain-g', String(gains.g), '--gain-b', String(gains.b));
  }

  const result = await runProcess(toolPaths.comfyPython, args, {
    cwd: path.dirname(estimateToneAdjustmentsScriptPath),
    timeoutSeconds: 120
  });

  if (result.exitCode !== 0) {
    console.warn('[reference-calibrate] tone estimation failed:', trimError(result.stderr || result.stdout));
    return null;
  }

  try {
    const parsed = JSON.parse(result.stdout.trim()) as Partial<ToneAdjustments>;
    return {
      exposure: Math.max(0.9, Math.min(1.25, Number(parsed.exposure) || 1)),
      gamma: Math.max(0.9, Math.min(1.25, Number(parsed.gamma) || 1))
    };
  } catch (error) {
    console.warn('[reference-calibrate] tone parse failed:', error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function applyImageAdjustments(
  sourcePath: string,
  outputPath: string,
  gains: RgbGains | null,
  toneAdjustments: ToneAdjustments | null
) {
  if (!toolPaths.comfyPython || !fs.existsSync(applyImageAdjustmentsScriptPath)) {
    fs.copyFileSync(sourcePath, outputPath);
    return;
  }

  const args = [
    applyImageAdjustmentsScriptPath,
    '--source',
    sourcePath,
    '--output',
    outputPath,
    '--quality',
    '95'
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

  if (result.exitCode !== 0 || !fs.existsSync(outputPath)) {
    throw new Error(`apply failed: ${trimError(result.stderr || result.stdout)}`);
  }
}

async function main() {
  const sourceDir = process.argv[2] ? path.resolve(process.argv[2]) : '';
  const referenceDir = process.argv[3] ? path.resolve(process.argv[3]) : '';
  const outputDir = process.argv[4] ? path.resolve(process.argv[4]) : path.join(sourceDir, '..', `${path.basename(sourceDir)}_matched`);
  const passesArg = process.argv.find((value) => value.startsWith('--passes='))
    ?? (process.argv.includes('--passes') ? process.argv[process.argv.indexOf('--passes') + 1] ?? '' : '');
  const passCount = Math.max(1, Math.min(5, Number(String(passesArg).replace(/^--passes=/, '')) || 1));

  if (!sourceDir || !referenceDir || !fs.existsSync(sourceDir) || !fs.existsSync(referenceDir)) {
    throw new Error('Usage: pnpm exec tsx server/scripts/reference_calibrate_outputs.ts <source-hd-dir> <reference-dir> [output-dir] [--passes N]');
  }

  ensureDir(outputDir);

  const referenceFiles = new Map(
    fs.readdirSync(referenceDir)
      .filter((name) => ['.jpg', '.jpeg', '.png'].includes(path.extname(name).toLowerCase()))
      .map((name) => [path.parse(name).name.toUpperCase(), path.join(referenceDir, name)] as const)
  );

  const summary: Array<Record<string, unknown>> = [];
  for (const name of fs.readdirSync(sourceDir)) {
    const sourcePath = path.join(sourceDir, name);
    if (!fs.statSync(sourcePath).isFile()) {
      continue;
    }

    const stem = path.parse(name).name.toUpperCase();
    const outputPath = path.join(outputDir, `${path.parse(name).name}.jpg`);
    const referencePath = referenceFiles.get(stem) ?? null;

    if (!referencePath) {
      fs.copyFileSync(sourcePath, outputPath);
      summary.push({ file: name, matched: false });
      continue;
    }

    const passSummaries: Array<Record<string, unknown>> = [];
    const tempPaths: string[] = [];
    let currentPath = sourcePath;

    for (let passIndex = 0; passIndex < passCount; passIndex += 1) {
      const gains = await estimateRgbGains(currentPath, referencePath);
      const toneAdjustments = await estimateToneAdjustments(currentPath, referencePath, gains);
      const magnitude = adjustmentMagnitude(gains, toneAdjustments);

      passSummaries.push({
        pass: passIndex + 1,
        gains,
        toneAdjustments,
        magnitude
      });

      const tempOutputPath = passIndex === passCount - 1
        ? outputPath
        : path.join(outputDir, `.tmp-${path.parse(name).name}-pass-${passIndex + 1}-${Date.now()}.jpg`);

      await applyImageAdjustments(currentPath, tempOutputPath, gains, toneAdjustments);

      if (currentPath !== sourcePath && currentPath !== outputPath && fs.existsSync(currentPath)) {
        fs.rmSync(currentPath, { force: true });
      }

      if (tempOutputPath !== outputPath) {
        tempPaths.push(tempOutputPath);
      }
      currentPath = tempOutputPath;

      if (magnitude <= 0.01) {
        if (currentPath !== outputPath) {
          fs.copyFileSync(currentPath, outputPath);
        }
        break;
      }
    }

    for (const tempPath of tempPaths) {
      if (tempPath !== outputPath && fs.existsSync(tempPath)) {
        fs.rmSync(tempPath, { force: true });
      }
    }

    const finalPass = passSummaries[passSummaries.length - 1] ?? null;
    console.log(
      `[reference-calibrate] ${name} -> passes=${passSummaries.length} final=${finalPass ? `gains=${finalPass.gains ? `${(finalPass.gains as RgbGains).r.toFixed(4)},${(finalPass.gains as RgbGains).g.toFixed(4)},${(finalPass.gains as RgbGains).b.toFixed(4)}` : 'none'} tone=${finalPass.toneAdjustments ? `${(finalPass.toneAdjustments as ToneAdjustments).exposure.toFixed(4)},${(finalPass.toneAdjustments as ToneAdjustments).gamma.toFixed(4)}` : 'none'}` : 'none'}`
    );

    summary.push({
      file: name,
      matched: true,
      reference: path.basename(referencePath),
      passes: passSummaries.length,
      passSummaries
    });
  }

  fs.writeFileSync(path.join(outputDir, 'reference-match-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`[reference-calibrate] output: ${outputDir}`);
}

main().catch((error) => {
  console.error('[reference-calibrate] failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
