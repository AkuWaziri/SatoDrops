"use client";

import { ArrowLeft, ArrowUpRight, Check, Wallet } from "lucide-react";
import { decodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbiParameters } from "viem";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
    onTelegramAuth?: (data: Record<string, string>) => void;
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
  {name:"identityType",type:"uint8"},{name:"identityHash",type:"bytes32"}
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
  const values=decodeAbiParameters(
    parseAbiParameters("address,address,uint128,uint64,bool,bool,uint8,bytes32"),
    raw as `0x${string}`
  );
  const [creator,tokenAddress,amount,expiresAt,claimed,closed,identityType,identityHash]=values;
  const token=tokens.find(t=>t.address.toLowerCase()===tokenAddress.toLowerCase());
  if(!token) throw new Error("This tip uses an unsupported token.");
  return {
    creator,
    token,
    amount,
    expiresAt,
    claimed,
    closed,
    identityType,
    identityHash,
    message:""
  };
}
