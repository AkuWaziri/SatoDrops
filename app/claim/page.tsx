"use client";

import { ArrowUpRight, Wallet } from "lucide-react";
import { encodeFunctionData, formatUnits } from "viem";
import { useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

const TEMPO_CHAIN_ID = "0x1079";
const TEMPO_RPC = "https://rpc.tempo.xyz";
const EXPLORER = "https://explore.tempo.xyz";
const SATODROPS_CONTRACT = process.env.NEXT_PUBLIC_SATODROPS_CONTRACT_ADDRESS ?? "";
const PATH_USD_FEE_TOKEN = "0x20c0000000000000000000000000000000000000";

const tokens: Record<string, { symbol: string; address: string; decimals: number }> = {
  "0x20c000000000000000000000b9537d11c60e8b50": { symbol: "USDC", address: "0x20c000000000000000000000b9537d11c60e8b50", decimals: 6 },
  "0x20c00000000000000000000014f22ca97301eb73": { symbol: "USDT", address: "0x20c00000000000000000000014f22ca97301eb73", decimals: 6 },
  "0x20c0000000000000000000000000000000000000": { symbol: "pathUSD", address: "0x20c0000000000000000000000000000000000000", decimals: 6 },
};

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
      { name: "closed", type: "bool" },
      { name: "message", type: "string" },
    ],
  },
  {
    type: "function",
    name: "hasClaimed",
    stateMutability: "view",
    inputs: [{ name: "dropId", type: "uint256" }, { name: "claimant", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "claim",
    stateMutability: "nonpayable",
    inputs: [{ name: "dropId", type: "uint256" }],
    outputs: [],
  },
] as const;

async function rpc(method: string, params: unknown[]) {
  const response = await fetch(TEMPO_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("Tempo RPC request failed.");
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "Tempo RPC error.");
  return body.result ?? "";
}

async function waitForReceipt(hash: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const raw = await rpc("eth_getTransactionReceipt", [hash]);
    if (raw) {
      const receipt = JSON.parse(JSON.stringify(raw)) as { status?: string };
      if (receipt.status === "0x0") throw new Error("Claim transaction reverted on Tempo.");
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Transaction confirmation timed out. Check Tempo Explorer.");
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function decodeDropResult(raw: string) {
  const hex = raw.startsWith("0x") ? raw.slice(2) : raw;
  const word = (index: number) => hex.slice(index * 64, (index + 1) * 64);
  const creator = `0x${word(0).slice(24)}`;
  const token = `0x${word(1).slice(24)}`;
  const amountPerClaim = BigInt(`0x${word(2)}`);
  const maxClaims = BigInt(`0x${word(3)}`);
  const claimed = BigInt(`0x${word(4)}`);
  const expiresAt = BigInt(`0x${word(5)}`);
  const closed = BigInt(`0x${word(6)}`) !== 0n;
  const messageOffset = Number(BigInt(`0x${word(7)}`));
  const messageBase = messageOffset * 2;
  const messageLength = Number(BigInt(`0x${hex.slice(messageBase, messageBase + 64)}`));
  const messageHex = hex.slice(messageBase + 64, messageBase + 64 + messageLength * 2);
  const bytes = new Uint8Array(messageHex.match(/.{1,2}/g)?.map((b) => parseInt(b, 16)) ?? []);
  const message = new TextDecoder().decode(bytes);
  return { creator, token, amountPerClaim, maxClaims, claimed, expiresAt, closed, message };
}

export default function ClaimPage() {
  const [account, setAccount] = useState("");
  const [dropId, setDropId] = useState("");
  const [drop, setDrop] = useState<ReturnType<typeof decodeDropResult> | null>(null);
  const [alreadyClaimed, setAlreadyClaimed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState("");
  const [successHash, setSuccessHash] = useState("");

  const token = useMemo(() => drop ? tokens[drop.token.toLowerCase()] : undefined, [drop]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") ?? "";
    setDropId(id);
    if (!SATODROPS_CONTRACT || !id || !/^\d+$/.test(id)) {
      setError(!SATODROPS_CONTRACT ? "SatoDrops contract is not configured yet." : "Invalid claim link.");
      setLoading(false);
      return;
    }
    const load = async () => {
      try {
        const data = await rpc("eth_call", [{
          to: SATODROPS_CONTRACT,
          data: encodeFunctionData({ abi, functionName: "drops", args: [BigInt(id)] }),
        }, "latest"]);
        setDrop(decodeDropResult(data));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load this drop.");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  async function connect() {
    setError("");
    if (!window.ethereum) return setError("No EVM wallet detected. Install a wallet extension first.");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const current = accounts?.[0];
      if (!current) return;
      const chainId = await window.ethereum.request({ method: "eth_chainId" }) as string;
      if (chainId.toLowerCase() !== TEMPO_CHAIN_ID) {
        try {
          await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: TEMPO_CHAIN_ID }] });
        } catch (switchError) {
          const code = (switchError as { code?: number })?.code;
          if (code === 4902) {
            await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{
              chainId: TEMPO_CHAIN_ID,
              chainName: "Tempo Mainnet",
              nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
              rpcUrls: [TEMPO_RPC],
              blockExplorerUrls: [EXPLORER],
            }] });
          } else throw switchError;
        }
      }
      setAccount(current);
      const data = encodeFunctionData({ abi, functionName: "hasClaimed", args: [BigInt(dropId), current as `0x${string}`] });
      const raw = await rpc("eth_call", [{ to: SATODROPS_CONTRACT, data }, "latest"]);
      setAlreadyClaimed(BigInt(raw) !== 0n);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Wallet connection failed.");
    }
  }

  async function claim() {
    setError("");
    setSuccessHash("");
    if (!window.ethereum) return setError("No EVM wallet detected.");
    if (!account) return connect();
    if (!dropId || !drop) return setError("Drop is still loading.");
    if (drop.closed) return setError("This drop is closed.");
    if (drop.claimed >= drop.maxClaims) return setError("This drop is sold out.");
    if (alreadyClaimed) return setError("This wallet has already claimed this drop.");
    try {
      setClaiming(true);
      const data = encodeFunctionData({ abi, functionName: "claim", args: [BigInt(dropId)] });
      const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: account, to: SATODROPS_CONTRACT, data, feeToken: PATH_USD_FEE_TOKEN }] }) as string;
      await waitForReceipt(hash);
      setSuccessHash(hash);
      setAlreadyClaimed(true);
      setDrop((current) => current ? { ...current, claimed: current.claimed + 1n } : current);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Claim failed.");
    } finally {
      setClaiming(false);
    }
  }

  const expired = !!drop && drop.expiresAt !== 0n && BigInt(Math.floor(Date.now() / 1000)) >= drop.expiresAt;
  const unavailable = !!drop && (drop.closed || expired || drop.claimed >= drop.maxClaims);
  const explorerLink = successHash ? `${EXPLORER}/tx/${successHash}` : "";

  return (
    <main className="claim-page">
      <nav className="nav">
        <a className="brand" href="/"><span className="brand-mark">S</span><span>SatoDrops</span></a>
        <span className="eyebrow">TEMPO MAINNET</span>
      </nav>
      <section className="claim-shell">
        <div className="claim-card">
          <div className="eyebrow">SATODROPS CLAIM · #{dropId || "—"}</div>
          {loading && <h1>Loading drop…</h1>}
          {!loading && error && !drop && <><h1>Claim link unavailable</h1><p>{error}</p><a className="secondary" href="/">Back to SatoDrops</a></>}
          {!loading && drop && (
            <>
              <div className="claim-token">{token?.symbol ?? "TOKEN"}</div>
              <div className="claim-amount">{formatUnits(drop.amountPerClaim, token?.decimals ?? 6)} <span>{token?.symbol ?? ""}</span></div>
              <p className="claim-message">{drop.message || "A SatoDrops reward is waiting for you."}</p>
              <div className="claim-meta"><span>{drop.claimed.toString()} / {drop.maxClaims.toString()} claimed</span><span>Creator {shortAddress(drop.creator)}</span></div>
              {expired && <div className="wallet-error">This drop has expired.</div>}
              {drop.closed && <div className="wallet-error">This drop has been closed.</div>}
              {drop.claimed >= drop.maxClaims && <div className="wallet-error">This drop is sold out.</div>}
              {alreadyClaimed && <div className="wallet-error">This wallet has already claimed this drop.</div>}
              {successHash && <div className="success-box">Claim confirmed on Tempo · <a href={explorerLink} target="_blank" rel="noreferrer">View transaction</a></div>}
              <button className="create-btn" onClick={unavailable || alreadyClaimed ? undefined : claim} disabled={claiming || unavailable || alreadyClaimed}>
                <Wallet size={17}/>{claiming ? "Waiting for wallet…" : account ? `Claim ${formatUnits(drop.amountPerClaim, token?.decimals ?? 6)} ${token?.symbol ?? ""}` : "Connect wallet to claim"}
                {!claiming && <ArrowUpRight size={16}/>}
              </button>
              {account && <div className="claim-wallet">Connected {shortAddress(account)}</div>}
              {error && drop && <div className="wallet-error">{error}</div>}
              <div className="summary-note">Claimants receive the full reward amount. The 0.5% claim fee is paid from the drop's reserved fee balance.</div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
