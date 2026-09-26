"use client";

import { ArrowLeft, ArrowUpRight, Check, Wallet } from "lucide-react";
import { encodeFunctionData, encodePacked, keccak256 } from "viem";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

const CHAIN = "0x1079";
const RPC = "https://rpc.tempo.xyz";
const EXPLORER = "https://explore.tempo.xyz";
const CONTRACT = process.env.NEXT_PUBLIC_SATOTIPS_CONTRACT_ADDRESS ?? "";
const FEE_TOKEN = "0x20c0000000000000000000000000000000000000";

const tokens = [
  { symbol:"USDC", address:"0x20c000000000000000000000b9537d11c60e8b50", decimals:6 },
  { symbol:"USDT", address:"0x20c00000000000000000000014f22ca97301eb73", decimals:6 },
  { symbol:"pathUSD", address:"0x20c0000000000000000000000000000000000000", decimals:6 }
];

const tipAbi = [{type:"function",name:"tips",stateMutability:"view",inputs:[{name:"tipId",type:"uint256"}],outputs:[
  {name:"creator",type:"address"},{name:"token",type:"address"},{name:"amount",type:"uint128"},
  {name:"expiresAt",type:"uint64"},{name:"claimed",type:"bool"},{name:"closed",type:"bool"},
  {name:"identityType",type:"uint8"},{name:"identityHash",type:"bytes32"},{name:"message",type:"string"}
]}] as const;

const claimAbi = [{type:"function",name:"claimTip",stateMutability:"nonpayable",inputs:[
  {name:"tipId",type:"uint256"},{name:"verificationSignature",type:"bytes"}
],outputs:[]}] as const;

async function rpc(method:string,params:unknown[]) {
  const response=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  if(!response.ok) throw new Error("Tempo RPC request failed.");
  const body=await response.json() as {result?:unknown;error?:{message?:string}};
  if(body.error) throw new Error(body.error.message??"Tempo RPC error.");
  return body.result;
}

