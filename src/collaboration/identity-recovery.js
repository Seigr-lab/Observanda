import {randomBytes,createPrivateKey,createPublicKey} from 'node:crypto';
import {passwordKey,seal,unseal} from '../encryption.js';
import {deviceFingerprint,validatePublicDevice} from '../security/device-store.js';
import {CollaborationIdentityStore,collaborationPairId} from './identity-store.js';
import {AppError} from '../errors.js';
import {exact} from '../modules/validation.js';

const format='observanda-collaboration-identity-v1',kdf='scrypt-131072-8-1',roles=['signing','encryption'];
const aad=salt=>JSON.stringify({format,kdf,salt});
const clear=pair=>{for(const role of roles)pair?.[role]?.bytes?.fill(0);};
const passwordValid=value=>typeof value==='string'&&value.length>=12&&value.length<=1024&&Buffer.byteLength(value)<=4096;
const fail=()=>{throw new AppError('COLLABORATION_IDENTITY_FILE');};
function base64(value,max){if(typeof value!=='string'||!value.length||value.length>max)fail();const bytes=Buffer.from(value,'base64');if(bytes.toString('base64')!==value)fail();return bytes;}
const pairView=pair=>({id:collaborationPairId(pair),...Object.fromEntries(roles.map(role=>[role,pair[role].public]))});
async function open(file,password){
 let key,plain;const pair={};
 try{
  if(!passwordValid(password)||!exact(file,['format','kdf','salt','content'])||file.format!==format||file.kdf!==kdf)fail();
  const salt=base64(file.salt,64),content=base64(file.content,20000);if(salt.length!==32||content.length<36)fail();
  key=await passwordKey(password,salt);plain=unseal(content,key,aad(file.salt));const payload=JSON.parse(plain.toString('utf8'));if(!exact(payload,roles))fail();
  for(const role of roles){
   const bytes=base64(payload[role],6000);pair[role]={bytes};const privateKey=createPrivateKey({key:bytes,format:'der',type:'pkcs8'}),publicKey=createPublicKey(privateKey).export({format:'der',type:'spki'}).toString('base64');
   pair[role].public=validatePublicDevice({format:'observanda-device-v1',id:deviceFingerprint(publicKey),publicKey});
  }
  if(pair.signing.public.id===pair.encryption.public.id)fail();return pair;
 }catch{clear(pair);fail();}finally{key?.fill(0);plain?.fill(0);}
}

export class CollaborationRecovery{
 constructor(device){this.store=new CollaborationIdentityStore(device);}
 state(){return this.store.state();}
 async backup(password,confirmation){
  if(!passwordValid(password)||password!==confirmation)throw new AppError('COLLABORATION_IDENTITY_PASSWORD');
  let key,plain;const pair={};
  try{
   for(const role of roles){const value=await this.store.privateKey(role);pair[role]={public:value.identity,bytes:value.key.export({format:'der',type:'pkcs8'})};}
   const current=(await this.store.state()).current;if(roles.some(role=>current[role]?.id!==pair[role].public.id))throw new AppError('COLLABORATION_IDENTITY_CHANGED');
   const salt=randomBytes(32).toString('base64');key=await passwordKey(password,Buffer.from(salt,'base64'));
   plain=Buffer.from(JSON.stringify(Object.fromEntries(roles.map(role=>[role,pair[role].bytes.toString('base64')]))));
   return {file:{format,kdf,salt,content:seal(plain,key,aad(salt)).toString('base64')},identity:pairView(pair)};
  }finally{clear(pair);key?.fill(0);plain?.fill(0);}
 }
 async inspect(file,password){const pair=await open(file,password);try{return {identity:pairView(pair),state:await this.state()};}finally{clear(pair);}}
 async restore(file,password,expected,verified){
  const pair=await open(file,password);
  try{if(verified!==collaborationPairId(pair))throw new AppError('COLLABORATION_VERIFY');return await this.store.restore(pair,expected);}finally{clear(pair);}
 }
 activate(id,expected){return this.store.activate(id,expected);}
}
