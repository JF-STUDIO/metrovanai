import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerScript = path.join(repoRoot, 'runpod-worker', 'metrovan_processor.py');

function run(command, args, options) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('close', (code) => {
      resolve({
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      });
    });
    child.on('error', (error) => {
      resolve({
        code: -1,
        stdout: '',
        stderr: error.message
      });
    });
  });
}

async function createStaticServer(filePath) {
  const server = http.createServer((req, res) => {
    if (req.url !== '/source.jpg') {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'image/jpeg' });
    fs.createReadStream(filePath).pipe(res);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Could not start smoke test HTTP server.');
  }

  return {
    url: `http://127.0.0.1:${address.port}/source.jpg`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

async function main() {
  if (!fs.existsSync(workerScript)) {
    throw new Error(`Worker script not found: ${workerScript}`);
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'metrovan-runpod-smoke-'));
  const sourcePath = path.join(tempRoot, 'source.jpg');
  const inputPath = path.join(tempRoot, 'input.json');
  const outputPath = path.join(tempRoot, 'result.jpg');

  // 1x1 PNG bytes served as source.jpg; Pillow detects by file signature.
  fs.writeFileSync(
    sourcePath,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
      'base64'
    )
  );

  const server = await createStaticServer(sourcePath);
  try {
    fs.writeFileSync(
      inputPath,
      JSON.stringify(
        {
          contractVersion: 'metrovan.runpod.v1',
          workflowMode: 'default',
          hdrItemId: 'smoke',
          title: 'smoke',
          exposures: [
            {
              id: 'source-1',
              fileName: 'source.jpg',
              originalName: 'source.jpg',
              extension: '.jpg',
              mimeType: 'image/jpeg',
              size: fs.statSync(sourcePath).size,
              isRaw: false,
              downloadUrl: server.url,
              exposureCompensation: 0
            }
          ],
          output: {
            storageKey: 'smoke/result.jpg',
            fileName: 'result.jpg',
            contentType: 'image/jpeg'
          }
        },
        null,
        2
      ),
      'utf8'
    );

    const result = await run('python', [workerScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        METROVAN_INPUT_JSON: inputPath,
        METROVAN_OUTPUT_PATH: outputPath
      }
    });

    const outputExists = fs.existsSync(outputPath);
    const outputBytes = outputExists ? fs.statSync(outputPath).size : 0;
    const ok = result.code === 0 && outputBytes > 0;
    console.log(
      JSON.stringify({
        ok,
        code: result.code,
        outputBytes,
        tempRoot,
        stderr: result.stderr.trim()
      })
    );

    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    await server.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
