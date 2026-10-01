export const portVariables: string[];
export function composeProjectName(root: string): string;
export function developmentEndpoints(
  env: Record<string, string>,
): Record<string, string>;
export function readDevelopmentEnv(
  root: string,
  overrides?: NodeJS.ProcessEnv,
): Record<string, string>;
