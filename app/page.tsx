"use client";

import { ArrowUpRight, Sparkles, Wallet } from "lucide-react";
import { encodeFunctionData, formatUnits, keccak256, parseUnits, toBytes } from "viem";
import { useEffect, useMemo, useState } from "react";

type Eip1193Provider = NonNullable<Window["ethereum"]> & {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

const TEMPO_CHAIN_ID = "0x1079";
const TEMPO_CHAIN = {
  chainId: TEMPO_CHAIN_ID,
  chainName: "Tempo Mainnet",
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
  rpcUrls: ["https://rpc.tempo.xyz"],
  blockExplorerUrls: ["https://explore.tempo.xyz"],
};

const SATODROPS_CONTRACT = process.env.NEXT_PUBLIC_SATODROPS_CONTRACT_ADDRESS ?? "";
const PATH_USD_FEE_TOKEN = "0x20c0000000000000000000000000000000000000";

const tokens = [
  { symbol: "USDC", address: "0x20c000000000000000000000b9537d11c60e8b50", decimals: 6 },
  { symbol: "USDT", address: "0x20c00000000000000000000014f22ca97301eb73", decimals: 6 },
  { symbol: "pathUSD", address: "0x20c0000000000000000000000000000000000000", decimals: 6 },
];

const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const satodropsAbi = [
  {
    type: "function",
    name: "createDrop",
    stateMutability: "nonpayable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amountPerClaim", type: "uint128" },
      { name: "maxClaims", type: "uint64" },
      { name: "expiresAt", type: "uint64" },
      { name: "message", type: "string" },
    ],
    outputs: [{ name: "dropId", type: "uint256" }],
  },
] as const;

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

const DROP_CREATED_TOPIC = keccak256(toBytes("DropCreated(uint256,address,address,uint256,uint256,uint256,uint256,uint256,uint256)"));

async function readTempoRpc(method: string, params: unknown[]) {
  const response = await fetch("https://rpc.tempo.xyz", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error("Tempo RPC request failed.");
  const body = await response.json() as { result?: string; error?: { message?: string } };
  if (body.error) throw new Error(body.error.message ?? "Tempo RPC error.");
  return body.result ?? "";
}

async function readTokenBalance(provider: NonNullable<Window["ethereum"]>, token: string, owner: string) {
  const selector = "0x70a08231";
  const paddedOwner = owner.slice(2).padStart(64, "0");
  const raw = await provider.request({
    method: "eth_call",
    params: [{ to: token, data: selector + paddedOwner }, "latest"],
  }) as string;
  return Number(BigInt(raw || "0")) / 1_000_000;
}

async function waitForReceipt(provider: NonNullable<Window["ethereum"]>, hash: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    }) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") throw new Error("Transaction reverted on Tempo.");
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error("Transaction confirmation timed out. Check the transaction on Tempo Explorer.");
}

