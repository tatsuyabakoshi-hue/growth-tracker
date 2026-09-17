import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const sql = getDb();
  const suggestions = await sql`
    SELECT id, content, created_at FROM suggestions
    WHERE member_id = ${id}
    ORDER BY created_at DESC
  `;
  return NextResponse.json({ suggestions });
}
