"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  getRedirectResult,
  onAuthStateChanged,
  signOut,
  signInWithPopup,
  signInWithRedirect,
  type User,
} from "firebase/auth";
import InputBar from "@/components/InputBar";
import DesktopSidebar from "@/components/DesktopSidebar";
import BrainGraphView from "@/components/BrainGraphView";
import ConversationView from "@/components/ConversationView";
import ChatView from "@/components/ChatView";
import SettingsView from "@/components/SettingsView";
import LoginView from "@/components/LoginView";
import AuthSplashScreen from "@/components/AuthSplashScreen";
import {
  WebDirectoryOnboarding,
  BRAIN2_TESTING_ALWAYS_SHOW_WEB_ONBOARDING,
  readWebDirectoryOnboardingCompleted,
  WEB_DIRECTORY_ONBOARDING_KEY,
} from "@/components/WebDirectoryOnboarding";
import AdvancedVoiceSphereView from "@/components/AdvancedVoiceSphereView";
import { PanelLeftOpen } from "lucide-react";
import {
  type VaultConversation,
  type VaultGraph,
  type FolderTreeNode,
} from "@/lib/vault";
import type { ChatMessage } from "@/lib/chat";
import {
  getFirebaseAuthClient,
  getFirebaseConfigError,
  getGoogleAuthProvider,
  signInWithGoogleNativeIdToken,
} from "@/lib/firebaseClient";
import {
  logFirestoreRegistrationError,
  registerOrUpdateUserInFirestore,
} from "@/lib/firestoreUser";
import {
  CLOUD_PROVIDER_STORAGE_KEY,
  loadGoogleDriveVaultFolderConfig,
} from "@/lib/vaultCloudConfig";
import {
  coerceNativeVaultGraph,
  fingerprintNativeVaultState,
} from "@/lib/nativeVaultPayload";
import {
  loadCentralBrainNameFromStorage,
  saveCentralBrainNameToStorage,
  VAULT_LOOSE_MEMORIES_FOLDER_NAME,
} from "@/lib/brain2CentralFolder";
import { emitNativeDebug, isNativeShellBridgeAvailable } from "@/lib/nativeDebug";
import { requestGoogleDriveAccessToken } from "@/lib/googleDrive";
import { loadVaultFromGoogleDriveFolder } from "@/lib/googleDriveVault";
import { buildConversationOnlyVaultGraph } from "@/lib/vaultConversationGraph";
import {
  processInteraction,
  createDefaultANCCSession,
  finalizeInteractionAfterResponse,
  enrichAnccProcessResultWithOutcome,
  type ANCCProcessResult,
  type VaultCorrelationHit,
} from "@/ancc";
import { buildBrain2BaseSystemPrompt } from "@/lib/brain2SystemPrompt";
import { buildVaultSnapshotsForAncc } from "@/lib/anccVaultSnapshots";
import { buildAnccRecentBullets } from "@/lib/anccRecentContext";
import { appendRollingSessionSummary } from "@/lib/anccRollingSummary";
import { buildVaultConversationMarkdown } from "@/lib/vaultConversationMarkdown";

type PresetVaultResponse = {
  path: string;
  folders: FolderTreeNode[];
  graph: VaultGraph;
  conversations: VaultConversation[];
  centralBrainFolderName?: string | null;
};

type VaultMutationPayload =
  | {
      action: "create-folder";
      parentPath: string;
      folderName: string;
    }
  | {
      action: "rename-folder";
      folderPath: string;
      newFolderName: string;
    }
  | {
      action: "delete-folder";
      folderPath: string;
    }
  | {
      action: "rename-conversation";
      conversationPath: string;
      newTitle: string;
    }
  | {
      action: "delete-conversation";
      conversationPath: string;
    }
  | {
      action: "save-conversation";
      conversationId: string;
      title: string;
      markdown: string;
      folderPath?: string;
    };

type NativeVaultPayload = {
  path?: string;
  folders?: FolderTreeNode[];
  graph?: VaultGraph | null;
  conversations?: VaultConversation[];
  centralBrainFolderName?: string;
};

type NativeBridge = {
  isAvailable?: boolean;
  startGoogleSignIn?: () => void;
  pickDirectory?: () => void;
  debugLog?: (payload: unknown) => void;
  saveConversation?: (payload: {
    conversationId: string;
    title: string;
    markdown: string;
    folderPath?: string;
  }) => void;
  createFolder?: (payload: { parentPath: string; folderName: string }) => void;
  renameFolder?: (payload: { folderPath: string; newFolderName: string }) => void;
};

/** Aguarda o resultado da criacao/renomeacao de pastas no shell macOS (sandbox + bookmark). */
function callNativeFolderMutation(call: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutMs = 120_000;
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener("brain2-native-folder-mutation-result", onResult);
      window.alert("A operacao demorou demais. Tente novamente.");
      reject(new Error("brain2-native-folder-mutation-timeout"));
    }, timeoutMs);

    const onResult = (ev: Event) => {
      window.clearTimeout(timeoutId);
      window.removeEventListener("brain2-native-folder-mutation-result", onResult);
      const detail = (ev as CustomEvent<{ success?: boolean; error?: string }>).detail;
      if (detail?.success) {
        resolve();
        return;
      }
      const msg = detail?.error?.trim() || "Nao foi possivel concluir a operacao.";
      window.alert(msg);
      reject(new Error(msg));
    };

    window.addEventListener("brain2-native-folder-mutation-result", onResult, { once: true });
    try {
      call();
    } catch (error) {
      window.clearTimeout(timeoutId);
      window.removeEventListener("brain2-native-folder-mutation-result", onResult);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

const BRAIN2_SHELL_SESSION_KEY = "brain2-shell-persist";

/** Shell macOS via query (?brain2-shell=macos) injetado pelo WKWebView — não depender só da bridge (ainda não existe no 1º paint). */
function detectBrain2MacShellQuery(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).get("brain2-shell") === "macos";
  } catch {
    return false;
  }
}

/**
 * Deteta app nativa Mac. Importante: o Next.js remove query params nas navegações — por isso persistimos em sessionStorage
 * na primeira carga com ?brain2-shell=macos (senão `isNativeMacShell` voltava a false e o onboarding nativo deixava de ser pedido).
 */
function isBrain2NativeAppShell(): boolean {
  if (typeof window === "undefined") return false;
  if (detectBrain2MacShellQuery()) {
    try {
      sessionStorage.setItem(BRAIN2_SHELL_SESSION_KEY, "macos");
    } catch {
      /* ignore */
    }
    return true;
  }
  try {
    if (sessionStorage.getItem(BRAIN2_SHELL_SESSION_KEY) === "macos") {
      return true;
    }
  } catch {
    /* ignore */
  }
  return isNativeShellBridgeAvailable();
}


function buildChatTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user");
  if (!firstUser) {
    return "Brain2 Conversation";
  }
  const compact = firstUser.content.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "Brain2 Conversation";
  }
  return compact.length > 72 ? `${compact.slice(0, 72)}...` : compact;
}

function sanitizeFileName(raw: string): string {
  const sanitized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "conversation";
}

