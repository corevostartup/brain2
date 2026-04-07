export type CloudProvider = "google-drive" | "icloud";

export const CLOUD_PROVIDER_STORAGE_KEY = "brain2-cloud-provider";

const CLOUD_DIRECTORY_STORAGE_KEY_PREFIX = "brain2-cloud-directory:";
const CLOUD_DIRECTORY_LABEL_STORAGE_KEY_PREFIX = "brain2-cloud-directory-label:";

export function getCloudDirectoryStorageKey(provider: CloudProvider): string {
  return `${CLOUD_DIRECTORY_STORAGE_KEY_PREFIX}${provider}`;
}

export function getCloudDirectoryLabelStorageKey(provider: CloudProvider): string {
  return `${CLOUD_DIRECTORY_LABEL_STORAGE_KEY_PREFIX}${provider}`;
}

export function normalizeCloudProvider(value: string | null | undefined): CloudProvider {
  return value === "icloud" ? "icloud" : "google-drive";
}

/** Pasta raiz do vault no Google Drive (localStorage), se configurada. */
export function loadGoogleDriveVaultFolderConfig(): {
  folderId: string;
  label: string;
} | null {
  if (typeof window === "undefined") {
    return null;
  }
  const provider = normalizeCloudProvider(window.localStorage.getItem(CLOUD_PROVIDER_STORAGE_KEY));
  if (provider !== "google-drive") {
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
