"use client";

type NativeDebugBridge = {
  isAvailable?: boolean;
  debugLog?: (payload: unknown) => void;
};

function nativeBridge(): NativeDebugBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Brain2Native?: NativeDebugBridge }).Brain2Native ?? null;
}

export function isNativeShellBridgeAvailable(): boolean {
  const bridge = nativeBridge();
  return Boolean(bridge?.isAvailable);
}

export function emitNativeDebug(event: string, payload?: Record<string, unknown>): void {
  const bridge = nativeBridge();
  if (!bridge?.isAvailable) return;

  const message = {
    event,
    payload: payload ?? {},
    at: new Date().toISOString(),
    href: typeof location !== "undefined" ? location.href : "",
  };

  try {
    console.debug("[Brain2Debug]", message);
  } catch {
    // no-op
  }

  try {
    bridge.debugLog?.(message);
  } catch {
    // no-op
  }
}
