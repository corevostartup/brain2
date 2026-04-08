/** Origem do vault nas configuracoes: uma opcao ativa de cada vez. */
export type VaultStorageMode = "google-drive" | "icloud" | "local";

export type CloudProvider = Exclude<VaultStorageMode, "local">;

export const CLOUD_PROVIDER_STORAGE_KEY = "brain2-cloud-provider";

const CLOUD_DIRECTORY_STORAGE_KEY_PREFIX = "brain2-cloud-directory:";
const CLOUD_DIRECTORY_LABEL_STORAGE_KEY_PREFIX = "brain2-cloud-directory-label:";

export function getCloudDirectoryStorageKey(provider: CloudProvider): string {
  return `${CLOUD_DIRECTORY_STORAGE_KEY_PREFIX}${provider}`;
}

export function getCloudDirectoryLabelStorageKey(provider: CloudProvider): string {
  return `${CLOUD_DIRECTORY_LABEL_STORAGE_KEY_PREFIX}${provider}`;
}

/** Valor salvo explicitamente ou migracao legada (pasta Drive sem modo). */
export function getVaultStorageMode(): VaultStorageMode {
  if (typeof window === "undefined") {
    return "local";
  }
  const raw = window.localStorage.getItem(CLOUD_PROVIDER_STORAGE_KEY)?.trim();
  if (raw === "icloud") return "icloud";
  if (raw === "local") return "local";
  if (raw === "google-drive") return "google-drive";
  const folderId =
    window.localStorage.getItem(getCloudDirectoryStorageKey("google-drive"))?.trim() ?? "";
  if (folderId) return "google-drive";
  return "local";
}

/** @deprecated Use getVaultStorageMode */
export function normalizeCloudProvider(value: string | null | undefined): CloudProvider {
  const mode = value?.trim();
  return mode === "icloud" ? "icloud" : "google-drive";
}

/** Pasta raiz do vault no Google Drive (localStorage), se configurada. */
export function loadGoogleDriveVaultFolderConfig(): {
  folderId: string;
  label: string;
} | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (getVaultStorageMode() !== "google-drive") {
    return null;
  }
  const folderId =
    window.localStorage.getItem(getCloudDirectoryStorageKey("google-drive"))?.trim() ?? "";
  if (!folderId) {
    return null;
  }
  const label =
    window.localStorage.getItem(getCloudDirectoryLabelStorageKey("google-drive"))?.trim() ?? "";
  return { folderId, label };
}
