/**
 * Public contract between the Electron shell (main + preload) and the shared
 * web views. This module stays dependency-free so the contract test and the
 * preload can import it without loading Electron.
 *
 * The bridge never carries session secrets, tokens or raw file contents:
 * the renderer already talks to the same-origin API through its own cookies,
 * and downloads are stored by the main process, not passed over IPC.
 */

export const DESKTOP_BRIDGE_NAME = 'saasDesktop';

/** Fixed request/response and event channels; both sides import these names. */
export const CHANNELS = {
  getInfo: 'desktop:get-info',
  retryLoad: 'desktop:retry-load',
  openDownloadsFolder: 'desktop:open-downloads-folder',
  downloadState: 'desktop:download-state',
} as const;

export type DesktopInfo = { version: string; platform: string };

export type DownloadPhase =
  'started' | 'progress' | 'completed' | 'failed' | 'cancelled';

export type DownloadStateEvent = {
  id: string;
  filename: string;
  phase: DownloadPhase;
  receivedBytes: number;
  totalBytes: number | null;
};

/** The only surface preload exposes to the shared views. */
export type DesktopBridge = {
  getInfo(): Promise<DesktopInfo>;
  retryLoad(): Promise<void>;
  openDownloadsFolder(): Promise<void>;
  onDownloadState(listener: (event: DownloadStateEvent) => void): () => void;
};

/** Same-origin sentinel used to prove a target stays inside the app origin. */
const IN_APP_BASE = 'https://saas-desktop.invalid';
const MAX_PATH_LENGTH = 2048;

/**
 * Resolve `raw` against a sentinel origin and keep the result only when it
 * stays on that origin. Absolute URLs, protocol-relative paths, backslash
 * tricks and unknown schemes all resolve elsewhere and are rejected.
 */
export function normalizeDeepLinkPath(raw: string): string | null {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return null;
  if (
    raw.length > MAX_PATH_LENGTH ||
    // Raw whitespace/control characters are never valid deep-link targets;
    // legitimate paths use percent-encoded forms instead.
    /\s/.test(raw) ||
    [...raw].some(isControlCharacter)
  )
    return null;
  let target: URL;
  try {
    target = new URL(raw, IN_APP_BASE);
  } catch {
    return null;
  }
  if (target.origin !== IN_APP_BASE) return null;
  const path = `${target.pathname}${target.search}`;
  if (path.length > MAX_PATH_LENGTH || !path.startsWith('/')) return null;
  return path;
}

/** The custom scheme of `saas://open/...` deep links; shared with the shell. */
export const DEEP_LINK_SCHEME = 'saas';
const DEEP_LINK_HOST = 'open';

/** Parse a `saas://open/...` deep link into a validated in-app path. */
export function parseDeepLink(raw: string): string | null {
  if (typeof raw !== 'string' || raw.length > MAX_PATH_LENGTH) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== `${DEEP_LINK_SCHEME}:` ||
    parsed.host !== DEEP_LINK_HOST
  )
    return null;
  return normalizeDeepLinkPath(`${parsed.pathname}${parsed.search}`);
}

const MAX_FILENAME_LENGTH = 128;
const DEFAULT_FILENAME = 'download';

const isControlCharacter = (character: string): boolean => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f;
};

/** Reduce a suggested download name to a single safe path segment. */
export function sanitizeDownloadFilename(raw: string): string {
  if (typeof raw !== 'string') return DEFAULT_FILENAME;
  // Keep the base name only: drop every directory hint, separator or traversal.
  const base = raw.split(/[/\\]/).pop() ?? '';
  const cleaned = [...base]
    .filter((character) => !isControlCharacter(character))
    .join('')
    .trim();
  const withoutEdges = cleaned.replace(/^\.+/, '').trim();
  const name = withoutEdges.length > 0 ? withoutEdges : DEFAULT_FILENAME;
  if (name.length <= MAX_FILENAME_LENGTH) return name;
  const dot = name.lastIndexOf('.');
  const suffix = dot > 0 ? name.slice(dot) : '';
  return name.slice(0, MAX_FILENAME_LENGTH - suffix.length) + suffix;
}

/**
 * Only http(s) targets may reach the system browser; every other scheme is
 * dropped before the OS sees it.
 */
export function isBrowserHandoffAllowed(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

const PHASES: readonly DownloadPhase[] = [
  'started',
  'progress',
  'completed',
  'failed',
  'cancelled',
];
const MAX_STATE_ID = 128;

/**
 * Validate an event before it crosses IPC in either direction; malformed
 * payloads are dropped instead of reaching the shared views.
 */
export function validateDownloadState(raw: unknown): DownloadStateEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const candidate = raw as Record<string, unknown>;
  const { id, filename, phase, receivedBytes, totalBytes } = candidate;
  if (typeof id !== 'string' || id.length === 0 || id.length > MAX_STATE_ID)
    return null;
  if (typeof filename !== 'string') return null;
  if (filename !== sanitizeDownloadFilename(filename)) return null;
  if (typeof phase !== 'string' || !PHASES.includes(phase as DownloadPhase))
    return null;
  if (
    typeof receivedBytes !== 'number' ||
    !Number.isSafeInteger(receivedBytes) ||
    receivedBytes < 0
  )
    return null;
  if (totalBytes !== null) {
    if (
      typeof totalBytes !== 'number' ||
      !Number.isSafeInteger(totalBytes) ||
      totalBytes < 0
    )
      return null;
    if (receivedBytes > totalBytes) return null;
  }
  return {
    id,
    filename,
    phase: phase as DownloadPhase,
    receivedBytes,
    totalBytes,
  };
}
