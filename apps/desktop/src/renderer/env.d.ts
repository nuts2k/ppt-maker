import type { IpcApi } from "../main/ipc/channels.js";

declare global {
  interface Window {
    api: IpcApi;
  }
}
