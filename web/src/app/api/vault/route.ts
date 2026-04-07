import { NextResponse } from "next/server";
import {
  createPresetFolder,
  deletePresetConversation,
  deletePresetFolder,
  getPresetVaultData,
  renamePresetFolder,
  renamePresetVault,
  renamePresetConversation,
  savePresetConversation,
} from "@/lib/vaultServer";

export const runtime = "nodejs";

type VaultMutationPayload = {
  action?: "create-folder" | "rename-folder" | "delete-folder" | "rename-conversation" | "delete-conversation" | "save-conversation" | "rename-vault";
  parentPath?: string;
  folderName?: string;
  folderPath?: string;
  newFolderName?: string;
  conversationPath?: string;
  newTitle?: string;
  vaultName?: string;
  title?: string;
  markdown?: string;
  conversationId?: string;
};

export async function GET() {
  try {
    const data = await getPresetVaultData();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read preset vault.";
    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let payload: VaultMutationPayload;

  try {
    payload = (await request.json()) as VaultMutationPayload;
  } catch {
    return NextResponse.json(
      {
        error: "Invalid JSON payload.",
      },
      { status: 400 }
    );
  }

  try {
    if (payload.action === "create-folder") {
      await createPresetFolder(payload.parentPath ?? "", payload.folderName ?? "");
    } else if (payload.action === "rename-folder") {
      await renamePresetFolder(payload.folderPath ?? "", payload.newFolderName ?? "");
    } else if (payload.action === "delete-folder") {
      await deletePresetFolder(payload.folderPath ?? "");
    } else if (payload.action === "rename-conversation") {
      await renamePresetConversation(payload.conversationPath ?? "", payload.newTitle ?? "");
    } else if (payload.action === "delete-conversation") {
      await deletePresetConversation(payload.conversationPath ?? "");
    } else if (payload.action === "save-conversation") {
      await savePresetConversation(
        payload.conversationId ?? "",
        payload.title ?? "",
        payload.markdown ?? "",
        payload.folderPath
      );
    } else if (payload.action === "rename-vault") {
      await renamePresetVault(payload.vaultName ?? "");
    } else {
      return NextResponse.json(
        {
          error: "Unsupported action.",
        },
        { status: 400 }
      );
    }

    const data = await getPresetVaultData();
    return NextResponse.json(data, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to mutate preset vault.";
    const errno = error as { code?: string };

    const status = errno.code === "EEXIST"
      ? 409
      : errno.code === "ENOENT"
        ? 404
        : errno.code === "EACCES" || errno.code === "EPERM"
          ? 403
          : message.startsWith("Invalid") || message.includes("required")
            ? 400
            : 500;

    return NextResponse.json(
      {
        error: message,
      },
      { status }
    );
  }
}
