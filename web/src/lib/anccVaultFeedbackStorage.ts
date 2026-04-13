/**
 * Feedback explícito do utilizador sobre notas do vault usadas na última resposta (localStorage).
 * Valores em [-1, 1]: negativo = não ajudou, positivo = ajudou.
 */

import { normalizeVaultPathKey } from "@/ancc/agents/plasticity-agent";

const STORAGE_KEY = "brain2.ancc.vaultPathFeedback.v1";

function safeParse(raw: string | null): Record<string, number> {
  if (!raw) {
    return {};
  }
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== "object") {
      return {};
    }
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        out[k] = Math.max(-1, Math.min(1, v));
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function loadVaultPathFeedbackMap(): Record<string, number> {
  if (typeof window === "undefined") {
    return {};
  }
  return safeParse(window.localStorage.getItem(STORAGE_KEY));
}

export function saveVaultPathFeedbackMap(map: Record<string, number>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

/**
 * Regista feedback para um caminho de nota (normalizado internamente).
 */
export function recordVaultPathFeedback(path: string, helpful: boolean): void {
  const k = normalizeVaultPathKey(path);
  const cur = loadVaultPathFeedbackMap();
  const prev = cur[k] ?? 0;
  const delta = helpful ? 0.38 : -0.48;
  cur[k] = Math.max(-1, Math.min(1, prev + delta));
  saveVaultPathFeedbackMap(cur);
}

export function clearVaultPathFeedback(): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
