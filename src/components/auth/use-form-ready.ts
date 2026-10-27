"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

// Credential forms must not submit as native GET requests before React
// attaches their submit handlers. The server-rendered button starts disabled.
export function useFormReady() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
