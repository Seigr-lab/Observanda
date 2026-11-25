import {randomBytes} from 'node:crypto';
import {AppError} from './errors.js';
import {serveContent} from './file-content.js';

// Previews of pages that do not exist yet (website starters, page layouts) are shown
// in frames. A frame written from the app inherits the app's strict style policy and
// drops the preview's own styles, so each preview is kept here briefly and served as
// its own document with a policy that allows its inline styles and nothing else.
export const sandboxPreviewPolicy="sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
const limit={entries:64,bytes:2*1024*1024,lifetime:10*60*1000};

export function sandboxPreviews({now=()=>Date.now()}={}){
 const entries=new Map();
 function prune(){
  const time=now();
  for(const [token,entry] of entries)if(entry.expires<=time)entries.delete(token);
  while(entries.size>=limit.entries)entries.delete(entries.keys().next().value);
 }
 return {
  // Keeps one preview for this workspace and returns the token that reads it.
  keep(contextId,html){
   if(typeof html!=='string'||!html||Buffer.byteLength(html)>limit.bytes)throw new AppError('INVALID');
   prune();const token=randomBytes(24).toString('hex');
   entries.set(token,{contextId,html,expires:now()+limit.lifetime});return token;
  },
  // A preview is read only from the workspace that kept it, and only while it is fresh.
  read(contextId,token){
   const entry=/^[a-f0-9]{48}$/.test(token)?entries.get(token):null;
   if(!entry||entry.contextId!==contextId||entry.expires<=now())throw new AppError('NOT_FOUND');
   return entry.html;
  }
 };
}

// One store for the running app. A sandboxed frame cannot carry the app's session, so the
// random, short-lived address is the permission to read that one preview, and only while
// the same workspace is open.
export const sandboxPreviewStore=sandboxPreviews();
export const sandboxPreviewPath='/api/website-files/sandbox-preview/';
export async function serveSandboxPreview(req,res,{pathname,contextId,store=sandboxPreviewStore}){
 if(req.method!=='GET')throw new AppError('NOT_FOUND');
 const html=store.read(contextId,pathname.slice(sandboxPreviewPath.length));
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',sandboxPreviewPolicy);
 await serveContent(req,res,Buffer.from(html),'text/html; charset=utf-8');
}
