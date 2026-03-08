#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function log(msg) {
  console.log(`[standalone-setup] ${msg}`);
}

function run(cmd, args, cwd, extraEnv = {}) {
  const resolvedCmd = process.platform === 'win32' && cmd === 'npm' ? 'npm.cmd' : cmd;
  const result = spawnSync(resolvedCmd, args, {
    cwd,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env, ...extraEnv }
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${resolvedCmd} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyDir(src, dest) {
  if (exists(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    filter: (item) => {
      const rel = path.relative(src, item);
      if (!rel) return true;
      if (rel.startsWith('.git')) return false;
      if (rel.startsWith('node_modules\\.cache') || rel.startsWith('node_modules/.cache')) return false;
      if (rel.startsWith('.puppeteer-cache')) return false;
      if (rel.startsWith('.browser')) return false;
      if (rel.endsWith('.zip')) return false;
      return true;
    }
  });
}

function removeNestedGitDirs(rootDir) {
  if (!exists(rootDir)) return;
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (!entry.isDirectory()) continue;

      if (entry.name === '.git') {
        fs.rmSync(full, { recursive: true, force: true });
        continue;
      }

      stack.push(full);
    }
  }
}

function pruneBundledExtractor(rootDir) {
  const pruneDirs = [
    path.join(rootDir, '.browser'),
    path.join(rootDir, '.puppeteer-cache'),
    path.join(rootDir, 'node_modules', '.cache')
  ];

  for (const dir of pruneDirs) {
    if (exists(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.zip')) {
        fs.rmSync(full, { force: true });
      }
    }
  }
}

function findSourceExtractor(appRoot) {
  const candidates = [
    path.resolve(appRoot, '..', 'local-extractor'),
    path.resolve(appRoot, '..', '..', 'local-extractor'),
    path.resolve(appRoot, '..', '..', '..', 'local-extractor')
  ];

  for (const candidate of candidates) {
    if (exists(path.join(candidate, 'cli.js')) && exists(path.join(candidate, 'package.json'))) {
      return candidate;
    }
  }

  return null;
}

function ensureExtractorDeps(extractorDir) {
  if (
    exists(path.join(extractorDir, 'node_modules', 'puppeteer-core')) ||
    exists(path.join(extractorDir, 'node_modules', 'puppeteer'))
  ) {
    return;
  }

  log(`Installing local-extractor dependencies at ${extractorDir}`);
  const hasLock = exists(path.join(extractorDir, 'package-lock.json'));

  if (hasLock) {
    try {
      run('npm', ['ci', '--omit=dev'], extractorDir);
      return;
    } catch (e) {
      log(`npm ci failed, falling back to npm install: ${e.message}`);
    }
  }

  run('npm', ['install', '--omit=dev'], extractorDir);
}

function resolveTargetTriple() {
  if (process.env.BUNDLED_TARGET_TRIPLE) return process.env.BUNDLED_TARGET_TRIPLE;

  const npmTarget = process.env.npm_config_target;
  if (npmTarget) return npmTarget;

  const fromArgv = process.argv.find(arg => arg.startsWith('--target='))?.split('=')[1];
  if (fromArgv) return fromArgv;

  const idx = process.argv.findIndex(arg => arg === '--target');
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];

  if (process.env.npm_config_argv) {
    try {
      const parsed = JSON.parse(process.env.npm_config_argv);
      const args = Array.isArray(parsed?.original) ? parsed.original : [];
      const eq = args.find(arg => typeof arg === 'string' && arg.startsWith('--target='))?.split('=')[1];
      if (eq) return eq;
      const i = args.findIndex(arg => arg === '--target');
      if (i >= 0 && args[i + 1]) return args[i + 1];
    } catch {
      // no-op
    }
  }

  return (
    process.env.TAURI_ENV_TARGET_TRIPLE ||
    process.env.CARGO_BUILD_TARGET ||
    process.env.RUST_TARGET ||
    process.env.TARGET ||
    ''
  );
}

