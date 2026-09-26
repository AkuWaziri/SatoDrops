import { NextRequest, NextResponse } from "next/server";
import { encodePacked, keccak256 } from "viem";
import { readSession, normalizeIdentity, signClaimAuthorization } from "@/lib/tip-auth";

const RPC = "https://rpc.tempo.xyz";
const CONTRACT = process.env.NEXT_PUBLIC_SATOTIPS_CONTRACT_ADDRESS ?? "";
const ABI = [{ type: "function", name: "tips", stateMutability: "view", inputs: [{ name: "tipId", type: "uint256" }], outputs: [
  { name: "creator", type: "address" }, { name: "token", type: "address" }, { name: "amount", type: "uint128" },
  { name: "expiresAt", type: "uint64" }, { name: "claimed", type: "bool" }, { name: "closed", type: "bool" },
  { name: "identityType", type: "uint8" }, { name: "identityHash", type: "bytes32" }, { name: "message", type: "string" }
] }] as const;

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "Tempo RPC error.");
  return body.result;
}

export async function POST(request: NextRequest) {
  try {
    if (!CONTRACT) return NextResponse.json({ error: "SatoTips contract is not configured." }, { status: 503 });
    const session = readSession(request.cookies.get("satodrops_tip_session")?.value);
    if (!session) return NextResponse.json({ error: "Identity authentication required." }, { status: 401 });

    const body = await request.json() as { tipId?: string; wallet?: string };
    if (!body.tipId || !/^0x[a-fA-F0-9]{40}$/.test(body.wallet ?? "")) return NextResponse.json({ error: "tipId and wallet are required." }, { status: 400 });

    const data = "0x" + (await import("viem")).encodeFunctionData({ abi: ABI, functionName: "tips", args: [BigInt(body.tipId)] }).slice(2);
    const raw = await rpc("eth_call", [{ to: CONTRACT, data }, "latest"]) as string;
    const hex = raw.replace(/^0x/, "");
    const word = (i: number) => hex.slice(i * 64, (i + 1) * 64);
    const identityType = Number(BigInt("0x" + word(6)));
    const identityHash = ("0x" + word(7)) as `0x${string}`;
    if (identityType !== (session.provider === "x" ? 1 : 2)) return NextResponse.json({ error: "Authenticated identity type does not match this tip." }, { status: 403 });

    const expectedHash = keccak256(new TextEncoder().encode(normalizeIdentity(session.provider, session.identity)));
    if (identityHash.toLowerCase() !== expectedHash.toLowerCase()) return NextResponse.json({ error: "Authenticated identity does not match this tip." }, { status: 403 });

    const signature = await signClaimAuthorization({
      contract: CONTRACT,
      chainId: 4217n,
      tipId: BigInt(body.tipId),
      wallet: body.wallet as `0x${string}`,
      identityType,
      identityHash
    });
    return NextResponse.json({ ok: true, signature: signature.signature, identity: session.identity });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Authorization failed." }, { status: 500 });
  }
}
