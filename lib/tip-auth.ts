import { createHmac, timingSafeEqual } from "crypto";
import { privateKeyToAccount } from "viem/accounts";

const secret = () => process.env.AUTH_SESSION_SECRET ?? "";

function b64url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function sign(payload: string) {
  return b64url(createHmac("sha256", secret()).update(payload).digest("base64url"));
}

export function createSession(data: { provider: "x" | "telegram"; identity: string; exp: number }) {
  if (!secret()) throw new Error("AUTH_SESSION_SECRET is not configured.");
  const payload = b64url(JSON.stringify(data));
  return payload + "." + sign(payload);
}

export function readSession(token: string | undefined) {
  if (!token || !secret()) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString()) as {
      provider: "x" | "telegram"; identity: string; exp: number;
    };
    if (!data.identity || !data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export function normalizeIdentity(provider: "x" | "telegram", value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function verifierAddress() {
  const key = process.env.SATOTIPS_VERIFIER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("SATOTIPS_VERIFIER_PRIVATE_KEY is not configured.");
  return privateKeyToAccount(key).address;
}

export async function signClaimAuthorization(args: {
  contract: string;
  chainId: bigint;
  tipId: bigint;
  wallet: `0x${string}`;
  identityType: number;
  identityHash: `0x${string}`;
}) {
  const key = process.env.SATOTIPS_VERIFIER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!key) throw new Error("SATOTIPS_VERIFIER_PRIVATE_KEY is not configured.");
  const account = privateKeyToAccount(key);
  const { keccak256, encodeAbiParameters, parseAbiParameters } = await import("viem");
  const inner = keccak256(encodeAbiParameters(
    parseAbiParameters("address,uint256,uint256,address,uint8,bytes32"),
    [args.contract as `0x${string}`, args.chainId, args.tipId, args.wallet, args.identityType, args.identityHash]
  ));
  const signature = await account.signMessage({ message: { raw: inner } });
  return { signature, verifier: account.address };
}