function formatConversationFileTitle(raw: string): string {
  const cleaned = raw
    .replace(/[._-]+/g, " ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "Conversation";
  }

  return cleaned
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function createConversationRecordId(seed: string): string {
  const timestamp = Date.now().toString(36);
  return `chat-${timestamp}-${seed}`;
}

function normalizeFolderPath(folderPath: string | null | undefined): string | null {
  const normalized = (folderPath ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");

  return normalized || null;
}

function folderPathExists(nodes: FolderTreeNode[], targetPath: string, parentPath = ""): boolean {
  for (const node of nodes) {
    if (node.kind !== "folder") {
      continue;
    }

    const currentPath = parentPath ? `${parentPath}/${node.name}` : node.name;
    if (currentPath === targetPath) {
      return true;
    }

    if (folderPathExists(node.children, targetPath, currentPath)) {
      return true;
    }
  }

  return false;
}

function normalizeGraphNodeId(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function sanitizeVaultGraph(graph: VaultGraph): VaultGraph {
  const nodeLabelById = new Map<string, string>();

  for (const node of graph.nodes) {
    const rawId = typeof node.id === "string" ? node.id : String(node.id ?? "");
    const id = normalizeGraphNodeId(rawId);
    if (!id) continue;
    const labelSource = (node.label ?? "").trim();
    if (!nodeLabelById.has(id)) {
      nodeLabelById.set(id, labelSource || rawId.trim() || id);
    }
  }

  const edgeSet = new Set<string>();
  const edges: Array<{ source: string; target: string }> = [];

  for (const edge of graph.edges) {
    const source = normalizeGraphNodeId(typeof edge.source === "string" ? edge.source : String(edge.source ?? ""));
    const target = normalizeGraphNodeId(typeof edge.target === "string" ? edge.target : String(edge.target ?? ""));
    if (!source || !target || source === target) {
      continue;
    }

    // Garantia forte: qualquer endpoint de aresta vira nó válido.
    if (!nodeLabelById.has(source)) {
      nodeLabelById.set(source, source);
    }
    if (!nodeLabelById.has(target)) {
      nodeLabelById.set(target, target);
    }

    const edgeKey = source < target ? `${source}::${target}` : `${target}::${source}`;
    if (edgeSet.has(edgeKey)) {
      continue;
    }
    edgeSet.add(edgeKey);
    edges.push({ source, target });
  }

  const nodes = Array.from(nodeLabelById.entries()).map(([id, label]) => ({ id, label }));
  return { nodes, edges };
}

function normalizeGraph(
  graph: VaultGraph | null | undefined,
  conversations: VaultConversation[]
): VaultGraph | null {
  const hasValidGraph = Boolean(graph && Array.isArray(graph.nodes) && Array.isArray(graph.edges));
  if (hasValidGraph && (graph?.nodes.length ?? 0) > 0) {
    return sanitizeVaultGraph(graph ?? { nodes: [], edges: [] });
  }

  if (conversations.length === 0) {
    return hasValidGraph ? sanitizeVaultGraph(graph ?? { nodes: [], edges: [] }) : null;
  }

  return buildConversationOnlyVaultGraph(conversations);
}

/** Tempo minimo da splash; o Firebase pode resolver a sessao em poucos ms. */
const MIN_AUTH_SPLASH_MS = 2800;

export default function Home() {
  const [isAuthInitializing, setIsAuthInitializing] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSidebarHidden, setIsSidebarHidden] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isYourBrainOpen, setIsYourBrainOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdvancedVoiceOpen, setIsAdvancedVoiceOpen] = useState(false);
  const [vaultGraph, setVaultGraph] = useState<VaultGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [vaultFolders, setVaultFolders] = useState<FolderTreeNode[]>([]);
  const [vaultConversations, setVaultConversations] = useState<VaultConversation[]>([]);
  const [vaultPath, setVaultPath] = useState("");
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [returnToYourBrainOnConversationClose, setReturnToYourBrainOnConversationClose] = useState(false);
  const [hasNativeVaultData, setHasNativeVaultData] = useState(false);
  /** Atualizado em sync dentro de `applyVaultData` para evitar corrida com fetch do preset a sobrescrever o vault WKWebView. */
  const hasNativeVaultDataRef = useRef(false);
  /** Evita reaplicar o mesmo payload nativo; inclui max(modifiedAt) para detetar ficheiros alterados. */
  const lastNativeVaultFingerprintRef = useRef<string>("");
  const activeViewTraceRef = useRef<string>("");
  const [hasCloudVaultData, setHasCloudVaultData] = useState(false);
  const [vaultDataVersion, setVaultDataVersion] = useState(0);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [chatSessionStartedAt, setChatSessionStartedAt] = useState<number | null>(null);
  const [chatSessionFolderPath, setChatSessionFolderPath] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  /** Estado ANCC (plasticidade + recorrência) por sessão de chat no browser. */
  const anccSessionRef = useRef(createDefaultANCCSession());
  /** Resumo rolante da conversa (query enriquecida para retrieval híbrido). */
  const anccRollingSummaryRef = useRef("");
  const [isNativeMacShell, setIsNativeMacShell] = useState(() =>
    typeof window !== "undefined" && isBrain2NativeAppShell(),
  );
  /** null = ainda não leu localStorage (evita flash no SSR); só browser — no shell Mac o onboarding é nativo Swift. */
  const [webDirectoryOnboardingDone, setWebDirectoryOnboardingDone] = useState<boolean | null>(null);
  /** Na fase de testes (sempre mostrar), fecha só nesta sessão até novo login. */
  const [webOnboardingDismissedThisSession, setWebOnboardingDismissedThisSession] = useState(false);

  useEffect(() => {
    setWebDirectoryOnboardingDone(readWebDirectoryOnboardingCompleted());
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      setWebOnboardingDismissedThisSession(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    const syncNativeShell = () => setIsNativeMacShell(isBrain2NativeAppShell());
    syncNativeShell();
    window.addEventListener("brain2-native-bridge-ready", syncNativeShell);
    return () => window.removeEventListener("brain2-native-bridge-ready", syncNativeShell);
  }, []);

  useEffect(() => {
    document.body.style.opacity = "1";
    document.body.style.visibility = "visible";
    document.body.style.transition = "opacity 120ms ease-out";
  }, []);

  useEffect(() => {
    const splashStartMs = Date.now();
    let splashHideTimer: ReturnType<typeof setTimeout> | null = null;
    let splashEndScheduled = false;

    const scheduleSplashEnd = () => {
      if (splashEndScheduled) {
        return;
      }
      splashEndScheduled = true;
      const elapsed = Date.now() - splashStartMs;
      const remaining = Math.max(0, MIN_AUTH_SPLASH_MS - elapsed);
      splashHideTimer = setTimeout(() => {
        setIsAuthInitializing(false);
        splashHideTimer = null;
      }, remaining);
    };

    const configError = getFirebaseConfigError();
    if (configError) {
      setAuthError(configError);
      setIsAuthenticated(false);
      scheduleSplashEnd();
      return () => {
        if (splashHideTimer) {
          clearTimeout(splashHideTimer);
        }
      };
    }

    let unsubscribed = false;
    let unsubscribeAuth: (() => void) | undefined;
    const auth = getFirebaseAuthClient();

    void (async () => {
      try {
        await getRedirectResult(auth);
      } catch (error: unknown) {
        if (unsubscribed) {
          return;
        }
        const code = (error as { code?: string }).code;
        const message = error instanceof Error ? error.message : String(error);
        if (code !== "auth/operation-not-supported-in-this-environment") {
          setAuthError(message || "Falha ao concluir o login apos o retorno do Google.");
        }
      }

      if (unsubscribed) {
        return;
      }

      unsubscribeAuth = onAuthStateChanged(auth, (user: User | null) => {
        if (unsubscribed) {
          return;
        }

        setAuthUser(user);
        setIsAuthenticated(Boolean(user));
        setAuthError(null);
        scheduleSplashEnd();

        if (user) {
          void registerOrUpdateUserInFirestore(user).catch((err) => {
            logFirestoreRegistrationError(err);
          });
        }
      });
    })();

    return () => {
      unsubscribed = true;
      unsubscribeAuth?.();
      if (splashHideTimer) {
        clearTimeout(splashHideTimer);
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !isBrain2NativeAppShell()) {
      return;
    }

    const onTokens = async (ev: Event) => {
      const custom = ev as CustomEvent<{ idToken?: string; accessToken?: string }>;
      const idToken = custom.detail?.idToken;
      if (!idToken) {
        return;
      }
      const configError = getFirebaseConfigError();
      if (configError) {
        setAuthError(configError);
        return;
      }
      try {
        setAuthError(null);
        await signInWithGoogleNativeIdToken(idToken, custom.detail?.accessToken);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Falha ao entrar com a conta Google (app Mac).";
        setAuthError(message);
      }
    };

    const onNativeError = (ev: Event) => {
      const custom = ev as CustomEvent<{ message?: string }>;
      const message = custom.detail?.message?.trim();
      if (message) {
        setAuthError(message);
      }
    };

    window.addEventListener("brain2-native-google-tokens", onTokens);
    window.addEventListener("brain2-native-google-signin-error", onNativeError);
    return () => {
      window.removeEventListener("brain2-native-google-tokens", onTokens);
      window.removeEventListener("brain2-native-google-signin-error", onNativeError);
    };
  }, []);

  /** macOS shell: pede onboarding ao nativo quando a sessão está ativa. Repete às vezes até a bridge existir (corrida inject vs React). */
  useEffect(() => {
    if (typeof window === "undefined" || !isAuthenticated || !isNativeMacShell) {
      return;
    }
    const requestOnboarding = () => {
      try {
        const w = window as Window & {
          Brain2Native?: { requestDirectoryOnboarding?: () => void };
        };
        w.Brain2Native?.requestDirectoryOnboarding?.();
      } catch {
        /* ignore */
      }
    };
    if (document.documentElement.hasAttribute("data-brain2-native")) {
      requestOnboarding();
    } else {
      window.addEventListener("brain2-native-bridge-ready", requestOnboarding, { once: true });
    }
    let n = 0;
    const interval = window.setInterval(() => {
      n += 1;
      requestOnboarding();
      if (n >= 8) window.clearInterval(interval);
    }, 400);
    return () => {
      window.clearInterval(interval);
    };
  }, [isAuthenticated, isNativeMacShell]);

  const selectedConversation = useMemo(
    () => vaultConversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [selectedConversationId, vaultConversations]
  );

  const chatTitle = useMemo(() => {
    if (chatMessages.length === 0) {
      return "Nova conversa";
    }
    return buildChatTitle(chatMessages);
  }, [chatMessages]);

  const activeView = isAdvancedVoiceOpen
    ? "advanced-voice"
    : isSettingsOpen
    ? "settings"
    : isYourBrainOpen
      ? "brain"
      : selectedConversation
        ? "conversation"
        : isChatOpen || chatMessages.length > 0 || chatLoading || Boolean(chatError)
          ? "chat"
        : "home";

  useEffect(() => {
    const previous = activeViewTraceRef.current;
    if (previous === activeView) {
      return;
    }
    activeViewTraceRef.current = activeView;
    emitNativeDebug("page-active-view", {
      from: previous || null,
      to: activeView,
      isYourBrainOpen,
      isChatOpen,
      isSettingsOpen,
      isAdvancedVoiceOpen,
      hasSelectedConversation: Boolean(selectedConversationId),
      hasNativeVaultData,
      hasCloudVaultData,
      graphNodes: vaultGraph?.nodes?.length ?? 0,
      graphEdges: vaultGraph?.edges?.length ?? 0,
    });
  }, [
    activeView,
    hasCloudVaultData,
    hasNativeVaultData,
    isAdvancedVoiceOpen,
    isChatOpen,
    isSettingsOpen,
    isYourBrainOpen,
    selectedConversationId,
    vaultGraph?.edges?.length,
    vaultGraph?.nodes?.length,
  ]);

  const createMessageId = useCallback(() => {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }, []);

  const applyVaultData = useCallback((
    data: {
      path?: string;
      folders?: FolderTreeNode[];
      graph?: VaultGraph | null;
      conversations?: VaultConversation[];
      centralBrainFolderName?: string | null;
    },
    options?: { markAsNative?: boolean; markAsCloud?: boolean }
  ) => {
    const centralFromPayload = data.centralBrainFolderName?.trim();
    if (centralFromPayload) {
      saveCentralBrainNameToStorage(centralFromPayload);
    }

    const nextFolders = data.folders ?? [];
    const nextConversations = data.conversations ?? [];
    const nextGraph = normalizeGraph(data.graph, nextConversations);

    const markNative = Boolean(options?.markAsNative);
    setHasNativeVaultData(markNative);
    hasNativeVaultDataRef.current = markNative;
    if (!markNative) {
      lastNativeVaultFingerprintRef.current = "";
    }
    setHasCloudVaultData(Boolean(options?.markAsCloud));
    if (typeof window !== "undefined") {
      if (markNative) {
        window.localStorage.setItem(CLOUD_PROVIDER_STORAGE_KEY, "local");
      } else if (options?.markAsCloud) {
        window.localStorage.setItem(CLOUD_PROVIDER_STORAGE_KEY, "google-drive");
      }
    }
    setVaultPath(data.path ?? "");
    setVaultFolders(nextFolders);
    setVaultGraph(nextGraph);
    setVaultConversations(nextConversations);
    setSelectedFolderPath((previous) => {
      const normalizedPrevious = normalizeFolderPath(previous);
      if (!normalizedPrevious) {
        return previous;
      }

      return folderPathExists(nextFolders, normalizedPrevious)
        ? normalizedPrevious
        : null;
    });
    setSelectedConversationId(null);
    setReturnToYourBrainOnConversationClose(false);
    setGraphLoading(false);
    setVaultDataVersion((value) => value + 1);
  }, []);

  const loadPresetVaultData = useCallback(async (options?: { force?: boolean }) => {
    if (hasNativeVaultData && !options?.force) {
      return;
    }

    const abortIfNativeWon = () => {
      if (hasNativeVaultDataRef.current && !options?.force) {
        setGraphLoading(false);
        return true;
      }
      return false;
    };

    setGraphLoading(true);
    if (abortIfNativeWon()) {
      return;
    }

    try {
      const cloudConfig = loadGoogleDriveVaultFolderConfig();
      if (cloudConfig) {
        let cloudLoaded = false;
        for (const interactive of [false, true] as const) {
          if (abortIfNativeWon()) {
            return;
          }
          try {
            const token = await requestGoogleDriveAccessToken(interactive);
            if (abortIfNativeWon()) {
              return;
            }
            const data = await loadVaultFromGoogleDriveFolder(
              cloudConfig.folderId,
              token,
              cloudConfig.label
            );
            if (abortIfNativeWon()) {
              return;
            }
            applyVaultData(
              {
                path: data.path,
                folders: data.folders,
                graph: data.graph,
                conversations: data.conversations,
                centralBrainFolderName: loadCentralBrainNameFromStorage(),
              },
              { markAsNative: false, markAsCloud: true }
            );
            cloudLoaded = true;
            break;
          } catch {
            /* tenta token interativo ou cai para preset */
          }
        }
        if (cloudLoaded) {
          return;
        }
      }

      if (abortIfNativeWon()) {
        return;
      }

      const response = await fetch("/api/vault", { cache: "no-store" });
      if (abortIfNativeWon()) {
        return;
      }
      if (!response.ok) {
        throw new Error("Falha ao carregar vault preset");
      }
      const data = (await response.json()) as PresetVaultResponse;
      if (abortIfNativeWon()) {
        return;
      }
      applyVaultData(
        {
          path: data.path,
          folders: data.folders,
          graph: data.graph,
          conversations: data.conversations,
          centralBrainFolderName: data.centralBrainFolderName ?? null,
        },
        { markAsNative: false, markAsCloud: false }
      );
    } catch {
      if (abortIfNativeWon()) {
        return;
      }
      applyVaultData(
        {
          path: "",
          folders: [],
          graph: null,
          conversations: [],
        },
        { markAsNative: false, markAsCloud: false }
      );
    }
  }, [hasNativeVaultData, applyVaultData]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const tryConsumeNativeWindowState = () => {
      const w = window as Window & { Brain2NativeState?: NativeVaultPayload };
      const state = w.Brain2NativeState;
      if (!state?.path?.trim()) {
        return;
      }

      const coercedGraph = coerceNativeVaultGraph(state.graph);
      const graph = coercedGraph !== undefined ? coercedGraph : state.graph;

      const fp = fingerprintNativeVaultState({
        path: state.path,
        graph: graph as VaultGraph | null | undefined,
        conversations: state.conversations,
      });

      emitNativeDebug("native-vault-state-seen", {
        fingerprint: fp,
        path: state.path ?? "",
        folders: state.folders?.length ?? 0,
        conversations: state.conversations?.length ?? 0,
        graphNodes: (graph as VaultGraph | null | undefined)?.nodes?.length ?? 0,
        graphEdges: (graph as VaultGraph | null | undefined)?.edges?.length ?? 0,
      });

      if (fp === lastNativeVaultFingerprintRef.current) {
        emitNativeDebug("native-vault-state-ignored-duplicate", { fingerprint: fp });
        return;
      }
      lastNativeVaultFingerprintRef.current = fp;

      applyVaultData(
        {
          path: state.path,
          folders: state.folders,
          graph,
          conversations: state.conversations,
          centralBrainFolderName: state.centralBrainFolderName,
        },
        { markAsNative: true, markAsCloud: false }
      );
    };

    const onNativeVaultEvent = (_event: Event) => {
      tryConsumeNativeWindowState();
    };

    window.addEventListener("brain2-native-vault-selected", onNativeVaultEvent);
    window.addEventListener("brain2-native-bridge-ready", onNativeVaultEvent);

    tryConsumeNativeWindowState();

    const retryDelaysMs = isBrain2NativeAppShell()
      ? [32, 120, 350, 800, 1600, 3200]
      : [];
    const timeoutIds = retryDelaysMs.map((ms) =>
      window.setTimeout(() => {
        tryConsumeNativeWindowState();
      }, ms),
    );

    return () => {
      window.removeEventListener("brain2-native-vault-selected", onNativeVaultEvent);
      window.removeEventListener("brain2-native-bridge-ready", onNativeVaultEvent);
      timeoutIds.forEach(clearTimeout);
    };
  }, [applyVaultData, isAuthenticated]);

  useEffect(() => {
    const onCentralBrainReady = (ev: Event) => {
      const detail = (ev as CustomEvent<{ centralBrainFolderName?: string }>).detail;
      const n = detail?.centralBrainFolderName?.trim();
      if (n) {
        saveCentralBrainNameToStorage(n);
      }
    };
    window.addEventListener("brain2-native-central-brain-ready", onCentralBrainReady);
    return () => window.removeEventListener("brain2-native-central-brain-ready", onCentralBrainReady);
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    void loadPresetVaultData();
  }, [isAuthenticated, loadPresetVaultData]);

  useEffect(() => {
    if (selectedConversationId && !selectedConversation) {
      setSelectedConversationId(null);
    }
  }, [selectedConversationId, selectedConversation]);

  // When opening brain view, build graph from vault
  const handleOpenBrain = useCallback(async () => {
    setIsChatOpen(false);
    setIsSettingsOpen(false);
    setIsAdvancedVoiceOpen(false);
    setIsYourBrainOpen(true);
    if (!hasNativeVaultData && !hasCloudVaultData) {
      await loadPresetVaultData();
    }
  }, [hasNativeVaultData, hasCloudVaultData, loadPresetVaultData]);

  const handleOpenAdvancedVoice = useCallback(() => {
    setIsChatOpen(false);
    setIsSettingsOpen(false);
    setIsYourBrainOpen(false);
    setSelectedConversationId(null);
    setReturnToYourBrainOnConversationClose(false);
    setIsAdvancedVoiceOpen(true);
  }, []);

  const handleVaultChange = useCallback(() => {
    setHasNativeVaultData(false);
    hasNativeVaultDataRef.current = false;
    lastNativeVaultFingerprintRef.current = "";
    setHasCloudVaultData(false);
    void loadPresetVaultData({ force: true });
  }, [loadPresetVaultData]);

  const mutatePresetVaultData = useCallback(async (
    payload: VaultMutationPayload
  ): Promise<PresetVaultResponse | null> => {
    setGraphLoading(true);
    try {
      const response = await fetch("/api/vault", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as PresetVaultResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Falha ao atualizar item no vault.");
      }

      applyVaultData(
        {
          path: data.path,
          folders: data.folders,
          graph: data.graph,
          conversations: data.conversations,
          centralBrainFolderName: data.centralBrainFolderName ?? null,
        },
        { markAsNative: false, markAsCloud: false }
      );

      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao atualizar o vault.";
      window.alert(message);
      return null;
    } finally {
      setGraphLoading(false);
    }
  }, [applyVaultData]);

  const handleCreateFolder = useCallback(async (parentPath: string, folderName: string) => {
    if (hasCloudVaultData) {
      window.alert("Nova pasta ainda nao esta disponivel para o vault no Google Drive (somente leitura).");
      return;
    }

    const safeFolderName = folderName.trim();
    if (!safeFolderName) {
      return;
    }

    if (safeFolderName.includes("/") || safeFolderName.includes("\\")) {
      window.alert("O nome da pasta nao pode conter / ou \\\\.");
      return;
    }

    if (hasNativeVaultData) {
      const bridge = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native;
      if (typeof bridge?.createFolder !== "function") {
        window.alert("Atualize a app Brain2 no Mac para criar pastas no vault local.");
        return;
      }
      try {
        await callNativeFolderMutation(() =>
          bridge.createFolder!({ parentPath, folderName: safeFolderName })
        );
      } catch {
        throw new Error("create-folder-failed");
      }
      const nextSelectedPath = parentPath ? `${parentPath}/${safeFolderName}` : safeFolderName;
      setSelectedFolderPath(nextSelectedPath);
      return;
    }

    const result = await mutatePresetVaultData({
      action: "create-folder",
      parentPath,
      folderName: safeFolderName,
    });

    if (!result) {
      throw new Error("create-folder-failed");
    }

    const nextSelectedPath = parentPath ? `${parentPath}/${safeFolderName}` : safeFolderName;
    setSelectedFolderPath(nextSelectedPath);
  }, [hasNativeVaultData, hasCloudVaultData, mutatePresetVaultData]);

  const handleDeleteFolder = useCallback(async (folderPath: string) => {
    if (hasNativeVaultData || hasCloudVaultData) {
      window.alert(
        hasCloudVaultData
          ? "Excluir pasta ainda nao esta disponivel para o vault no Google Drive (somente leitura)."
          : "Excluir pasta via menu lateral ainda nao esta disponivel para o vault nativo."
      );
      return;
    }

    const confirmed = window.confirm(
      `Excluir a pasta \"${folderPath}\" e todo o conteudo dela? Esta acao nao pode ser desfeita.`
    );
    if (!confirmed) {
      return;
    }

    const result = await mutatePresetVaultData({
      action: "delete-folder",
      folderPath,
    });

    if (
      result &&
      selectedFolderPath &&
      (selectedFolderPath === folderPath || selectedFolderPath.startsWith(`${folderPath}/`))
    ) {
      setSelectedFolderPath(null);
    }
  }, [hasNativeVaultData, hasCloudVaultData, mutatePresetVaultData, selectedFolderPath]);

  const handleRenameFolder = useCallback(async (folderPath: string, nextFolderNameRaw: string) => {
    if (hasCloudVaultData) {
      window.alert("Renomear pasta ainda nao esta disponivel para o vault no Google Drive (somente leitura).");
      return;
    }

    const nextFolderName = nextFolderNameRaw.trim();
    if (!nextFolderName) {
      return;
    }

    if (nextFolderName.includes("/") || nextFolderName.includes("\\")) {
      window.alert("O nome da pasta nao pode conter / ou \\\\.");
      return;
    }

    const normalizedFolderPath = folderPath.replace(/\\/g, "/");
    const slashIndex = normalizedFolderPath.lastIndexOf("/");
    const parentPrefix = slashIndex >= 0 ? `${normalizedFolderPath.slice(0, slashIndex + 1)}` : "";
    const renamedFolderPath = `${parentPrefix}${nextFolderName}`;

    if (hasNativeVaultData) {
      const bridge = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native;
      if (typeof bridge?.renameFolder !== "function") {
        window.alert("Atualize a app Brain2 no Mac para renomear pastas no vault local.");
        return;
      }
      try {
        await callNativeFolderMutation(() =>
          bridge.renameFolder!({
            folderPath: normalizedFolderPath,
            newFolderName: nextFolderName,
          })
        );
      } catch {
        throw new Error("rename-folder-failed");
      }

      setSelectedFolderPath((previous) => {
        if (!previous) {
          return previous;
        }

        if (previous === normalizedFolderPath) {
          return renamedFolderPath;
        }

        if (previous.startsWith(`${normalizedFolderPath}/`)) {
          return `${renamedFolderPath}${previous.slice(normalizedFolderPath.length)}`;
        }

        return previous;
      });
      return;
    }

    const result = await mutatePresetVaultData({
      action: "rename-folder",
      folderPath,
      newFolderName: nextFolderName,
    });

    if (!result) {
      throw new Error("rename-folder-failed");
    }

    setSelectedFolderPath((previous) => {
      if (!previous) {
        return previous;
      }

      if (previous === normalizedFolderPath) {
        return renamedFolderPath;
      }

      if (previous.startsWith(`${normalizedFolderPath}/`)) {
        return `${renamedFolderPath}${previous.slice(normalizedFolderPath.length)}`;
      }

      return previous;
    });
  }, [hasNativeVaultData, hasCloudVaultData, mutatePresetVaultData]);

  const handleRenameConversation = useCallback(async (conversationPath: string, nextTitleRaw: string) => {
    if (hasNativeVaultData || hasCloudVaultData) {
      window.alert(
        hasCloudVaultData
          ? "Renomear conversa ainda nao esta disponivel para o vault no Google Drive (somente leitura)."
          : "Renomear conversa via menu lateral ainda nao esta disponivel para o vault nativo."
      );
      return;
    }

    const nextTitle = nextTitleRaw.trim();
    if (!nextTitle) {
      return;
    }

    if (nextTitle.includes("/") || nextTitle.includes("\\")) {
      window.alert("O nome da conversa nao pode conter / ou \\\\.");
      return;
    }

    const result = await mutatePresetVaultData({
      action: "rename-conversation",
      conversationPath,
      newTitle: nextTitle,
    });

    if (result && selectedConversationId === conversationPath.toLowerCase()) {
      const normalizedPath = conversationPath.replace(/\\/g, "/");
      const slashIndex = normalizedPath.lastIndexOf("/");
      const baseDir = slashIndex >= 0 ? normalizedPath.slice(0, slashIndex + 1) : "";
      setSelectedConversationId(`${baseDir}${nextTitle}.md`.toLowerCase());
    }
  }, [hasNativeVaultData, hasCloudVaultData, mutatePresetVaultData, selectedConversationId]);

  const handleDeleteConversation = useCallback(async (conversationPath: string, conversationTitle: string) => {
    if (hasNativeVaultData || hasCloudVaultData) {
      window.alert(
        hasCloudVaultData
          ? "Excluir conversa ainda nao esta disponivel para o vault no Google Drive (somente leitura)."
          : "Excluir conversa via menu lateral ainda nao esta disponivel para o vault nativo."
      );
      return;
    }

    const confirmed = window.confirm(
      `Excluir a conversa \"${conversationTitle}\"? Esta acao nao pode ser desfeita.`
    );
    if (!confirmed) {
      return;
    }

    const result = await mutatePresetVaultData({
      action: "delete-conversation",
      conversationPath,
    });

    if (result && selectedConversationId === conversationPath.toLowerCase()) {
      setSelectedConversationId(null);
    }
  }, [hasNativeVaultData, hasCloudVaultData, mutatePresetVaultData, selectedConversationId]);

  const handleConversationSelect = useCallback((
    conversation: VaultConversation,
    options?: { fromYourBrain?: boolean }
  ) => {
    setIsChatOpen(false);
    setIsSettingsOpen(false);
    setIsYourBrainOpen(false);
    setIsAdvancedVoiceOpen(false);
    setSelectedConversationId(conversation.id);
    setReturnToYourBrainOnConversationClose(Boolean(options?.fromYourBrain));
  }, []);

  const handleOpenConversationFromNode = useCallback((nodeId: string, nodeLabel: string) => {
    const normalizedNodeId = nodeId.trim().toLowerCase();
    const normalizedNodeLabel = nodeLabel.trim().toLowerCase();

    const match = vaultConversations.find((conversation) => {
      const normalizedTitle = conversation.title.trim().toLowerCase();
      const pathLower = conversation.path.trim().toLowerCase();
      const fileName = pathLower.split("/").pop() ?? "";
      const fileStem = fileName.replace(/\.md$/i, "");
      return (
        normalizedTitle === normalizedNodeId ||
        normalizedTitle === normalizedNodeLabel ||
        pathLower === normalizedNodeId ||
        fileName === normalizedNodeId ||
        fileName === normalizedNodeLabel ||
        fileStem === normalizedNodeId ||
        fileStem === normalizedNodeLabel
      );
    });

    if (match) {
      emitNativeDebug("brain-node-open-conversation-match", {
        nodeId,
        nodeLabel,
        conversationId: match.id,
        conversationTitle: match.title,
      });
      handleConversationSelect(match, { fromYourBrain: true });
      return;
    }
    emitNativeDebug("brain-node-open-conversation-miss", { nodeId, nodeLabel });
  }, [vaultConversations, handleConversationSelect]);

  const handleCloseConversation = useCallback(() => {
    setSelectedConversationId(null);
    if (returnToYourBrainOnConversationClose) {
      setIsYourBrainOpen(true);
    }
    setReturnToYourBrainOnConversationClose(false);
  }, [returnToYourBrainOnConversationClose]);

  const persistChatConversation = useCallback((params: {
    sessionId: string;
    startedAt: number;
    model: string;
    messages: ChatMessage[];
    folderPath?: string | null;
    /** Último resultado ANCC deste envio (correlações + relevâncias para o frontmatter). */
    anccResult?: ANCCProcessResult | null;
  }) => {
    const title = buildChatTitle(params.messages);
    const conversationRecordId = `${params.sessionId}-${params.startedAt}`;
    const safeConversationID = sanitizeFileName(conversationRecordId);
    const formattedTitle = formatConversationFileTitle(title);
    const normalizedFolderPath = normalizeFolderPath(params.folderPath);
    const targetFolderPath = normalizedFolderPath ?? VAULT_LOOSE_MEMORIES_FOLDER_NAME;
    const memoryPath = `${targetFolderPath}/${formattedTitle} - (${safeConversationID}).md`;

    const markdown = buildVaultConversationMarkdown({
      title,
      startedAt: params.startedAt,
      model: params.model,
      messages: params.messages,
      anccPersist:
        params.anccResult && memoryPath
          ? { result: params.anccResult, currentVaultPath: memoryPath }
          : undefined,
    });
    const optimisticConversation: VaultConversation = {
      id: memoryPath.toLowerCase(),
      title,
      path: memoryPath,
      modifiedAt: Date.now(),
      content: markdown,
    };

    setVaultConversations((previous) => {
      const targetFolderPrefix = `${targetFolderPath}/`.toLowerCase();
      const conversationPathMetadataSuffix = ` - (${safeConversationID}).md`.toLowerCase();
      const conversationPathLegacySuffix = `--${safeConversationID}.md`.toLowerCase();
      const legacyConversationPathPrefix = `${targetFolderPath}/${safeConversationID}-`.toLowerCase();
      const next = previous.filter(
        (conversation) => {
          const normalizedPath = conversation.path.toLowerCase();
          const isSameFolder = normalizedPath.startsWith(targetFolderPrefix);
          const isSameByCurrentPattern = normalizedPath.endsWith(conversationPathMetadataSuffix);
          const isSameByPreviousPattern = normalizedPath.endsWith(conversationPathLegacySuffix);
          const isSameByLegacyPattern = normalizedPath.startsWith(legacyConversationPathPrefix);

          return !(isSameFolder && (isSameByCurrentPattern || isSameByPreviousPattern || isSameByLegacyPattern));
        }
      );
      return [optimisticConversation, ...next].sort((a, b) => b.modifiedAt - a.modifiedAt);
    });

    const bridge = (window as Window & { Brain2Native?: NativeBridge }).Brain2Native;
    if (bridge?.saveConversation) {
      bridge.saveConversation({
        conversationId: conversationRecordId,
        title,
        markdown,
        folderPath: normalizedFolderPath ?? undefined,
      });
      return;
    }

    if (hasNativeVaultData || hasCloudVaultData) {
      return;
    }

    void mutatePresetVaultData({
      action: "save-conversation",
      conversationId: conversationRecordId,
      title,
      markdown,
      folderPath: normalizedFolderPath ?? undefined,
    });
  }, [hasNativeVaultData, hasCloudVaultData, mutatePresetVaultData]);

  const handleSendToBrain = useCallback(async (payload: { content: string; model: string; apiKey: string }) => {
    setIsChatOpen(true);
    const targetFolderPathForConversation = normalizeFolderPath(chatSessionFolderPath ?? selectedFolderPath);
    const sessionId = chatSessionId ?? createConversationRecordId(createMessageId());
    const startedAt = chatSessionStartedAt ?? Date.now();
    if (!chatSessionId) {
      setChatSessionId(sessionId);
      setChatSessionStartedAt(startedAt);
      setChatSessionFolderPath(targetFolderPathForConversation);
    }

    const userMessage: ChatMessage = {
      id: createMessageId(),
      role: "user",
      content: payload.content,
      createdAt: Date.now(),
    };

    const requestMessages: ChatMessage[] = [...chatMessages, userMessage];
    setChatMessages(requestMessages);

    setChatError(null);
    setIsSettingsOpen(false);
    setIsYourBrainOpen(false);
    setSelectedConversationId(null);
    setReturnToYourBrainOnConversationClose(false);
    setChatLoading(true);

    let anccForPersist: ANCCProcessResult | null = null;

    try {
      const vaultFiles = buildVaultSnapshotsForAncc(vaultConversations);
      let precomputedVaultHits: VaultCorrelationHit[] | undefined;
      if (payload.apiKey.trim()) {
        try {
          const retrieveRes = await fetch("/api/ancc-retrieve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              apiKey: payload.apiKey,
              userMessage: payload.content,
              sessionSummary: anccRollingSummaryRef.current,
              recentBullets: buildAnccRecentBullets(requestMessages),
              vaultFiles,
            }),
          });
          if (retrieveRes.ok) {
            const retrieveJson = (await retrieveRes.json()) as {
              hits?: VaultCorrelationHit[];
            };
            if (retrieveJson.hits && retrieveJson.hits.length > 0) {
              precomputedVaultHits = retrieveJson.hits;
            }
          }
        } catch {
          /* retrieval híbrido opcional — fallback só-lexical no cliente */
        }
      }

      const anccResult = processInteraction({
        userMessage: payload.content,
        vaultFiles,
        plasticityState: anccSessionRef.current.plasticity,
        recurrenceTracker: anccSessionRef.current.recurrence,
        recentBullets: buildAnccRecentBullets(requestMessages),
        sessionSummary: anccRollingSummaryRef.current.trim() || undefined,
        precomputedVaultHits,
      });
      anccForPersist = anccResult;

      const systemContent = `${buildBrain2BaseSystemPrompt()}\n\n${anccResult.hiddenSystemBlock}`;
      const priorForApi = chatMessages.filter((m) => m.role !== "system");
      const apiMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemContent },
        ...priorForApi.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        {
          role: "user",
          content: userMessage.content,
        },
      ];

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: payload.model,
          apiKey: payload.apiKey,
          messages: apiMessages,
        }),
      });

      const data = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Falha ao consultar o modelo LLM.");
      }

      const assistantText = data.message?.trim();
      if (!assistantText) {
        throw new Error("Resposta vazia do modelo.");
      }

      const vaultTitlesForOutcome = vaultFiles.map((f) => f.name.replace(/\.md$/i, ""));
      const finalized = finalizeInteractionAfterResponse({
        userMessage: payload.content,
        assistantMessage: assistantText,
        preInteractionResult: anccResult,
        plasticityState: anccSessionRef.current.plasticity,
        vaultNoteTitles: vaultTitlesForOutcome,
      });
      anccForPersist = enrichAnccProcessResultWithOutcome(anccResult, finalized);

      anccRollingSummaryRef.current = appendRollingSessionSummary(
        anccRollingSummaryRef.current,
        payload.content,
        assistantText,
      );

      const nextMessages = [
        ...requestMessages,
        {
          id: createMessageId(),
          role: "assistant" as const,
          content: assistantText,
          createdAt: Date.now(),
        },
      ];
      setChatMessages(nextMessages);
      persistChatConversation({
        sessionId,
        startedAt,
        model: payload.model,
        messages: nextMessages,
        folderPath: targetFolderPathForConversation,
        anccResult: anccForPersist,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erro inesperado ao gerar resposta.";
      setChatError(message);

      // Persist at least the user-side message so no chat is lost.
      persistChatConversation({
        sessionId,
        startedAt,
        model: payload.model,
        messages: requestMessages,
        folderPath: targetFolderPathForConversation,
        anccResult: anccForPersist,
      });
    } finally {
      setChatLoading(false);
    }
  }, [
    chatMessages,
    chatSessionFolderPath,
    chatSessionId,
    chatSessionStartedAt,
    createMessageId,
    persistChatConversation,
    selectedFolderPath,
    vaultConversations,
  ]);

  const handleNewConversation = useCallback(() => {
    setIsSettingsOpen(false);
    setIsYourBrainOpen(false);
    setIsAdvancedVoiceOpen(false);
    setSelectedConversationId(null);
    setReturnToYourBrainOnConversationClose(false);
    setChatMessages([]);
    setChatError(null);
    setChatLoading(false);
    setChatSessionId(null);
    setChatSessionStartedAt(null);
    setChatSessionFolderPath(null);
    setIsChatOpen(true);
    anccSessionRef.current = createDefaultANCCSession();
    anccRollingSummaryRef.current = "";
  }, []);

  const handleLogin = useCallback(async () => {
    const configError = getFirebaseConfigError();
    if (configError) {
      setAuthError(configError);
      throw new Error(configError);
    }

    const auth = getFirebaseAuthClient();
    const provider = getGoogleAuthProvider();

    try {
      setAuthError(null);

      if (isBrain2NativeAppShell()) {
        const bridge = (window as unknown as { Brain2Native?: NativeBridge }).Brain2Native;
        if (typeof bridge?.startGoogleSignIn === "function") {
          bridge.startGoogleSignIn();
          return;
        }
      }

      if (isBrain2NativeAppShell()) {
        await signInWithRedirect(auth, provider);
        return;
      }

      await signInWithPopup(auth, provider);
    } catch (error) {
      const authIssue = error as { code?: string; message?: string };

      if (authIssue.code === "auth/popup-blocked" || authIssue.code === "auth/cancelled-popup-request") {
        await signInWithRedirect(auth, provider);
        return;
      }

      if (authIssue.code === "auth/popup-closed-by-user") {
        setAuthError("Login cancelado antes da confirmacao.");
        return;
      }

      if (authIssue.code === "auth/operation-not-allowed") {
        setAuthError("Ative Google como provedor em Firebase Authentication > Sign-in method.");
        return;
      }

      setAuthError(authIssue.message || "Falha ao autenticar com Google.");
      throw error;
    }
  }, []);

  const handleLogout = useCallback(async () => {
    if (!window.confirm("Deseja sair da sua conta?")) {
      return;
    }
    try {
      const auth = getFirebaseAuthClient();
      await signOut(auth);
      setAuthError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao sair da conta.";
      setAuthError(message);
      window.alert("Nao foi possivel fazer logout agora. Tente novamente.");
    }
  }, []);

  const handleForceOnboarding = useCallback(() => {
    setIsSettingsOpen(false);
    if (isNativeMacShell) {
      try {
        const w = window as Window & {
          Brain2Native?: { requestDirectoryOnboarding?: () => void };
        };
        w.Brain2Native?.requestDirectoryOnboarding?.();
      } catch {
        /* ignore */
      }
      return;
    }
    if (BRAIN2_TESTING_ALWAYS_SHOW_WEB_ONBOARDING) {
      setWebOnboardingDismissedThisSession(false);
      return;
    }
    try {
      window.localStorage.removeItem(WEB_DIRECTORY_ONBOARDING_KEY);
    } catch {
      /* ignore */
    }
    setWebDirectoryOnboardingDone(false);
  }, [isNativeMacShell]);

  if (isAuthInitializing) {
    return <AuthSplashScreen />;
  }

  if (!isAuthenticated) {
    return <LoginView onLogin={handleLogin} authLoading={false} authError={authError} />;
  }

  const shellHeight = isNativeMacShell ? "100%" : "100dvh";

  const showWebDirectoryOnboarding =
    isAuthenticated &&
    !isNativeMacShell &&
    (BRAIN2_TESTING_ALWAYS_SHOW_WEB_ONBOARDING
      ? !webOnboardingDismissedThisSession
      : webDirectoryOnboardingDone === false);

  return (
    <main
      style={{
        height: shellHeight,
        width: "100vw",
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
        justifyContent: "flex-start",
        background: "var(--background)",
        overflow: "hidden",
        padding: 0,
        margin: 0,
        border: "none",
        position: "relative",
      }}
    >
      {showWebDirectoryOnboarding && (
        <WebDirectoryOnboarding
          onCompleted={() => {
            if (BRAIN2_TESTING_ALWAYS_SHOW_WEB_ONBOARDING) {
              setWebOnboardingDismissedThisSession(true);
            } else {
              setWebDirectoryOnboardingDone(true);
            }
          }}
        />
      )}
      {!isSidebarHidden && (
        <DesktopSidebar
          onHide={() => setIsSidebarHidden(true)}
          onNewConversation={handleNewConversation}
          onYourBrain={handleOpenBrain}
          onLogout={handleLogout}
          userName={authUser?.displayName || authUser?.email}
          userPhotoURL={authUser?.photoURL}
          onSettings={() => {
            setIsChatOpen(false);
            setIsYourBrainOpen(false);
            setIsAdvancedVoiceOpen(false);
            setIsSettingsOpen(true);
          }}
          vaultLoading={graphLoading}
          vaultFolders={vaultFolders}
          vaultConversations={vaultConversations}
          selectedFolderPath={selectedFolderPath}
          onFolderSelect={setSelectedFolderPath}
          selectedConversationId={selectedConversationId}
          onConversationSelect={handleConversationSelect}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
        />
      )}

      {isMobileSidebarOpen && (
        <DesktopSidebar
          onHide={() => setIsMobileSidebarOpen(false)}
          onNewConversation={() => {
            setIsMobileSidebarOpen(false);
            handleNewConversation();
          }}
          onYourBrain={() => {
            setIsMobileSidebarOpen(false);
            handleOpenBrain();
          }}
          onLogout={handleLogout}
          userName={authUser?.displayName || authUser?.email}
          userPhotoURL={authUser?.photoURL}
          onSettings={() => {
            setIsMobileSidebarOpen(false);
            setIsChatOpen(false);
            setIsYourBrainOpen(false);
            setIsAdvancedVoiceOpen(false);
            setIsSettingsOpen(true);
          }}
          mobileFullscreen
          vaultLoading={graphLoading}
          vaultFolders={vaultFolders}
          vaultConversations={vaultConversations}
          selectedFolderPath={selectedFolderPath}
          onFolderSelect={setSelectedFolderPath}
          selectedConversationId={selectedConversationId}
          onConversationSelect={(conversation) => {
            setIsMobileSidebarOpen(false);
            handleConversationSelect(conversation);
          }}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={handleDeleteConversation}
        />
      )}

      {!isMobileSidebarOpen && (
        <button
          className="mobile-sidebar-open-btn"
          aria-label="Exibir menu lateral"
          onClick={() => setIsMobileSidebarOpen(true)}
        >
          <PanelLeftOpen size={14} strokeWidth={2} />
          <span>Menu</span>
        </button>
      )}

      {isSidebarHidden && (
        <button
          className="sidebar-reopen-btn"
          aria-label="Mostrar barra lateral"
          onClick={() => setIsSidebarHidden(false)}
        >
          <PanelLeftOpen size={14} strokeWidth={2} />
          <span>Menu</span>
        </button>
      )}

      {/* Content area */}
      <section
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: activeView !== "home" ? "stretch" : "center",
          justifyContent: activeView !== "home" ? "stretch" : "center",
          gap: activeView !== "home" ? 0 : "10px",
          height: shellHeight,
          minHeight: 0,
          userSelect: activeView !== "home" ? "auto" : "none",
          pointerEvents: activeView !== "home" ? "all" : "none",
          padding: activeView !== "home" ? 0 : "0 20px",
          overflow: "hidden",
        }}
      >
        {activeView === "brain" ? (
          <BrainGraphView
            key={`brain-${vaultDataVersion}`}
            onClose={() => setIsYourBrainOpen(false)}
            graph={vaultGraph}
            loading={graphLoading}
            onOpenConversationFromNode={handleOpenConversationFromNode}
          />
        ) : activeView === "chat" ? (
          <ChatView
            title={chatTitle}
            messages={chatMessages}
            loading={chatLoading}
            error={chatError}
          />
        ) : activeView === "advanced-voice" ? (
          <AdvancedVoiceSphereView onClose={() => setIsAdvancedVoiceOpen(false)} />
        ) : activeView === "conversation" && selectedConversation ? (
          <ConversationView
            conversation={selectedConversation}
            onClose={handleCloseConversation}
          />
        ) : activeView === "settings" ? (
          <SettingsView
            onClose={() => setIsSettingsOpen(false)}
            onVaultChange={handleVaultChange}
            vaultHandle={null}
            nativeVaultPath={vaultPath}
            onCloudVaultSaved={() => {
              void loadPresetVaultData({ force: true });
            }}
            onForceOnboarding={handleForceOnboarding}
          />
        ) : (
          <>
            <h1
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: "clamp(2rem, 5vw, 3.4rem)",
                fontWeight: 500,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--hero-title)",
                margin: 0,
              }}
            >
              Brain2
            </h1>
            <p
              style={{
                fontFamily: "'Inter', sans-serif",
                fontSize: "clamp(0.65rem, 1.4vw, 0.78rem)",
                fontWeight: 300,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: "var(--hero-subtitle)",
                margin: 0,
              }}
            >
              The Extension of Your Mind
            </p>
          </>
        )}
      </section>

      {/* Bottom input bar */}
      {!isMobileSidebarOpen && (activeView === "home" || activeView === "conversation" || activeView === "chat") && (
        <InputBar
          desktopSidebarOffset={!isSidebarHidden}
          isSending={chatLoading}
          onSend={handleSendToBrain}
          onOpenAdvancedVoice={handleOpenAdvancedVoice}
        />
      )}

      <style jsx>{`
        .mobile-sidebar-open-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          position: fixed;
          top: 14px;
          left: 14px;
          height: 30px;
          border: 1px solid var(--bar-border);
          border-radius: 9px;
          background: var(--bar-bg);
          color: var(--muted);
          font-family: 'Inter', sans-serif;
          font-size: 12px;
          padding: 0 10px;
          z-index: 1200;
          transition: background 0.15s ease, color 0.15s ease;
        }

        .mobile-sidebar-open-btn:hover {
          background: var(--pill-bg);
          color: var(--muted-hover);
        }

        @media (min-width: 980px) {
          .mobile-sidebar-open-btn {
            display: none;
          }
        }

        .sidebar-reopen-btn {
          display: none;
        }

        @media (min-width: 980px) {
          .sidebar-reopen-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            position: fixed;
            top: 18px;
            left: 18px;
            height: 30px;
            border: 1px solid var(--bar-border);
            border-radius: 9px;
            background: var(--bar-bg);
            color: var(--muted);
            font-family: 'Inter', sans-serif;
            font-size: 12px;
            padding: 0 10px;
            z-index: 1200;
            transition: background 0.15s ease, color 0.15s ease;
          }

          .sidebar-reopen-btn:hover {
            background: var(--pill-bg);
            color: var(--muted-hover);
          }
        }
      `}</style>
    </main>
  );
}

