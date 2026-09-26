"use client";

import { ArrowLeft, ArrowUpRight, Sparkles, Wallet } from "lucide-react";
import { encodeFunctionData, keccak256, parseUnits, toBytes } from "viem";
import { useEffect, useMemo, useState } from "react";

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
const TIP_CREATED_TOPIC=keccak256(toBytes("TipCreated(uint256,address,address,uint256,uint256,uint8,bytes32,uint256,uint256)"));
const TIP_CLAIMED_TOPIC=keccak256(toBytes("TipClaimed(uint256,address,uint256,uint256)"));
const TIPS_DEPLOYMENT_TX="0x86205da7139e30e48c04e37a3a2d6c80458d334ebeec7cfe5fc2dc8d5990aafc";
const tipViewAbi=[{type:"function",name:"tips",stateMutability:"view",inputs:[{name:"tipId",type:"uint256"}],outputs:[{name:"creator",type:"address"},{name:"token",type:"address"},{name:"amount",type:"uint128"},{name:"expiresAt",type:"uint64"},{name:"claimed",type:"bool"},{name:"closed",type:"bool"},{name:"identityType",type:"uint8"},{name:"identityHash",type:"bytes32"},{name:"message",type:"string"}]}] as const;
async function rpc(method:string,params:unknown[]){const response=await fetch(TEMPO_RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});if(!response.ok)throw new Error("Tempo RPC request failed.");const body=await response.json() as {result?:unknown;error?:{message?:string}};if(body.error)throw new Error(body.error.message??"Tempo RPC error.");return body.result;}
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

  const [recentTips,setRecentTips]=useState<Array<{id:string;creator:string;token:typeof tokens[number];amount:bigint;claimed:boolean;closed:boolean;creationTx:string;claimTxs:string[]}>>([]);
  const [tipsLoading,setTipsLoading]=useState(true);

  useEffect(()=>{const load=async()=>{try{if(!SATOTIPS_CONTRACT||!account){setRecentTips([]);return;}const dep=await rpc("eth_getTransactionReceipt",[TIPS_DEPLOYMENT_TX]) as {blockNumber?:string};if(!dep.blockNumber)throw new Error("Could not determine the SatoTips deployment block.");const latest=BigInt(String(await rpc("eth_blockNumber",[])));const deployment=BigInt(dep.blockNumber);const max=100000n;const candidate=latest>max?latest-max+1n:deployment;const from=candidate>deployment?candidate:deployment;const raw=await rpc("eth_getLogs",[{address:SATOTIPS_CONTRACT,fromBlock:"0x"+from.toString(16),toBlock:"0x"+latest.toString(16),topics:[TIP_CREATED_TOPIC]}]) as Array<{topics?:string[];transactionHash?:string}>;const wallet=account.toLowerCase();const owned=raw.filter(l=>(l.topics?.[2]??"").slice(-40).toLowerCase()===wallet.slice(2));const ids=owned.map(l=>l.topics?.[1]?BigInt(l.topics[1]).toString():"").filter(Boolean).slice(-10).reverse();const claimRaw=await rpc("eth_getLogs",[{address:SATOTIPS_CONTRACT,fromBlock:"0x"+from.toString(16),toBlock:"0x"+latest.toString(16),topics:[TIP_CLAIMED_TOPIC]}]) as Array<{topics?:string[];transactionHash?:string}>;const loaded=[];for(const id of ids){const creation=owned.find(l=>l.topics?.[1]&&BigInt(l.topics[1]).toString()===id);const claimTxs=claimRaw.filter(l=>l.topics?.[1]&&BigInt(l.topics[1]).toString()===id&&l.transactionHash).map(l=>l.transactionHash as string);const data=String(await rpc("eth_call",[{to:SATOTIPS_CONTRACT,data:encodeFunctionData({abi:tipViewAbi,functionName:"tips",args:[BigInt(id)]})},"latest"]));const hex=data.replace(/^0x/,"");const word=(i:number)=>hex.slice(i*64,(i+1)*64);const tokenAddress="0x"+word(1).slice(24);const tokenInfo=tokens.find(t=>t.address.toLowerCase()===tokenAddress.toLowerCase());if(tokenInfo)loaded.push({id,creator:"0x"+word(0).slice(24),token:tokenInfo,amount:BigInt("0x"+word(2)),claimed:BigInt("0x"+word(4))!==0n,closed:BigInt("0x"+word(5))!==0n,creationTx:creation?.transactionHash??"",claimTxs});}setRecentTips(loaded);}catch(e){console.error("Could not load existing tips",e);}finally{setTipsLoading(false);}};void load();},[account]);

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
    {account&&<div className="claim-wallet"><Wallet size={12}/> Connected {account.slice(0,6)}…{account.slice(-4)}</div>}<section className="existing-drops">
  <div className="section-heading"><div><div className="eyebrow">YOUR ONCHAIN TIPS</div><h2>Recent tips</h2></div><span className="step-count">PRIVATE TO CONNECTED WALLET</span></div>
  {!account ? <div className="existing-empty">Connect your wallet to view your tips.</div> : tipsLoading ? <div className="existing-empty">Loading your tips…</div> : recentTips.length === 0 ? <div className="existing-empty">No tips created by this wallet yet.</div> : <div className="existing-grid">{recentTips.map(item=><a className="existing-drop" href={"/tip/claim?id="+item.id} key={item.id}><div className="existing-top"><span className="pill">{item.claimed?"CLAIMED":item.closed?"CLOSED":"ACTIVE"}</span><span className="mono">#{item.id}</span></div><div className="existing-amount">{(Number(item.amount)/10**item.token.decimals).toFixed(2)} <span>{item.token.symbol}</span></div><div className="existing-meta"><span>{item.claimed?"Claimed":"Awaiting claim"}</span><span>1 recipient</span></div><div className="existing-creator">Created by {item.creator.slice(0,6)}…{item.creator.slice(-4)} <ArrowUpRight size={13}/></div>{item.creationTx&&<div className="existing-tx"><span>Tip TX</span><a href={EXPLORER+"/tx/"+item.creationTx} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>View transaction <ArrowUpRight size={12}/></a></div>}{item.claimTxs.length>0&&<div className="existing-tx"><span>Claim transaction</span><a href={EXPLORER+"/tx/"+item.claimTxs[item.claimTxs.length-1]} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>View claim <ArrowUpRight size={12}/></a></div>}</a>)}</div>}
</section>
  </div></section></main>;
}