function resolveWindowsNodeArch(targetTriple) {
  if (!targetTriple) return 'x64';
  if (targetTriple.includes('aarch64')) return 'arm64';
  if (targetTriple.includes('i686')) return 'x86';
  return 'x64';
}

function parseMajor(version) {
  const m = String(version || '').match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}

function downloadAndExtractNodeWin(appRoot, arch, nodeVersion) {
  const baseName = `node-v${nodeVersion}-win-${arch}`;
  const cacheDir = path.join(appRoot, '.cache', 'node-runtime');
  const zipPath = path.join(cacheDir, `${baseName}.zip`);
  const extractDir = path.join(cacheDir, baseName);
  const nodeExe = path.join(extractDir, baseName, 'node.exe');

  if (exists(nodeExe)) {
    return nodeExe;
  }

  ensureDir(cacheDir);
  const url = `https://nodejs.org/dist/v${nodeVersion}/${baseName}.zip`;

  log(`Downloading Node runtime for ${arch}: ${url}`);
  run(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '${url}' -OutFile '${zipPath}'`
    ],
    appRoot
  );

  if (exists(extractDir)) {
    fs.rmSync(extractDir, { recursive: true, force: true });
  }

  run(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`
    ],
    appRoot
  );

  if (!exists(nodeExe)) {
    throw new Error(`Downloaded Node runtime missing node.exe for arch ${arch}`);
  }

  return nodeExe;
}

function resolveNodeSource(appRoot, targetTriple) {
  if (process.platform !== 'win32') {
    return process.execPath;
  }

  const arch = resolveWindowsNodeArch(targetTriple);
  const hostArch = process.arch === 'x64' ? 'x64' : process.arch;

  if (arch === hostArch) {
    return process.execPath;
  }

  const requested = process.env.BUNDLED_NODE_VERSION || process.versions.node;
  const versionsToTry = [requested];

  // Node v25+ may not ship win-x86 binaries. Fall back to known LTS builds.
  if (parseMajor(requested) >= 25) {
    versionsToTry.push('22.13.1');
    versionsToTry.push('20.19.5');
  }

  let lastError = null;
  for (const version of versionsToTry) {
    try {
      return downloadAndExtractNodeWin(appRoot, arch, version);
    } catch (e) {
      lastError = e;
      log(`Node runtime fallback failed for v${version}: ${e.message}`);
    }
  }

  throw new Error(
    `Unable to bundle Node runtime for ${arch}. Last error: ${lastError ? lastError.message : 'unknown'}`
  );
}

function copyNodeRuntime(appRoot, runtimeDir, targetTriple) {
  const nodeSrc = resolveNodeSource(appRoot, targetTriple);
  const nodeExt = process.platform === 'win32' ? 'node.exe' : 'node';
  const nodeDest = path.join(runtimeDir, nodeExt);

  ensureDir(runtimeDir);
  fs.copyFileSync(nodeSrc, nodeDest);
  log(`Bundled Node runtime (${targetTriple || process.platform}): ${nodeDest} <= ${nodeSrc}`);
}

function main() {
  const appRoot = process.cwd();
  const targetTriple = resolveTargetTriple();
  const srcExtractor = findSourceExtractor(appRoot);
  if (!srcExtractor) {
    throw new Error('local-extractor source not found. Expected sibling folder named local-extractor.');
  }

  ensureExtractorDeps(srcExtractor);

  const resourcesRoot = path.join(appRoot, 'src-tauri', 'resources');
  const bundledExtractor = path.join(resourcesRoot, 'local-extractor');
  const bundledRuntime = path.join(resourcesRoot, 'runtime');

  ensureDir(resourcesRoot);

  log(`Copying extractor bundle from ${srcExtractor}`);
  copyDir(srcExtractor, bundledExtractor);
  removeNestedGitDirs(bundledExtractor);
  pruneBundledExtractor(bundledExtractor);
  copyNodeRuntime(appRoot, bundledRuntime, targetTriple);

  log('Standalone extractor bundle is ready');
}

try {
  main();
} catch (e) {
  console.error(`[standalone-setup] Failed: ${e.message}`);
  process.exit(1);
}
