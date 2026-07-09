import type { FingerprintPreset } from './Fingerprint.types';
import { SourceSkips } from './sourcer/SourceSkips';

/**
 * How config-plugin modules loaded while evaluating the Expo config are hashed.
 * - `full`: hash every loaded module (in-repo and node_modules).
 * - `scoped`: hash in-repo modules from their files, but collapse node_modules modules to their
 *   package `name@version`. Trades exact node_modules plugin fidelity for far fewer false positives.
 */
export type ConfigPluginTrace = 'full' | 'scoped';

export interface ResolvedPreset {
  sourceSkips: SourceSkips;
  /** Hash autolinked packages by their `package.json` name+version instead of their native dirs. */
  packageMode: boolean;
  configPluginTrace: ConfigPluginTrace;
}

/**
 * The preset used when a project doesn't configure one.
 */
export const DEFAULT_PRESET: FingerprintPreset = 'balanced';

/**
 * Resolve a preset name to the settings it stands for.
 *
 * - `strict`: highest fidelity - the historical default. Only skips prebuild-mutated package.json
 *   scripts so a fingerprint stays consistent before and after prebuild.
 * - `balanced`: the default. Also ignores app version and string runtime version churn, hashes
 *   autolinked packages by version, and scopes the config-plugin trace. Best first-time experience.
 * - `relaxed`: for building multiple variants from one native project. Additionally ignores app
 *   names, bundle identifiers, schemes, and assets, while still hashing the config-plugins list so
 *   adding a plugin still changes the fingerprint.
 */
export function resolvePreset(preset: FingerprintPreset): ResolvedPreset {
  switch (preset) {
    case 'strict':
      return {
        sourceSkips: SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
        packageMode: false,
        configPluginTrace: 'full',
      };
    case 'balanced':
      return {
        sourceSkips:
          SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun |
          SourceSkips.ExpoConfigVersions |
          SourceSkips.ExpoConfigRuntimeVersionIfString,
        packageMode: true,
        configPluginTrace: 'scoped',
      };
    case 'relaxed':
      return {
        sourceSkips:
          SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun |
          SourceSkips.ExpoConfigVersions |
          SourceSkips.ExpoConfigRuntimeVersionIfString |
          SourceSkips.ExpoConfigNames |
          SourceSkips.ExpoConfigAndroidPackage |
          SourceSkips.ExpoConfigIosBundleIdentifier |
          SourceSkips.ExpoConfigSchemes |
          SourceSkips.ExpoConfigAssets,
        packageMode: true,
        configPluginTrace: 'scoped',
      };
    default:
      throw new Error(
        `Invalid fingerprint preset: ${preset}. Supported presets are 'strict', 'balanced', and 'relaxed'.`
      );
  }
}
