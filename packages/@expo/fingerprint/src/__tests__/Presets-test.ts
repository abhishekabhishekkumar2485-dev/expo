import { normalizeOptionsAsync } from '../Options';
import { DEFAULT_PRESET, resolvePreset } from '../Presets';
import { SourceSkips } from '../sourcer/SourceSkips';

jest.mock('../ProjectWorkflow');

describe('resolvePreset', () => {
  it('should resolve strict to the historical default with full fidelity', () => {
    expect(resolvePreset('strict')).toEqual({
      sourceSkips: SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun,
      packageMode: false,
      configPluginTrace: 'full',
    });
  });

  it('should resolve balanced to skip version churn and hash packages by version', () => {
    const resolved = resolvePreset('balanced');
    expect(resolved.packageMode).toBe(true);
    expect(resolved.configPluginTrace).toBe('scoped');
    expect(resolved.sourceSkips & SourceSkips.ExpoConfigVersions).toBeTruthy();
    expect(resolved.sourceSkips & SourceSkips.ExpoConfigRuntimeVersionIfString).toBeTruthy();
  });

  it('should resolve relaxed to additionally skip names, identifiers, schemes, and assets', () => {
    const resolved = resolvePreset('relaxed');
    for (const skip of [
      SourceSkips.ExpoConfigNames,
      SourceSkips.ExpoConfigAndroidPackage,
      SourceSkips.ExpoConfigIosBundleIdentifier,
      SourceSkips.ExpoConfigSchemes,
      SourceSkips.ExpoConfigAssets,
    ]) {
      expect(resolved.sourceSkips & skip).toBeTruthy();
    }
    // Still hashes the whole ExpoConfig (including the plugins list), so adding a plugin changes the hash.
    expect(resolved.sourceSkips & SourceSkips.ExpoConfigAll).toBeFalsy();
  });

  it('should throw for an unknown preset', () => {
    expect(() => resolvePreset('nope' as any)).toThrow(/Invalid fingerprint preset/);
  });
});

describe('normalizeOptionsAsync preset resolution', () => {
  it('should default to the balanced preset', async () => {
    const options = await normalizeOptionsAsync('/app');
    const balanced = resolvePreset(DEFAULT_PRESET);
    expect(options.sourceSkips).toBe(balanced.sourceSkips);
    expect(options.packageMode).toBe(balanced.packageMode);
    expect(options.configPluginTrace).toBe(balanced.configPluginTrace);
  });

  it('should apply an explicit preset', async () => {
    const options = await normalizeOptionsAsync('/app', { preset: 'strict' });
    expect(options.sourceSkips).toBe(SourceSkips.PackageJsonAndroidAndIosScriptsIfNotContainRun);
    expect(options.packageMode).toBe(false);
    expect(options.configPluginTrace).toBe('full');
  });

  it('should let an explicit sourceSkips replace the preset while keeping preset-derived settings', async () => {
    const options = await normalizeOptionsAsync('/app', {
      preset: 'relaxed',
      sourceSkips: SourceSkips.None,
    });
    expect(options.sourceSkips).toBe(SourceSkips.None);
    // packageMode/configPluginTrace still come from the relaxed preset.
    expect(options.packageMode).toBe(true);
    expect(options.configPluginTrace).toBe('scoped');
  });
});
