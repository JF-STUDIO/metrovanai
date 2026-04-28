import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ensureDir } from './utils.js';

export interface ToolPaths {
  exiftool: string;
  magick: string;
  alignImageStack: string;
  enfuse: string;
  rawTherapeeCli: string;
  comfyPython: string;
  wallColorAlignerNode: string;
}

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function resolveExecutable(fileName: string | string[], candidates: string[]) {
  const fileNames = Array.isArray(fileName) ? fileName : [fileName];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  const pathValue = process.env.PATH ?? '';
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const name of fileNames) {
      try {
        const fullPath = path.join(directory.trim(), name);
        if (fs.existsSync(fullPath)) {
          return fullPath;
        }
      } catch {
        // ignore
      }
    }
  }

  return '';
}

export const toolPaths: ToolPaths = {
  magick: resolveExecutable(['magick.exe', 'magick', 'convert'], [
    'C:\\Program Files\\ImageMagick-7.1.2-Q16-HDRI\\magick.exe',
    'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe'
  ]),
  exiftool: resolveExecutable(['ExifTool.exe', 'exiftool'], [
    path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'ExifTool', 'ExifTool.exe')
  ]),
  alignImageStack: resolveExecutable(['align_image_stack.exe', 'align_image_stack'], [
    'C:\\Program Files\\Hugin\\bin\\align_image_stack.exe',
    'C:\\Program Files (x86)\\Hugin\\bin\\align_image_stack.exe',
    'C:\\Program Files\\Hugin\\bin\\hugin\\bin\\align_image_stack.exe'
  ]),
  enfuse: resolveExecutable(['enfuse.exe', 'enfuse'], [
    'C:\\Program Files\\Hugin\\bin\\enfuse.exe',
    'C:\\Program Files (x86)\\Hugin\\bin\\enfuse.exe',
    'C:\\Program Files\\Hugin\\bin\\hugin\\bin\\enfuse.exe'
  ]),
  rawTherapeeCli: resolveExecutable(['rawtherapee-cli.exe', 'rawtherapee-cli'], [
    'C:\\Program Files\\RawTherapee\\5.12\\rawtherapee-cli.exe'
  ]),
  comfyPython: resolveExecutable(['python.exe', 'python3', 'python'], ['E:\\comfy\\.venv\\Scripts\\python.exe']),
  wallColorAlignerNode:
    [
      'E:\\comfy\\custom_nodes\\comfyui_wall_color_aligner\\wall_color_aligner.py',
      path.join(
        process.env.LOCALAPPDATA ?? '',
        'Programs',
        'ComfyUI',
        'resources',
        'ComfyUI',
        'custom_nodes',
        'comfyui_wall_color_aligner',
        'wall_color_aligner.py'
      )
    ].find((candidate) => Boolean(candidate) && fs.existsSync(candidate)) ?? ''
};

export async function runProcess(
  fileName: string,
  args: string[],
  options: { cwd?: string; timeoutSeconds?: number; stdoutPath?: string } = {}
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(fileName, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let stdoutStream: fs.WriteStream | null = null;
    let stdoutStreamFinished = false;

    if (options.stdoutPath) {
      ensureDir(path.dirname(options.stdoutPath));
      stdoutStream = fs.createWriteStream(options.stdoutPath);
      stdoutStream.on('finish', () => {
        stdoutStreamFinished = true;
      });
      child.stdout.pipe(stdoutStream);
    } else {
      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    }

    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, Math.max(1, options.timeoutSeconds ?? 60) * 1000);

    child.on('error', (error) => {
      clearTimeout(timeout);
      stdoutStream?.destroy();
      reject(error);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);

      const finish = () => {
        if (timedOut) {
          reject(new Error(`External process timed out: ${path.basename(fileName)}`));
          return;
        }

        resolve({
          exitCode: exitCode ?? -1,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8')
        });
      };

      if (stdoutStream && !stdoutStreamFinished) {
        stdoutStream.once('finish', finish);
        stdoutStream.end();
        return;
      }

      finish();
    });
  });
}
