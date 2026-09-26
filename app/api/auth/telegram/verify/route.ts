import { NextRequest, NextResponse } from "next/server";
import { createHash, createHmac, timingSafeEqual } from "crypto";
import { createSession, normalizeIdentity } from "@/lib/tip-auth";

export async function POST(request: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return NextResponse.json({ error: "Telegram authentication is not configured." }, { status: 503 });

  const body = await request.json() as Record<string, string>;
  const hash = body.hash;
  if (!hash) return NextResponse.json({ error: "Missing Telegram authentication hash." }, { status: 400 });

  const dataCheck = Object.entries(body)
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => key + "=" + value)
    .join("\n");

  const secret = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(dataCheck).digest("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Telegram identity verification failed." }, { status: 401 });
  }

  const authDate = Number(body.auth_date);
  if (!authDate || Math.abs(Math.floor(Date.now() / 1000) - authDate) > 86400) {
    return NextResponse.json({ error: "Telegram authentication has expired." }, { status: 401 });
  }

  const username = body.username;
  if (!username) return NextResponse.json({ error: "Telegram account has no username." }, { status: 400 });

  const identity = normalizeIdentity("telegram", username);
  const session = createSession({
    provider: "telegram",
    identity,
    exp: Math.floor(Date.now() / 1000) + 3600
  });

  const response = NextResponse.json({ ok: true, identity });
  response.cookies.set("satodrops_tip_session", session, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600, path: "/"
  });
  return response;
}
