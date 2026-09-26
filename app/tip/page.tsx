"use client";

import { ArrowLeft, ArrowUpRight, Sparkles, Wallet } from "lucide-react";
import { encodeFunctionData, keccak256, parseUnits, toBytes } from "viem";
import { useMemo, useState } from "react";

const TEMPO_CHAIN_ID = "0x1079";
const TEMPO_RPC = "https://rpc.tempo.xyz";
const EXPLORER = "https://explore.tempo.xyz";
const SATOTIPS_CONTRACT = process.env.NEXT_PUBLIC_SATOTIPS_CONTRACT_ADDRESS ?? "";
const PATH_USD_FEE_TOKEN = "0x20c0000000000000000000000000000000000000";
const tokens = [
  { symbol:"USDC", address:"0x20c000000000000000000000b9537d11c60e8b50", decimals:6 },
  { symbol:"USDT", address:"0x20c00000000000000000000014f22ca97301eb73", decimals:6 },
  { symbol:"pathUSD", address:"0x20c0000000000000000000000000000000000000", decimals:6 }
];
const abi=[{type:"function",name:"createTip",stateMutability:"nonpayable",inputs:[
  {name:"token",type:"address"},{name:"amount",type:"uint128"},{name:"expiresAt",type:"uint64"},
  {name:"identityType",type:"uint8"},{name:"identityHash",type:"bytes32"},{name:"message",type:"string"}
],outputs:[{name:"tipId",type:"uint256"}]}] as const;
const erc20Abi=[{type:"function",name:"approve",stateMutability:"nonpayable",inputs:[{name:"spender",type:"address"},{name:"amount",type:"uint256"}],outputs:[{name:"",type:"bool"}]}] as const;
const TEMPO_CHAIN={chainId:TEMPO_CHAIN_ID,chainName:"Tempo Mainnet",nativeCurrency:{name:"USD",symbol:"USD",decimals:18},rpcUrls:[TEMPO_RPC],blockExplorerUrls:[EXPLORER]};

async function receipt(provider:NonNullable<Window["ethereum"]>,hash:string){
  for(let i=0;i<40;i++){const r=await provider.request({method:"eth_getTransactionReceipt",params:[hash]}) as {status?:string}|null;if(r){if(r.status==="0x0")throw new Error("Transaction reverted on Tempo.");return r;}await new Promise(r=>setTimeout(r,1500));}
  throw new Error("Transaction confirmation timed out. Check Tempo Explorer.");
}