async function waitReceipt(provider:NonNullable<Window["ethereum"]>,hash:string) {
  for(let i=0;i<40;i++) {
    const r=await provider.request({method:"eth_getTransactionReceipt",params:[hash]}) as {status?:string}|null;
    if(r) { if(r.status==="0x0") throw new Error("Transaction reverted on Tempo."); return; }
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error("Transaction confirmation timed out. Check Tempo Explorer.");
}

function decode(raw:string) {
  const hex=raw.replace(/^0x/,"");
  const word=(i:number)=>hex.slice(i*64,(i+1)*64);
  const tokenAddress=("0x"+word(1).slice(24)).toLowerCase();
  const token=tokens.find(t=>t.address.toLowerCase()===tokenAddress);
  if(!token) throw new Error("This tip uses an unsupported token.");
  const offset=Number(BigInt("0x"+word(8)));
  let message="";
  if(offset>0 && offset*2+64<=hex.length) {
    const start=offset*2;
    const length=Number(BigInt("0x"+hex.slice(start,start+64)));
    const bytes=hex.slice(start+64,start+64+length*2).match(/../g)??[];
    message=new TextDecoder().decode(Uint8Array.from(bytes.map(x=>parseInt(x,16))));
  }
  return {
    creator:"0x"+word(0).slice(24),token,amount:BigInt("0x"+word(2)),
    expiresAt:BigInt("0x"+word(3)),claimed:BigInt("0x"+word(4))!==0n,
    closed:BigInt("0x"+word(5))!==0n,identityType:Number(BigInt("0x"+word(6))),
    identityHash:("0x"+word(7)) as `0x${string}`,message
  };
}

export default function TipClaimPage() {
  const [id,setId]=useState("");
  const [tip,setTip]=useState<ReturnType<typeof decode>|null>(null);
  const [account,setAccount]=useState("");
  const [verified,setVerified]=useState(false);
  const [verifiedIdentity,setVerifiedIdentity]=useState("");
  const [loading,setLoading]=useState(true);
  const [working,setWorking]=useState(false);
  const [error,setError]=useState("");
  const [tx,setTx]=useState("");
  const telegramRef = useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const tipId=params.get("id")??"";
    setId(tipId);
    if(!CONTRACT||!/^\d+$/.test(tipId)){setError("Invalid tip link.");setLoading(false);return;}
    void (async()=>{
      try {
        const data=encodeFunctionData({abi:tipAbi,functionName:"tips",args:[BigInt(tipId)]});
        const raw=await rpc("eth_call",[{to:CONTRACT,data},"latest"]) as string;
        setTip(decode(raw));
      } catch(e) { setError(e instanceof Error?e.message:"Could not load tip."); }
      finally { setLoading(false); }
    })();
    if(params.get("auth")==="x"){setVerified(true);setVerifiedIdentity("X identity verified");}
  },[]);

  async function connect() {
    setError("");
    if(!window.ethereum)return setError("No EVM wallet detected.");
    try {
      const a=await window.ethereum.request({method:"eth_requestAccounts"}) as string[];
      if(!a?.[0])return;
      const chain=await window.ethereum.request({method:"eth_chainId"}) as string;
      if(chain.toLowerCase()!==CHAIN){
        try { await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:CHAIN}]}); }
        catch(e) {
          if((e as {code?:number})?.code===4902) await window.ethereum.request({method:"wallet_addEthereumChain",params:[{
            chainId:CHAIN,chainName:"Tempo Mainnet",nativeCurrency:{name:"USD",symbol:"USD",decimals:18},
            rpcUrls:[RPC],blockExplorerUrls:[EXPLORER]
          }]});
          else throw e;
        }
      }
      setAccount(a[0]);
    } catch(e) { setError(e instanceof Error?e.message:"Wallet connection failed."); }
  }

  function verifyX() {
    window.location.assign("/api/auth/x/start?return=claim&id="+encodeURIComponent(id));
  }

  useEffect(() => {
    if (!tip || tip.identityType !== 2 || !telegramRef.current) return;
    const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;
    if (!botUsername) return;
    window.onTelegramAuth = async (data: Record<string, string>) => {
      setError("");
      try {
        const response = await fetch("/api/auth/telegram/verify", {
          method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify(data)
        });
        const result = await response.json() as {ok?:boolean;identity?:string;error?:string};
        if (!response.ok || !result.ok) throw new Error(result.error ?? "Telegram verification failed.");
        setVerified(true);
        setVerifiedIdentity("Telegram @" + (result.identity ?? data.username));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Telegram verification failed.");
      }
    };
    const script=document.createElement("script");
    script.src="https://telegram.org/js/telegram-widget.js?22";
    script.async=true;
    script.setAttribute("data-telegram-login",botUsername);
    script.setAttribute("data-size","large");
    script.setAttribute("data-userpic","false");
    script.setAttribute("data-request-access","write");
    script.setAttribute("data-onauth","onTelegramAuth(user)");
    telegramRef.current.innerHTML="";
    telegramRef.current.appendChild(script);
    return () => { if (telegramRef.current) telegramRef.current.innerHTML=""; };
  },[tip]);

  function verifyTelegram() {
    if (!process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME) setError("Telegram authentication is not configured.");
  }

  async function claim() {
    setError("");
    if(!tip||!window.ethereum)return;
    try {
      setWorking(true);
      const accounts=await window.ethereum.request({method:"eth_accounts"}) as string[];
      const wallet=accounts?.[0];
      if(!wallet) throw new Error("Connect the wallet that should receive the tip.");
      if(tip.claimed) throw new Error("This tip has already been claimed.");
      if(tip.closed) throw new Error("This tip is closed.");
      if(tip.expiresAt!==0n && BigInt(Math.floor(Date.now()/1000))>=tip.expiresAt) throw new Error("This tip has expired.");

      let signature="0x";
      if(tip.identityType===3) {
        const expected=keccak256(encodePacked(["address"],[wallet as `0x${string}`]));
        if(expected.toLowerCase()!==tip.identityHash.toLowerCase()) throw new Error("This tip is restricted to a different wallet.");
      } else {
        if(!verified) throw new Error("Verify the recipient identity first.");
        const response=await fetch("/api/tip/authorize",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({tipId:id,wallet})});
        const result=await response.json() as {signature?:string;error?:string};
        if(!response.ok||!result.signature)throw new Error(result.error??"Identity authorization failed.");
        signature=result.signature;
      }

      const data=encodeFunctionData({abi:claimAbi,functionName:"claimTip",args:[BigInt(id),signature as `0x${string}`]});
      const hash=await window.ethereum.request({method:"eth_sendTransaction",params:[{from:wallet,to:CONTRACT,data,feeToken:FEE_TOKEN}]}) as string;
      await waitReceipt(window.ethereum,hash);
      setTx(hash);
      setTip({...tip,claimed:true});
    } catch(e) { setError(e instanceof Error?e.message:"Claim failed."); }
    finally { setWorking(false); }
  }

  if(loading)return <main className="claim-page"><section className="claim-shell"><div className="claim-card"><div className="eyebrow">SATODROPS · TIP</div><h1>Loading tip…</h1></div></section></main>;
  if(!tip)return <main className="claim-page"><section className="claim-shell"><div className="claim-card"><div className="eyebrow">SATODROPS · TIP</div><h1>Tip unavailable</h1><p className="claim-message">{error||"This tip could not be loaded."}</p></div></section></main>;

  const identity=tip.identityType===1?"X":tip.identityType===2?"Telegram":"Wallet";
  return <main className="claim-page">
    <nav className="nav"><a className="brand" href="/"><span className="brand-mark">S</span><span>SatoDrops</span></a><a className="secondary" href="/tip"><ArrowLeft size={15}/> Back</a></nav>
    <section className="claim-shell"><div className="claim-card">
      <div className="eyebrow">SATODROPS · TIP #{id}</div><h1>Someone sent you a tip.</h1>
      <p className="claim-message">{tip.message||"A private tip is waiting for its verified recipient."}</p>
      <div className="summary-card"><div className="summary-label">TIP</div>
        <div className="summary-total">{(Number(tip.amount)/10**tip.token.decimals).toFixed(2)} <span>{tip.token.symbol}</span></div>
        <div className="summary-line"><span>Recipient identity</span><b>{identity}</b></div>
        <div className="summary-line"><span>Creator</span><b>{tip.creator.slice(0,6)}…{tip.creator.slice(-4)}</b></div>
      </div>
      {tip.claimed||tip.closed ? <div className="success-box"><Check size={16}/>{tip.claimed?"This tip has been claimed.":"This tip is closed."}</div> : <>
        {tip.identityType!==3 && <div className="claim-wallet">
          <span>{verified?"Identity verified":"Verify recipient identity"}</span>
          {tip.identityType===1
            ? <button className="create-btn" onClick={verifyX} disabled={working}>{verified?"X verified":"Verify with X"}</button>
            : <div ref={telegramRef}>{!verified && <button className="create-btn" onClick={verifyTelegram} disabled={working}>Verify with Telegram</button>}</div>}
        </div>}
        {verifiedIdentity&&<div className="success-box"><Check size={15}/>{verifiedIdentity}</div>}
        <button className="create-btn" onClick={()=>void connect()} disabled={working}><Wallet size={16}/>{account?"Wallet connected":"Connect wallet"}<ArrowUpRight size={15}/></button>
        {error&&<div className="wallet-error">{error}</div>}
        <button className="create-btn" onClick={()=>void claim()} disabled={working||!account}><Check size={16}/>{working?"Claiming…":"Claim tip"}<ArrowUpRight size={15}/></button>
      </>}
      {tx&&<div className="success-box"><Check size={15}/> Tip claimed successfully. <a href={EXPLORER+"/tx/"+tx} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={12}/></a></div>}
    </div></section>
  </main>;
}
