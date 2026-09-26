"use client";

import { ArrowUpRight, Check, ChevronDown, Copy, Link2, Sparkles, Wallet } from "lucide-react";
import { useState } from "react";

const tokens = ["USDC", "USDT", "pathUSD"];

export default function Home() {
  const [token, setToken] = useState("USDC");
  const [amount, setAmount] = useState("5");
  const [claims, setClaims] = useState("10");
  const [message, setMessage] = useState("Bug bounty — first valid report");
  const [created, setCreated] = useState(false);

  const total = (Number(amount || 0) * Number(claims || 0)).toFixed(2);

  return (
    <main>
      <nav className="nav">
        <div className="brand"><span className="brand-mark">S</span><span>SatoDrops</span></div>
        <div className="nav-links"><a href="#how">How it works</a><a href="#create">Create a drop</a><button className="wallet-btn"><Wallet size={16}/> Connect wallet</button></div>
      </nav>

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
            <div className="token-row">{tokens.map(t=><button key={t} className={token===t?"token active":"token"} onClick={()=>setToken(t)}>{t==="USDC"?"◉":t==="USDT"?"₮":"◇"} {t}</button>)}</div>
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
            <div className="summary-line"><span>Network</span><b><span className="network-dot"/> Tempo</b></div>
            <div className="summary-note">You fund the full drop once. Unclaimed funds remain locked until the drop expires or is closed.</div>
          </aside>
        </div>
      </section>

      <section id="how" className="how"><div className="eyebrow">THE LOOP</div><h2>Create. Fund. Share. Claim.</h2><div className="steps">{[["01","Create","Choose a stablecoin, amount and purpose."],["02","Fund","Approve the total reward on Tempo."],["03","Share","Send the claim link anywhere."],["04","Claim","A recipient connects and gets paid."]].map(([n,t,d])=><div className="step" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></div>)}</div></section>

      <footer><div className="brand"><span className="brand-mark">S</span><span>SatoDrops</span></div><span>Tiny programmable rewards, powered by Tempo.</span><a href="https://tempo.xyz" target="_blank">Built for Tempo <ArrowUpRight size={14}/></a></footer>
    </main>
  );
}