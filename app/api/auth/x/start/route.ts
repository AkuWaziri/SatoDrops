import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

export async function GET() {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI;
  if (!clientId || !redirectUri) return NextResponse.json({ error: "X authentication is not configured." }, { status: 503 });

  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = require("crypto").createHash("sha256").update(verifier).digest("base64url");

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
  return response;
}
