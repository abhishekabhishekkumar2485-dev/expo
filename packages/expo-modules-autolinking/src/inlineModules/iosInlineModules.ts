import type { ModuleIosConfig } from '../types';
import { getMirrorStateObject } from './inlineModules';

export async function getIosInlineModulesClassNames(
  watchedDirectories: string[],
  appRoot: string
): Promise<ModuleIosConfig[]> {
  return (await getMirrorStateObject(watchedDirectories, appRoot)).swiftModuleClassNames.map(
    (className: string) => {
      return {
        class: className,
        name: null,
      };
    }
  );
}

function extractTargetNameFromPath(targetPath: string): string | undefined {
  const targetRegex = /\/Pods-(.+?)\/ExpoModulesProvider\.swift$/;
  return targetPath.match(targetRegex)?.[1];
}

export function isTargetInInlineModulesTargets({
  targetName,
  targetPath,
  inlineModulesTargets,
}: {
  targetName?: string;
  targetPath: string;
  inlineModulesTargets: { mainTarget?: string; targets: string[] };
}): boolean {
  const resolvedTargetName = targetName ?? extractTargetNameFromPath(targetPath);
  if (resolvedTargetName === undefined) {
    return false;
  }
  if (inlineModulesTargets.mainTarget) {
    return resolvedTargetName === inlineModulesTargets.mainTarget;
  }
  return inlineModulesTargets.targets.includes(resolvedTargetName);
}
