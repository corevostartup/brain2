import { NextResponse } from "next/server";
import { getPresetVaultData } from "@/lib/vaultServer";

export const runtime = "nodejs";

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
