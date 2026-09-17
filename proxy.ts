import { NextRequest, NextResponse } from "next/server";

// /api/cronはVercel Cronからの呼び出し用。共通ログインCookieを持たないため公開パスとし、
// 認可はルート内でCRON_SECRET(Bearerトークン)によって別途行う。
const PUBLIC_PATHS = ["/login", "/api/login", "/api/cron"];

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const expected = process.env.APP_PASSWORD;
  const token = request.cookies.get("gt_auth")?.value;

  if (!expected || token !== expected) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
