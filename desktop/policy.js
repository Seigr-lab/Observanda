export const windowPreferences = Object.freeze({nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:false});
export function localUrl(value,origin){
  try{const url=new URL(value);return !!origin&&url.origin===origin&&!url.username&&!url.password;}catch{return false;}
}
export function externalUrl(value){
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&value.length<=4096?url.href:null;}catch{return null;}
}
export function launchUrl(value){
  try{const url=new URL(value);return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!!url.port&&url.pathname==='/'&&!url.search&&/^#[a-f0-9]{64}$/.test(url.hash)&&!url.username&&!url.password;}catch{return false;}
}
