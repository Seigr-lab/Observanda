export const windowPreferences = Object.freeze({nodeIntegration:false,nodeIntegrationInWorker:false,nodeIntegrationInSubFrames:false,contextIsolation:true,sandbox:true,webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:false});
export function deviceProtectionAvailable(storage,platform=process.platform){
  try{
    if(platform!=='darwin'&&platform!=='linux'||storage.isEncryptionAvailable()!==true)return false;
    // Linux's basic_text backend has no OS credential protection. Only admit
    // known keyring backends, including on every request after startup.
    return platform==='darwin'||['gnome_libsecret','kwallet','kwallet5','kwallet6'].includes(storage.getSelectedStorageBackend());
  }catch{return false;}
}
export function protectDeviceValue(storage,message,platform=process.platform){
  try{
    if(typeof message.value!=='string'||message.value.length>32768||!['encrypt','decrypt'].includes(message.operation)||!deviceProtectionAvailable(storage,platform))return;
    return message.operation==='encrypt'?storage.encryptString(message.value).toString('base64'):storage.decryptString(Buffer.from(message.value,'base64'));
  }catch{}
}
export function localUrl(value,origin){
  try{const url=new URL(value);return !!origin&&url.origin===origin&&!url.username&&!url.password;}catch{return false;}
}
export function externalUrl(value){
  try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&value.length<=4096?url.href:null;}catch{return null;}
}
export function launchUrl(value){
  try{const url=new URL(value);return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!!url.port&&url.pathname==='/'&&!url.search&&/^#[a-f0-9]{64}$/.test(url.hash)&&!url.username&&!url.password;}catch{return false;}
}
