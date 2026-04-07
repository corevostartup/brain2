const GOOGLE_IDENTITY_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GOOGLE_IDENTITY_SCRIPT_ID = "brain2-google-identity-script";
const GOOGLE_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";

type GoogleTokenResponse = {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type GoogleTokenClient = {
  callback: (response: GoogleTokenResponse) => void;
  requestAccessToken: (options?: { prompt?: string }) => void;
};

type GoogleOAuth2Namespace = {
  initTokenClient: (options: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: unknown) => void;
  }) => GoogleTokenClient;
};

type GoogleAccountsNamespace = {
  oauth2: GoogleOAuth2Namespace;
};

type GoogleNamespace = {
  accounts: GoogleAccountsNamespace;
};

declare global {
  interface Window {
    google?: GoogleNamespace;
  }
}

export type GoogleDriveFolder = {
  id: string;
  name: string;
  webViewLink: string;
};

type GoogleDriveApiFile = {
  id?: string;
  name?: string;
  webViewLink?: string;
};

type GoogleDriveApiListResponse = {
  files?: GoogleDriveApiFile[];
};

let googleScriptPromise: Promise<void> | null = null;
let googleTokenClientPromise: Promise<GoogleTokenClient> | null = null;
let cachedToken: { accessToken: string; expiresAt: number } | null = null;

function getGoogleDriveClientId(): string {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID?.trim() ?? "";
  if (!clientId) {
    throw new Error("Configure NEXT_PUBLIC_GOOGLE_DRIVE_CLIENT_ID no .env.local para conectar ao Google Drive.");
  }
  return clientId;
}

function loadGoogleIdentityScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Drive OAuth so pode ser iniciado no navegador."));
  }

  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  const existingScript = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID) as HTMLScriptElement | null;
  if (existingScript) {
    googleScriptPromise = Promise.resolve();
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.id = GOOGLE_IDENTITY_SCRIPT_ID;
    script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Falha ao carregar Google Identity Services."));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

async function getGoogleTokenClient(): Promise<GoogleTokenClient> {
  if (googleTokenClientPromise) {
    return googleTokenClientPromise;
  }

  googleTokenClientPromise = (async () => {
    await loadGoogleIdentityScript();

    const googleNamespace = window.google;
    const initTokenClient = googleNamespace?.accounts?.oauth2?.initTokenClient;
    if (!initTokenClient) {
      throw new Error("Google Identity Services indisponivel no navegador.");
    }

    return initTokenClient({
      client_id: getGoogleDriveClientId(),
      scope: GOOGLE_DRIVE_SCOPE,
      callback: () => {
        // callback is replaced per request.
      },
    });
  })();

  return googleTokenClientPromise;
}

/** Token OAuth para chamadas à API do Drive (ex.: carregar o vault a partir de uma pasta). */
export async function requestGoogleDriveAccessToken(interactive = false): Promise<string> {
  return requestAccessToken(interactive);
}

async function requestAccessToken(interactive: boolean): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt - now > 60_000) {
    return cachedToken.accessToken;
  }

  const tokenClient = await getGoogleTokenClient();

  const response = await new Promise<GoogleTokenResponse>((resolve, reject) => {
    tokenClient.callback = (tokenResponse: GoogleTokenResponse) => {
      resolve(tokenResponse);
    };

    try {
      tokenClient.requestAccessToken({
        prompt: interactive ? "consent select_account" : "",
      });
    } catch (error) {
      reject(error);
    }
  });

  if (response.error) {
    throw new Error(response.error_description || response.error || "Falha ao autenticar no Google Drive.");
  }

  const accessToken = response.access_token;
  if (!accessToken) {
    throw new Error("Token de acesso do Google Drive nao foi retornado.");
  }

  const expiresIn = typeof response.expires_in === "number" ? response.expires_in : 3600;
  cachedToken = {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };

  return accessToken;
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function listGoogleDriveFolders(options?: {
  query?: string;
  interactive?: boolean;
}): Promise<GoogleDriveFolder[]> {
  const interactive = options?.interactive ?? false;
  let accessToken: string;

  try {
    accessToken = await requestAccessToken(interactive);
  } catch (error) {
    if (!interactive) {
      accessToken = await requestAccessToken(true);
    } else {
      throw error;
    }
  }

  const baseQuery = ["mimeType='application/vnd.google-apps.folder'", "trashed=false"];
  const searchText = options?.query?.trim() ?? "";
  if (searchText) {
    baseQuery.push(`name contains '${escapeDriveQueryValue(searchText)}'`);
  }

  const params = new URLSearchParams({
    q: baseQuery.join(" and "),
    // Inclui nextPageToken para máscara válida; "name_natural" em allDrives pode falhar em alguns casos.
    fields: "nextPageToken,files(id,name,webViewLink)",
    orderBy: "name",
    pageSize: "100",
    includeItemsFromAllDrives: "true",
    supportsAllDrives: "true",
    corpora: "allDrives",
  });

  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const message = response.status === 401
      ? "Sessao expirada do Google Drive. Tente escolher a pasta novamente."
      : "Falha ao listar pastas do Google Drive.";
    throw new Error(message);
  }

  const data = (await response.json()) as GoogleDriveApiListResponse;

  let folders: GoogleDriveFolder[] = (data.files ?? [])
    .filter((file) => Boolean(file.id))
    .map((file) => ({
      id: file.id as string,
      name: String(file.name ?? "").trim(),
      webViewLink: file.webViewLink ?? "",
    }));

  const missingName = folders.filter((f) => !f.name);
  if (missingName.length > 0) {
    const resolved: { id: string; name: string }[] = [];
    const chunkSize = 12;
    for (let i = 0; i < missingName.length; i += chunkSize) {
      const chunk = missingName.slice(i, i + chunkSize);
      const batch = await Promise.all(
        chunk.map(async (f) => ({
          id: f.id,
          name: await fetchDriveFileName(accessToken, f.id),
        }))
      );
      resolved.push(...batch);
    }
    const nameById = new Map(resolved.map((r) => [r.id, r.name]));
    folders = folders.map((f) =>
      f.name ? f : { ...f, name: nameById.get(f.id) ?? "Pasta sem nome" }
    );
  }

  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

  return folders;
}

async function fetchDriveFileName(accessToken: string, fileId: string): Promise<string> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "name");
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    return "Pasta sem nome";
  }

  const payload = (await response.json()) as { name?: string };
  const name = String(payload.name ?? "").trim();
  return name || "Pasta sem nome";
}
