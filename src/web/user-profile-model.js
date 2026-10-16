// Personal descriptions are editable claims. Sharing authenticates the existing
// signing key; neither a name nor an external identifier grants access.
export const USER_PROFILE_BYTES=64*1024;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,max)=>typeof v==='string'&&v.length<=max&&!/[\u0000-\u001f\u007f]/u.test(v);
export const observandaUserId=fingerprint=>/^[a-f0-9]{64}$/.test(fingerprint??'')?'observanda:user:'+fingerprint:null;
export const emptyUserProfile=()=>({username:'',name:'',email:'',description:'',identifiers:[]});
export function validProfileURL(value){
 if(value==='')return true;if(!text(value,2048))return false;
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}
}
export function validUserProfile(value){
 return exact(value,['username','name','email','description','identifiers'])&&text(value.username,80)&&text(value.name,160)&&text(value.email,254)&&(!value.email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.email))&&text(value.description,2000)&&Array.isArray(value.identifiers)&&
  value.identifiers.every(item=>exact(item,['id','label','value','url'])&&typeof item.id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(item.id)&&text(item.label,80)&&item.label.trim()&&text(item.value,2048)&&item.value.trim()&&validProfileURL(item.url))&&
  new Set(value.identifiers.map(item=>item.id)).size===value.identifiers.length&&new TextEncoder().encode(JSON.stringify(value)).length<=USER_PROFILE_BYTES;
}
