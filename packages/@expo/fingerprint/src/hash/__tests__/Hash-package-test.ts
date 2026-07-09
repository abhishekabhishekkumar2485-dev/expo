import { vol } from 'memfs';

import type { HashSource } from '../../Fingerprint.types';
import { normalizeOptionsAsync } from '../../Options';
import { createLimiter } from '../../utils/Concurrency';
import { createFingerprintSourceAsync } from '../Hash';

jest.mock('fs');
jest.mock('fs/promises');
jest.mock('../../ProjectWorkflow');

const source: HashSource = {
  type: 'package',
  filePath: 'node_modules/expo-camera/package.json',
  reasons: ['expoAutolinkingPackage'],
};

async function hashPackageAsync(debug = false) {
  const options = await normalizeOptionsAsync('/app', debug ? { debug: true } : undefined);
  const limiter = createLimiter(options.concurrentIoLimit);
  return createFingerprintSourceAsync(source, limiter, '/app', options);
}

describe('package sources', () => {
  afterEach(() => {
    vol.reset();
  });

  it('should hash a package from its package.json', async () => {
    vol.fromJSON({
      '/app/node_modules/expo-camera/package.json': JSON.stringify({
        name: 'expo-camera',
        version: '1.0.0',
      }),
    });

    const result = await hashPackageAsync();

    expect(result.type).toBe('package');
    expect(result.hash).toBeTruthy();
  });

  it('should produce the same hash when a non-version field changes', async () => {
    vol.fromJSON({
      '/app/node_modules/expo-camera/package.json': JSON.stringify({
        name: 'expo-camera',
        version: '1.0.0',
        description: 'before',
        scripts: { build: 'tsc' },
      }),
    });
    const before = (await hashPackageAsync()).hash;

    vol.reset();
    vol.fromJSON({
      '/app/node_modules/expo-camera/package.json': JSON.stringify({
        name: 'expo-camera',
        version: '1.0.0',
        description: 'after',
        main: 'index.js',
      }),
    });
    const after = (await hashPackageAsync()).hash;

    expect(after).toBe(before);
  });

  it('should produce a different hash when the version changes', async () => {
    vol.fromJSON({
      '/app/node_modules/expo-camera/package.json': JSON.stringify({
        name: 'expo-camera',
        version: '1.0.0',
      }),
    });
    const before = (await hashPackageAsync()).hash;

    vol.reset();
    vol.fromJSON({
      '/app/node_modules/expo-camera/package.json': JSON.stringify({
        name: 'expo-camera',
        version: '1.1.0',
      }),
    });
    const after = (await hashPackageAsync()).hash;

    expect(after).not.toBe(before);
  });

  it('should return a null hash when the package.json does not exist', async () => {
    vol.fromJSON({ '/app/package.json': '{}' });

    const result = await hashPackageAsync();

    expect(result.hash).toBeNull();
  });

  it('should expose name and version in debug info', async () => {
    vol.fromJSON({
      '/app/node_modules/expo-camera/package.json': JSON.stringify({
        name: 'expo-camera',
        version: '2.3.4',
      }),
    });

    const result = await hashPackageAsync(true);

    expect(result.debugInfo).toEqual(
      expect.objectContaining({ name: 'expo-camera', version: '2.3.4' })
    );
  });
});
