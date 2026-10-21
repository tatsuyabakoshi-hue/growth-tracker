import { NextRequest, NextResponse } from "next/server";
import { verifyPlainSecret } from "@/lib/password";
import { getAdminOverview } from "@/lib/admin-overview";

/**
 * 管理者（マスターパスワード）向けに、全メンバーの俯瞰データを返す。
 * 認証はリクエストヘッダ x-master-password を MASTER_PASSWORD と照合する。
 */
export async function GET(request: NextRequest) {
  const master = process.env.MASTER_PASSWORD;
  if (!master) {
    return NextResponse.json(
      { error: "MASTER_PASSWORDが未設定です。管理者ダッシュボードを使うには設定してください。" },
      { status: 403 }
    );
  }
  const provided = request.headers.get("x-master-password") || "";
  if (!verifyPlainSecret(provided, master)) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }

  const overview = await getAdminOverview();
  return NextResponse.json(overview);
}