export default function Home() {
  const [token, setToken] = useState("USDC");
  const [amount, setAmount] = useState("5");
  const [claims, setClaims] = useState("10");
  const [message, setMessage] = useState("Bug bounty — first valid report");
  const [created, setCreated] = useState(false);
  const [account, setAccount] = useState("");
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [walletError, setWalletError] = useState("");
  const [creating, setCreating] = useState(false);
  const [recentDrops, setRecentDrops] = useState<Array<{ id:string; creator:string; token:typeof tokens[number]; amountPerClaim:bigint; maxClaims:bigint; claimed:bigint }>>([]);
  const [recentDropsLoading, setRecentDropsLoading] = useState(true);

  const rewardTotal = Number(amount || 0) * Number(claims || 0);
  const creationFee = rewardTotal * 0.01;
  const claimFees = rewardTotal * 0.005;
  const total = rewardTotal.toFixed(2);
  const totalFunding = (rewardTotal + creationFee + claimFees).toFixed(2);
  const selectedToken = useMemo(() => tokens.find((t) => t.symbol === token) ?? tokens[0], [token]);

  async function connectWallet() {
    setWalletError("");
    if (!window.ethereum) {
      setWalletError("No EVM wallet detected. Install a wallet extension first.");
      return;
    }

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
            await window.ethereum.request({ method: "wallet_addEthereumChain", params: [TEMPO_CHAIN] });
          } else {
            throw switchError;
          }
        }
      }

      setAccount(current);
      const nextBalances: Record<string, number> = {};
      for (const item of tokens) {
        try {
          nextBalances[item.symbol] = await readTokenBalance(window.ethereum, item.address, current);
        } catch {
          nextBalances[item.symbol] = 0;
        }
      }
      setBalances(nextBalances);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  }

  async function createDrop() {
    setWalletError("");
    setCreated(false);

    if (!window.ethereum) {
      setWalletError("No EVM wallet detected.");
      return;
    }
    if (!account) {
      await connectWallet();
      return;
    }
    if (!SATODROPS_CONTRACT) {
      setWalletError("SatoDrops contract is not deployed/configured yet.");
      return;
    }

    const claimCount = Number(claims);
    if (!amount || Number(amount) <= 0) {
      setWalletError("Enter a reward amount greater than zero.");
      return;
    }
    if (!Number.isInteger(claimCount) || claimCount < 1 || claimCount > 20) {
      setWalletError("Claims must be a whole number between 1 and 20.");
      return;
    }

    try {
      setCreating(true);

      const rewardPerClaim = parseUnits(amount, selectedToken.decimals);
      const rewardTotalRaw = rewardPerClaim * BigInt(claimCount);
      const creationFeeRaw = rewardTotalRaw / 100n;
      const claimFeesRaw = rewardTotalRaw / 200n;
      const totalFundingRaw = rewardTotalRaw + creationFeeRaw + claimFeesRaw;

      const approveData = encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [SATODROPS_CONTRACT as `0x${string}`, totalFundingRaw],
      });

      const approvalHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: selectedToken.address,
          data: approveData,
          feeToken: PATH_USD_FEE_TOKEN,
        }],
      }) as string;

      await waitForReceipt(window.ethereum, approvalHash);

      const createData = encodeFunctionData({
        abi: satodropsAbi,
        functionName: "createDrop",
        args: [
          selectedToken.address as `0x${string}`,
          rewardPerClaim,
          BigInt(claimCount),
          0n,
          message,
        ],
      });

      const createHash = await window.ethereum.request({
        method: "eth_sendTransaction",
        params: [{
          from: account,
          to: SATODROPS_CONTRACT,
          data: createData,
          feeToken: PATH_USD_FEE_TOKEN,
        }],
      }) as string;

      const createReceipt = await waitForReceipt(window.ethereum, createHash);

      const logs = (createReceipt as { logs?: Array<{ address?: string; topics?: string[] }> }).logs ?? [];
      const contractLog = logs.find(
        (log) => log.address?.toLowerCase() === SATODROPS_CONTRACT.toLowerCase() && (log.topics?.length ?? 0) >= 2
      );
      const dropId = contractLog?.topics?.[1] ? BigInt(contractLog.topics[1]).toString() : "";

      if (!dropId) {
        throw new Error("Drop was funded, but the new drop ID could not be read from the transaction receipt.");
      }

      window.location.assign(`/claim?id=${dropId}`);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Drop creation failed.");
    } finally {
      setCreating(false);
    }
  }

  useEffect(() => {
    const loadRecentDrops = async () => {
      try {
        if (!SATODROPS_CONTRACT) return;
        const raw = await readTempoRpc("eth_getLogs", [{ address: SATODROPS_CONTRACT, fromBlock: "0x0", toBlock: "latest", topics: [DROP_CREATED_TOPIC] }]);
        const logs = JSON.parse(raw) as Array<{ topics?: string[] }>;
        const ids = logs.map((log) => log.topics?.[1] ? BigInt(log.topics[1]).toString() : "").filter(Boolean).slice(-10).reverse();
        const loaded = [];
        for (const id of ids) {
          const data = await readTempoRpc("eth_call", [{ to: SATODROPS_CONTRACT, data: encodeFunctionData({ abi: [{ type:"function", name:"drops", stateMutability:"view", inputs:[{name:"dropId",type:"uint256"}], outputs:[{name:"creator",type:"address"},{name:"token",type:"address"},{name:"amountPerClaim",type:"uint128"},{name:"maxClaims",type:"uint64"},{name:"claimed",type:"uint64"},{name:"expiresAt",type:"uint64"},{name:"closed",type:"bool"},{name:"message",type:"string"}] }] as const, functionName:"drops", args:[BigInt(id)] }) }, "latest"]);
          const hex = data.replace(/^0x/, "");
          const word = (i:number) => hex.slice(i*64,(i+1)*64);
          const tokenAddress = "0x" + word(1).slice(24);
          const tokenInfo = tokens.find((t) => t.address.toLowerCase() === tokenAddress.toLowerCase());
          if (tokenInfo) loaded.push({ id, creator:"0x"+word(0).slice(24), token:tokenInfo, amountPerClaim:BigInt("0x"+word(2)), maxClaims:BigInt("0x"+word(3)), claimed:BigInt("0x"+word(4)) });
        }
        setRecentDrops(loaded);
      } catch (error) { console.error("Could not load existing drops", error); }
      finally { setRecentDropsLoading(false); }
    };
    void loadRecentDrops();
  }, []);

  useEffect(() => {
    const provider = window.ethereum as Eip1193Provider | undefined;
    if (!provider?.on) return;
    const handleAccounts = (...args: unknown[]) => {
      const next = args[0] as string[] | undefined;
      if (!next?.[0]) {
        setAccount("");
        setBalances({});
      }
    };
    provider.on("accountsChanged", handleAccounts);
    return () => provider.removeListener?.("accountsChanged", handleAccounts);
  }, []);

  return (
    <main>
      <nav className="nav">
        <div className="brand"><span className="brand-mark">S</span><span>SatoDrops</span></div>
        <div className="nav-links"><a href="#how">How it works</a><a href="#create">Create a drop</a><button className="wallet-btn" onClick={connectWallet}><Wallet size={16}/> {account ? shortAddress(account) : "Connect wallet"}</button></div>
      </nav>

      {walletError && <div className="wallet-error">{walletError}</div>}

      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="live-dot"/> POWERED BY TEMPO</div>
          <h1>Tiny rewards.<br/><span>Instantly claimable.</span></h1>
          <p className="hero-text">Fund a small stablecoin reward, share one link, and let people claim it onchain.</p>
          <div className="hero-actions"><a className="primary" href="#create">Create a drop <ArrowUpRight size={17}/></a><a className="secondary" href="#how">See how it works</a></div>
          <div className="trust-row"><span>Stablecoin-native</span><i/> <span>Tempo mainnet</span><i/> <span>Non-custodial</span></div>
        </div>
        <div className="hero-card">
          <div className="card-glow"/>
          <div className="drop-preview">
            <div className="preview-top"><span className="pill">ACTIVE DROP</span><span className="mono">#A7F2</span></div>
            <div className="preview-icon">$</div>
            <div className="preview-amount">$5.00 <span>USDC</span></div>
            <p>First valid bug report gets a reward.</p>
            <div className="progress"><div style={{width:"60%"}}/></div>
            <div className="progress-meta"><span>6 of 10 claimed</span><span>$20 remaining</span></div>
            <button className="claim-demo">Claim $5.00 <ArrowUpRight size={16}/></button>
            <div className="tempo-chip"><span/> Settled on Tempo</div>
          </div>
        </div>
      </section>


      <section className="existing-drops">
        <div className="section-heading"><div><div className="eyebrow">ONCHAIN DROPS</div><h2>Recent drops</h2></div><span className="step-count">LIVE FROM TEMPO</span></div>
        {recentDropsLoading ? <div className="existing-empty">Loading existing drops…</div> : recentDrops.length === 0 ? <div className="existing-empty">No drops found yet.</div> : <div className="existing-grid">{recentDrops.map((item) => { const remaining=item.maxClaims-item.claimed; return <a className="existing-drop" href={"/claim?id="+item.id} key={item.id}><div className="existing-top"><span className="pill">{remaining===0n?"COMPLETED":"ACTIVE"}</span><span className="mono">#{item.id}</span></div><div className="existing-amount">{formatUnits(item.amountPerClaim,item.token.decimals)} <span>{item.token.symbol}</span></div><div className="existing-meta"><span>{item.claimed.toString()} / {item.maxClaims.toString()} claimed</span><span>{remaining.toString()} left</span></div><div className="progress"><div style={{width:(Math.min(100,Number(item.claimed*100n/item.maxClaims)))+"%"}}/></div><div className="existing-creator">Created by {shortAddress(item.creator)} <ArrowUpRight size={13}/></div></a>; })}</div>}
      </section>

      <section id="create" className="builder-section">
        <div className="section-heading"><div><div className="eyebrow">CREATE A DROP</div><h2>Turn a little value into an action.</h2></div><span className="step-count">01 / 02</span></div>
        <div className="builder">
          <div className="form-card">
            <label>Reward token</label>
            <div className="token-row">{tokens.map(t=><button key={t.symbol} className={token===t.symbol?"token active":"token"} onClick={()=>setToken(t.symbol)}>{t.symbol==="USDC"?"◉":t.symbol==="USDT"?"₮":"◇"} {t.symbol}</button>)}</div>
            {account && <div className="balance-row"><span>Connected balance</span><b>{(balances[selectedToken.symbol] ?? 0).toFixed(2)} {selectedToken.symbol}</b></div>}
            <div className="two-col">
              <div><label>Reward per person</label><div className="input-wrap"><input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/><span>{token}</span></div></div>
              <div><label>Number of claims</label><div className="input-wrap"><input value={claims} onChange={e=>setClaims(e.target.value)} inputMode="numeric" max={20}/><span>people</span></div></div>
            </div>
            <label>What is this reward for?</label>
            <textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={120}/>
            <div className="char-count">{message.length}/120</div>
            <button className="create-btn" onClick={createDrop} disabled={creating}><Sparkles size={17}/>{creating?"Waiting for wallet…":created?"Drop created":"Create drop"}</button>
          </div>
          <aside className="summary-card">
            <div className="summary-label">DROP SUMMARY</div>
            <div className="summary-total">{total} <span>{token}</span></div>
            <div className="summary-line"><span>Per claim</span><b>{amount || "0"} {token}</b></div>
            <div className="summary-line"><span>Claims</span><b>{claims || "0"}</b></div>
            <div className="summary-line"><span>Creation fee · 1%</span><b>{creationFee.toFixed(2)} {token}</b></div>
            <div className="summary-line"><span>Claim fees reserved · 0.5%</span><b>{claimFees.toFixed(2)} {token}</b></div>
            <div className="summary-line total-funding"><span>Total to fund</span><b>{totalFunding} {token}</b></div>
            <div className="summary-line"><span>Network</span><b><span className="network-dot"/> Tempo</b></div>
            <div className="summary-note">You fund the rewards plus the 1% creation fee and 0.5% claim fees upfront. Claimants receive the full reward amount.</div>
          </aside>
        </div>
      </section>


      <section id="how" className="how"><div className="eyebrow">THE LOOP</div><h2>Create. Fund. Share. Claim.</h2><div className="steps">{[["01","Create","Choose a stablecoin, amount and purpose."],["02","Fund","Approve the total reward on Tempo."],["03","Share","Send the claim link anywhere."],["04","Claim","A recipient connects and gets paid."]].map(([n,t,d])=><div className="step" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>)}</div></section>

      <footer><div className="brand"><span className="brand-mark">S</span><span>SatoDrops</span></div><span>Tiny programmable rewards, powered by Tempo.</span><a href="https://tempo.xyz" target="_blank" rel="noreferrer">Built for Tempo <ArrowUpRight size={14}/></a></footer>
    </main>
  );
}
