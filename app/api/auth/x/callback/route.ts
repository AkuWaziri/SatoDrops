import { NextRequest, NextResponse } from "next/server";
import { createSession, normalizeIdentity } from "@/lib/tip-auth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthCookie = request.cookies.get("satodrops_x_oauth")?.value;
  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X_REDIRECT_URI;
  const returnPath = request.cookies.get("satodrops_x_return")?.value ?? "/tip";

  if (!code || !state || !oauthCookie || !clientId || !clientSecret || !redirectUri) {
    return NextResponse.json({ error: "Invalid X authentication callback." }, { status: 400 });
  }

  let saved: { state: string; verifier: string };
  try { saved = JSON.parse(oauthCookie); } catch { return NextResponse.json({ error: "Invalid X authentication session." }, { status: 400 }); }
  if (saved.state !== state) return NextResponse.json({ error: "X authentication state mismatch." }, { status: 400 });

  const basic = Buffer.from(clientId + ":" + clientSecret).toString("base64");
  const tokenResponse = await fetch("https://api.x.com/2/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: "Basic " + basic },
    body: new URLSearchParams({
      code, grant_type: "authorization_code", redirect_uri: redirectUri, code_verifier: saved.verifier
    })
  });
  if (!tokenResponse.ok) return NextResponse.json({ error: "X token exchange failed." }, { status: 502 });
  const token = await tokenResponse.json() as { access_token?: string };
  if (!token.access_token) return NextResponse.json({ error: "X did not return an access token." }, { status: 502 });

  const meResponse = await fetch("https://api.x.com/2/users/me?user.fields=username", {
    headers: { authorization: "Bearer " + token.access_token }
  });
  if (!meResponse.ok) return NextResponse.json({ error: "Could not verify X identity." }, { status: 502 });
  const me = await meResponse.json() as { data?: { username?: string } };
  const username = me.data?.username;
  if (!username) return NextResponse.json({ error: "X account has no username." }, { status: 502 });

  const session = createSession({ provider: "x", identity: normalizeIdentity("x", username), exp: Math.floor(Date.now() / 1000) + 3600 });
  const response = NextResponse.redirect(new URL(returnPath + (returnPath.includes("?") ? "&" : "?") + "auth=x", request.url));
  response.cookies.set("satodrops_tip_session", session, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 3600, path: "/"
  });
  response.cookies.delete("satodrops_x_oauth");
  response.cookies.delete("satodrops_x_return");
  return response;
}
