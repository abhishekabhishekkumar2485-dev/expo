/**
 * A helper script to load the Expo config and loaded plugins from a project
 */

import fs from 'fs/promises';
import module from 'module';
import process from 'node:process';
import path from 'path';
import resolveFrom from 'resolve-from';

import { DEFAULT_IGNORE_PATHS } from './Options';
import { isIgnoredPath, toPosixPath } from './utils/Path';

async function runAsync(programName: string, args: string[] = []) {
  if (args[0] == null) {
    console.log(`Usage: ${programName} <projectRoot> [ignoredFile] [--skip-plugins]`);
    return;
  }

  const projectRoot = path.resolve(args[0]);
  const skipPlugins = args.includes('--skip-plugins');
  const ignoredFileArg = args[1] && !args[1].startsWith('--') ? args[1] : null;
  const ignoredFile = ignoredFileArg ? path.resolve(ignoredFileArg) : null;

  setNodeEnv('development');
  require('@expo/env').load(projectRoot);

  // Capture modules as `getConfig()` compiles them rather than diffing `module._cache` afterwards.
  // The cache only keeps paths; at compile time we still have the authoritative filename (so a
  // transpiled `.ts` plugin isn't mistaken for a non-existent `.js`) and the source content (so a
  // module with no file on disk can still be hashed instead of crashing).
  // The caller runs this twice (with and without `--skip-plugins`) and diffs the results, so the
  // config-loading framework is excluded automatically - leaving only a tiny residual allowlist
  // (`DEFAULT_CONFIG_LOADING_IGNORE_PATHS`) for framework packages that load only while plugins run.
  const { getCapturedModules, uninstall } = installModuleCaptureHook();
  let config;
  try {
    const { getConfig } = require(resolveFrom(path.resolve(projectRoot), 'expo/config'));
    config = await getConfig(projectRoot, {
      skipSDKVersionRequirement: true,
      skipPlugins,
    });
  } finally {
    uninstall();
  }

  const ignoredPaths = [
    ...DEFAULT_CONFIG_LOADING_IGNORE_PATHS,
    ...(await loadIgnoredPathsAsync(ignoredFile)),
  ];
  const loadedModules = await resolveLoadedModuleSourcesAsync(
    getCapturedModules(),
    projectRoot,
    ignoredPaths
  );

  const result = JSON.stringify({
    // The plugins-skipped pass only contributes its module list to the diff; its config is unused.
    config: skipPlugins ? null : config,
    loadedModules,
  });

  if (process.send) {
    process.send(result);
  } else {
    console.log(result);
  }
}

// If running from the command line
if (require.main?.filename === __filename) {
  (async () => {
    const programIndex = process.argv.findIndex((arg) => arg === __filename);
    const programName = process.argv[programIndex] ?? __filename;
    try {
      await runAsync(programName, process.argv.slice(programIndex + 1));
    } catch (e) {
      console.error('Uncaught Error', e);
      process.exit(1);
    }
  })();
}

/**
 * Load the generated ignored paths file from caller and remove the file after loading
 */
async function loadIgnoredPathsAsync(ignoredFile: string | null) {
  if (!ignoredFile) {
    return DEFAULT_IGNORE_PATHS;
  }

  const ignorePaths = [];
  try {
    const fingerprintIgnore = await fs.readFile(ignoredFile, 'utf8');
    const fingerprintIgnoreLines = fingerprintIgnore.split('\n');
    for (const line of fingerprintIgnoreLines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        ignorePaths.push(trimmedLine);
      }
    }
  } catch {}

  return ignorePaths;
}

/**
 * A CommonJS module observed while `installModuleCaptureHook()` was active.
 */
export interface CapturedModule {
  /** The module id (cache key). May diverge from `filename` for virtual modules. */
  id: string;
  /** The filename Node compiled the module under. Authoritative even for transpiled sources. */
  filename: string;
  /** The source content Node executed for the module. */
  content: string;
}

