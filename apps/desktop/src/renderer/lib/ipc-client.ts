import type { IpcApi } from "../../main/ipc/channels.js";

export function getApi(): IpcApi {
  return window.api;
}
