import {readFile} from 'node:fs/promises';
import path from 'node:path';
const web=path.resolve('src/web');

export async function mountFilesEditor(page,{resource=()=>'',hash='',httpOrigin}={}){
 const origin=httpOrigin??'https://website.test';
 const api=httpOrigin?`async(route,data,{signal,onProgress}={})=>{
  const res=await fetch(route,{method:'POST',signal,headers:{'Content-Type':'application/json',...(onProgress?{Accept:'application/x-ndjson'}:{})},body:JSON.stringify(data??{})});
  if(!res.ok)throw await res.json();return onProgress?readProgressStream(res,onProgress):res.json();}`:
  `async(route,data)=>{const response=await window.filesAPI(route,data);if(response?.errorCode)throw Object.assign(Error(response.message),{code:response.errorCode});return response;}`;
 await page.route(origin+'/**',async route=>{
  const url=new URL(route.request().url());if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:`<!doctype html><main id="root"></main><script type="module">
   import {websiteFilesUI} from '/website-files-ui.js';const root=document.querySelector('#root'),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
   ${httpOrigin?"import {readProgressStream} from '/progress-stream.js';":''}
   const files=websiteFilesUI({api:${api},esc,render(){root.innerHTML=files.view();files.bind();}});root.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b)files.action(b);});root.addEventListener('input',e=>files.input(e.target));root.addEventListener('submit',e=>{e.preventDefault();files.submit(e.target);});await files.load();</script>`});
  if(httpOrigin&&url.pathname.startsWith('/api/'))return route.continue();
  if(/^\/api\/website-files\/(?:preview|edition)\//.test(url.pathname))return route.fulfill({contentType:url.pathname.endsWith('.css')?'text/css':'text/html',headers:{'Content-Security-Policy':"default-src 'none'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'"},body:url.searchParams.has('canvas')?'<!doctype html><body></body>':resource(url)});
  const file=path.resolve(web,'.'+url.pathname);if(!file.startsWith(web+path.sep))return route.abort();try{return await route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'text/css',body:await readFile(file)});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto(origin+'/'+hash);
}
