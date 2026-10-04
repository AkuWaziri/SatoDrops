import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const CHAIN_ID = 4217;
const RPC_URL = "https://rpc.tempo.xyz";
const CONTRACT = process.env.SATODROPS_FCFS_CONTRACT_ADDRESS as `0x${string}` | undefined;
const SIGNER_KEY = process.env.SATODROPS_FCFS_SIGNER_PRIVATE_KEY as Hex | undefined;
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY;

const abi = [
  {
    type: "function",
    name: "drops",
    stateMutability: "view",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [
      { name: "creator", type: "address" },
      { name: "token", type: "address" },
      { name: "amountPerClaim", type: "uint128" },
      { name: "maxClaims", type: "uint64" },
      { name: "claimed", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
      { name: "active", type: "bool" },
      { name: "closed", type: "bool" },
      { name: "message", type: "string" },
    ],
  },
  {
    type: "function",
    name: "hasClaimed",
    stateMutability: "view",
    inputs: [
      { name: "dropId", type: "uint256" },
      { name: "wallet", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "claimNonces",
    stateMutability: "view",
    inputs: [
      { name: "dropId", type: "uint256" },
      { name: "wallet", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const publicClient = createPublicClient({
  transport: http(RPC_URL),
});

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });

export async function POST(request: NextRequest) {
  try {
    if (!CONTRACT || !SIGNER_KEY || !TURNSTILE_SECRET) {
      return json({ error: "FCFS claim authorization is not configured." }, 503);
    }

    const body = await request.json() as {
      dropId?: string;
      wallet?: string;
      turnstileToken?: string;
    };

    const dropId = body.dropId?.trim();
    const wallet = body.wallet?.trim();

    if (!dropId || !/^\\d+$/.test(dropId) || !wallet || !isAddress(wallet) || !body.turnstileToken) {
      return json({ error: "Invalid claim authorization request." }, 400);
    }

    const turnstileResponse = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: TURNSTILE_SECRET,
          response: body.turnstileToken,
        }),
        cache: "no-store",
      },
    );

    const turnstile = await turnstileResponse.json() as {
      success?: boolean;
      "error-codes"?: string[];
    };

    if (!turnstile.success) {
      return json({ error: "Human verification failed. Please try again." }, 403);
    }

    const id = BigInt(dropId);
    const walletAddress = wallet as `0x${string}`;

    const [drop, alreadyClaimed, nonce] = await Promise.all([
      publicClient.readContract({ address: CONTRACT, abi, functionName: "drops", args: [id] }),
      publicClient.readContract({ address: CONTRACT, abi, functionName: "hasClaimed", args: [id, walletAddress] }),
      publicClient.readContract({ address: CONTRACT, abi, functionName: "claimNonces", args: [id, walletAddress] }),
    ]);

    const [, , , maxClaims, claimed, expiresAt, active, closed] = drop;

    if (!active) return json({ error: "This drop has not been activated by its creator yet." }, 409);
    if (closed) return json({ error: "This drop is closed." }, 409);
    if (claimed >= maxClaims) return json({ error: "This drop is sold out." }, 409);
    if (alreadyClaimed) return json({ error: "This wallet has already claimed this drop." }, 409);
    if (expiresAt !== 0n && BigInt(Math.floor(Date.now() / 1000)) >= expiresAt) {
      return json({ error: "This drop has expired." }, 409);
    }

    const account = privateKeyToAccount(SIGNER_KEY);
    const now = Math.floor(Date.now() / 1000);
    const deadline = BigInt(now + 5 * 60);

    const signature = await account.signTypedData({
      domain: {
        name: "SatoDrops FCFS",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: CONTRACT,
      },
      types: {
        ClaimAuthorization: [
          { name: "dropId", type: "uint256" },
          { name: "claimant", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "ClaimAuthorization",
      message: {
        dropId: id,
        claimant: walletAddress,
        nonce,
        deadline,
      },
    });

    return json({
      dropId,
      wallet: walletAddress,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      signature,
    });
  } catch (error) {
    console.error("FCFS claim authorization failed", error);
    return json({ error: "Could not authorize this claim. Please try again." }, 500);
  }
}
