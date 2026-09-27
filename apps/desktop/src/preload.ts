import { contextBridge, ipcRenderer } from 'electron';
import {
  CHANNELS,
  DESKTOP_BRIDGE_NAME,
  validateDownloadState,
  type DownloadStateEvent,
} from './ipc-contract';

/**
 * The only bridge between the shell and the shared views. Every payload is
 * validated before it reaches page code; nothing here carries session
 * secrets, tokens or raw file contents.
 */

function subscribe<T>(
  channel: string,
  adapt: (raw: unknown) => T | null,
  listener: (event: T) => void,
): () => void {
  const wrapped = (_event: unknown, raw: unknown): void => {
    const payload = adapt(raw);
    if (payload !== null) listener(payload);
  };
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_NAME, {
  getInfo: () => ipcRenderer.invoke(CHANNELS.getInfo),
  retryLoad: () => ipcRenderer.invoke(CHANNELS.retryLoad),
  openDownloadsFolder: () => ipcRenderer.invoke(CHANNELS.openDownloadsFolder),
  onDownloadState: (listener: (event: DownloadStateEvent) => void) =>
    subscribe(CHANNELS.downloadState, validateDownloadState, listener),
});