/**
 * A config-plugin source produced from a captured module.
 * A module backed by a real file becomes a `file` source (hashed from disk, so it stays
 * transpiler-independent); one with no file on disk becomes a `contents` source carrying the
 * captured body.
 */
export type LoadedModuleSource =
  | { type: 'file'; path: string }
  | { type: 'contents'; id: string; contents: string };

/**
 * Observe every CommonJS module compiled while the hook is installed.
 * We hook `Module.prototype._compile` instead of diffing `module._cache` afterwards so we keep the
 * authoritative filename and source content of each module - see the note in `runAsync`.
 */
export function installModuleCaptureHook(): {
  getCapturedModules: () => CapturedModule[];
  uninstall: () => void;
} {
  const moduleProto = (module as unknown as { prototype: ModuleCompilePrototype }).prototype;
  const capturedModules: CapturedModule[] = [];
  const originalCompile = moduleProto._compile;
  moduleProto._compile = function (this: { id?: string }, content: string, filename: string) {
    capturedModules.push({ id: this.id ?? filename, filename, content });
    return originalCompile.call(this, content, filename);
  };
  return {
    getCapturedModules: () => capturedModules,
    uninstall: () => {
      moduleProto._compile = originalCompile;
    },
  };
}

interface ModuleCompilePrototype {
  _compile: (this: { id?: string }, content: string, filename: string) => unknown;
}

/**
 * Turn captured modules into config-plugin sources, dropping ignored paths.
 * A real file becomes a `file` source; a module with no file on disk (virtual / compiled from a
 * string) becomes a `contents` source keyed by its project-relative path so it stays stable across
 * runs. A path that exists but is not a file (e.g. a directory) is skipped.
 */
export async function resolveLoadedModuleSourcesAsync(
  capturedModules: CapturedModule[],
  projectRoot: string,
  ignoredPaths: string[]
): Promise<LoadedModuleSource[]> {
  const results: LoadedModuleSource[] = [];
  const seen = new Set<string>();

  for (const { filename, content } of capturedModules) {
    const relativePath = toPosixPath(path.relative(projectRoot, filename));
    if (seen.has(relativePath)) {
      continue;
    }
    seen.add(relativePath);

    if (isIgnoredPath(relativePath, ignoredPaths)) {
      continue;
    }

    let existsAsFile = false;
    let missing = false;
    try {
      const stat = await fs.stat(filename);
      existsAsFile = stat.isFile();
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        missing = true;
      } else {
        throw error;
      }
    }

    if (existsAsFile) {
      results.push({ type: 'file', path: relativePath });
    } else if (missing) {
      results.push({ type: 'contents', id: relativePath, contents: content });
    }
  }

  return results;
}

/**
 * Get the path to the ExpoConfigLoader file.
 */
export function getExpoConfigLoaderPath() {
  return path.join(__dirname, 'ExpoConfigLoader.js');
}

/**
 * Set the environment to production or development
 * Replicates the code from `@expo/cli` to ensure the same environment is set.
 */
function setNodeEnv(mode: 'development' | 'production') {
  process.env.NODE_ENV = process.env.NODE_ENV || mode;
  process.env.BABEL_ENV = process.env.BABEL_ENV || process.env.NODE_ENV;

  // @ts-expect-error: Add support for external React libraries being loaded in the same process.
  globalThis.__DEV__ = process.env.NODE_ENV !== 'production';
}

// Residual exclusions layered on top of the plugins-skipped diff: framework packages that load only
// while plugins run (so the diff can't cancel them) and are versioned with the SDK rather than being
// user config plugins. `@expo/*` covers the `@expo/config-plugins` engine and its tooling.
const DEFAULT_CONFIG_LOADING_IGNORE_PATHS = [
  '**/node_modules/@expo/**/*',
  '**/node_modules/{debug,ms,has-flag,supports-color}/**/*',
];
