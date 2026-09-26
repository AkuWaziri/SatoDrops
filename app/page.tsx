"use client";

import { ArrowUpRight, Sparkles, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const TEMPO_CHAIN_ID = "0x1079";
const TEMPO_CHAIN = {
  chainId: TEMPO_CHAIN_ID,
  chainName: "Tempo Mainnet",
  nativeCurrency: { name: "USD", symbol: "USD", decimals: 18 },
  rpcUrls: ["https://rpc.tempo.xyz"],
  blockExplorerUrls: ["https://explore.tempo.xyz"],
};

const tokens = [
  { symbol: "USDC", address: "0x20c000000000000000000000b9537d11c60e8b50", decimals: 6 },
  { symbol: "USDT", address: "0x20c00000000000000000000014f22ca97301eb73", decimals: 6 },
  { symbol: "pathUSD", address: "0x20c0000000000000000000000000000000000000", decimals: 6 },
];

const shortAddress = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`;

async function readTokenBalance(provider: NonNullable<Window["ethereum"]>, token: string, owner: string) {
  const selector = "0x70a08231";
  const paddedOwner = owner.slice(2).padStart(64, "0");
  const raw = await provider.request({
    method: "eth_call",
    params: [{ to: token, data: selector + paddedOwner }, "latest"],
  }) as string;
  return Number(BigInt(raw || "0")) / 1_000_000;
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

  useEffect(() => {
    if (!window.ethereum?.on) return;
    const handleAccounts = (...args: unknown[]) => {
      const next = args[0] as string[] | undefined;
      if (!next?.[0]) {
        setAccount("");
        setBalances({});
      }
    };
    window.ethereum.on("accountsChanged", handleAccounts);
    return () => window.ethereum?.removeListener?.("accountsChanged", handleAccounts);
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

      <section id="create" className="builder-section">
        <div className="section-heading"><div><div className="eyebrow">CREATE A DROP</div><h2>Turn a little value into an action.</h2></div><span className="step-count">01 / 02</span></div>
        <div className="builder">
          <div className="form-card">
            <label>Reward token</label>
            <div className="token-row">{tokens.map(t=><button key={t.symbol} className={token===t.symbol?"token active":"token"} onClick={()=>setToken(t.symbol)}>{t.symbol==="USDC"?"◉":t.symbol==="USDT"?"₮":"◇"} {t.symbol}</button>)}</div>
            {account && <div className="balance-row"><span>Connected balance</span><b>{(balances[selectedToken.symbol] ?? 0).toFixed(2)} {selectedToken.symbol}</b></div>}
            <div className="two-col">
              <div><label>Reward per person</label><div className="input-wrap"><input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/><span>{token}</span></div></div>
              <div><label>Number of claims</label><div className="input-wrap"><input value={claims} onChange={e=>setClaims(e.target.value)} inputMode="numeric"/><span>people</span></div></div>
            </div>
            <label>What is this reward for?</label>
            <textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={120}/>
            <div className="char-count">{message.length}/120</div>
            <button className="create-btn" onClick={()=>setCreated(true)}><Sparkles size={17}/>{created?"Drop ready":"Create drop"}</button>
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