export default function TipPage(){
  const [token,setToken]=useState("USDC"); const [amount,setAmount]=useState("5");
  const [identityType,setIdentityType]=useState<"x"|"telegram"|"wallet">("x"); const [identity,setIdentity]=useState("");
  const [message,setMessage]=useState("Thanks for your work"); const [account,setAccount]=useState("");
  const [creating,setCreating]=useState(false); const [error,setError]=useState("");
  const selected=useMemo(()=>tokens.find(t=>t.symbol===token)??tokens[0],[token]);
  const creationFee=Number(amount||0)*.01, claimFee=Number(amount||0)*.005;
  const total=(Number(amount||0)+creationFee+claimFee).toFixed(2);

  async function connect(){
    setError(""); if(!window.ethereum)return setError("No EVM wallet detected.");
    try{const a=await window.ethereum.request({method:"eth_requestAccounts"}) as string[];if(!a?.[0])return;
      const chain=await window.ethereum.request({method:"eth_chainId"}) as string;
      if(chain.toLowerCase()!==TEMPO_CHAIN_ID){try{await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:TEMPO_CHAIN_ID}]});}
      catch(e){if((e as {code?:number})?.code===4902)await window.ethereum.request({method:"wallet_addEthereumChain",params:[TEMPO_CHAIN]});else throw e;}}
      setAccount(a[0]);
    }catch(e){setError(e instanceof Error?e.message:"Wallet connection failed.");}
  }

  async function create(){
    setError(""); if(!window.ethereum)return setError("No EVM wallet detected."); if(!account){await connect();return;}
    if(!SATOTIPS_CONTRACT)return setError("SatoTips contract is not configured.");
    if(!amount||Number(amount)<=0)return setError("Enter an amount greater than zero.");
    if(!identity.trim())return setError("Enter the recipient identity.");
    if(identityType==="x"&&!/^@?[A-Za-z0-9_]{1,15}$/.test(identity.trim()))return setError("Enter a valid X handle.");
    if(identityType==="telegram"&&!/^@?[A-Za-z0-9_]{3,32}$/.test(identity.trim()))return setError("Enter a valid Telegram username.");
    if(identityType==="wallet"&&!/^0x[a-fA-F0-9]{40}$/.test(identity.trim()))return setError("Enter a valid wallet address.");
    try{
      setCreating(true);
      const normalized=identityType==="wallet"?identity.trim().toLowerCase():identity.trim().replace(/^@/,"").toLowerCase();
      const identityHash=keccak256(toBytes(normalized)); const amountRaw=parseUnits(amount,selected.decimals);
      const funding=amountRaw+amountRaw/100n+amountRaw/200n;
      const approve=encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[SATOTIPS_CONTRACT as `0x${string}`,funding]});
      const ah=await window.ethereum.request({method:"eth_sendTransaction",params:[{from:account,to:selected.address,data:approve,feeToken:PATH_USD_FEE_TOKEN}]}) as string;
      await receipt(window.ethereum,ah);
      const data=encodeFunctionData({abi,functionName:"createTip",args:[selected.address as `0x${string}`,amountRaw,0n,identityType==="x"?1:identityType==="telegram"?2:3,identityHash,message]});
      const h=await window.ethereum.request({method:"eth_sendTransaction",params:[{from:account,to:SATOTIPS_CONTRACT,data,feeToken:PATH_USD_FEE_TOKEN}]}) as string;
      const r=await receipt(window.ethereum,h); const logs=(r as {logs?:Array<{topics?:string[]}>}).logs??[];
      const log=logs.find(l=>(l.topics?.length??0)>=2); const tipId=log?.topics?.[1]?BigInt(log.topics[1]).toString():"";
      if(!tipId)throw new Error("Tip was funded, but the new tip ID could not be read.");
      window.location.assign("/tip/claim?id="+tipId);
    }catch(e){setError(e instanceof Error?e.message:"Tip creation failed.");}finally{setCreating(false);}
  }

  return <main className="claim-page"><nav className="nav"><a className="brand" href="/"><span className="brand-mark">S</span><span>SatoDrops</span></a><a className="secondary" href="/"><ArrowLeft size={15}/> Back</a></nav>
  {error&&<div className="wallet-error">{error}</div>}<section className="claim-shell"><div className="claim-card">
    <div className="eyebrow">SATODROPS · TIP</div><h1>Send a little value.</h1><p className="claim-message">Create a private, identity-restricted tip. Only the verified recipient can claim it.</p>
    <label>Recipient identity</label><div className="token-row" style={{marginTop:10}}>{[["x","X"],["telegram","Telegram"],["wallet","Wallet"]].map(([v,l])=><button key={v} className={identityType===v?"token active":"token"} onClick={()=>setIdentityType(v as typeof identityType)}>{l}</button>)}</div>
    <div className="input-wrap" style={{marginBottom:22}}><input value={identity} onChange={e=>setIdentity(e.target.value)} placeholder={identityType==="x"?"@username":identityType==="telegram"?"@username":"0x..."}/></div>
    <label>Token</label><div className="token-row" style={{marginTop:10}}>{tokens.map(t=><button key={t.symbol} className={token===t.symbol?"token active":"token"} onClick={()=>setToken(t.symbol)}>{t.symbol}</button>)}</div>
    <div className="input-wrap" style={{marginBottom:22}}><input value={amount} onChange={e=>setAmount(e.target.value)} inputMode="decimal"/><span>{token}</span></div>
    <label>Message</label><textarea value={message} onChange={e=>setMessage(e.target.value)} maxLength={120}/><div className="char-count">{message.length}/120</div>
    <button className="create-btn" onClick={create} disabled={creating}><Sparkles size={17}/>{creating?"Waiting for wallet…":"Create tip"}<ArrowUpRight size={16}/></button>
    <div className="summary-card" style={{marginTop:18}}><div className="summary-label">TIP SUMMARY</div><div className="summary-total">{amount||"0"} <span>{token}</span></div>
    <div className="summary-line"><span>Creation fee · 1%</span><b>{creationFee.toFixed(2)} {token}</b></div><div className="summary-line"><span>Claim fee reserved · 0.5%</span><b>{claimFee.toFixed(2)} {token}</b></div>
    <div className="summary-line"><span>Total to fund</span><b>{total} {token}</b></div><div className="summary-note">The recipient receives the full tip. Identity verification is required before claiming.</div></div>
    {account&&<div className="claim-wallet"><Wallet size={12}/> Connected {account.slice(0,6)}…{account.slice(-4)}</div>}
  </div></section></main>;
}
