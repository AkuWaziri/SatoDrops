import { NextResponse } from "next/server";
import { createHash, randomBytes } from "crypto";

export async function GET(request: Request) {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;
  if (!clientId || !redirectUri) return NextResponse.json({ error: "X authentication is not configured." }, { status: 503 });

  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const requestedReturn = new URL(request.url).searchParams.get("return");
  const tipId = new URL(request.url).searchParams.get("id");
  const returnPath = requestedReturn === "claim" && tipId && /^\\d+$/.test(tipId) ? "/tip/claim?id=" + encodeURIComponent(tipId) : "/tip";

  const response = NextResponse.redirect(
    "https://twitter.com/i/oauth2/authorize?" +
    new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: "users.read tweet.read",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256"
    }).toString()
  );
  response.cookies.set("satodrops_x_oauth", JSON.stringify({ state, verifier }), {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/"
  });
  response.cookies.set("satodrops_x_return", returnPath, {
    httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/"
  });
  return response;
}
