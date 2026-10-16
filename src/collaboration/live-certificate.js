import 'reflect-metadata';
import {X509CertificateGenerator,SubjectAlternativeNameExtension,KeyUsagesExtension,KeyUsageFlags,ExtendedKeyUsageExtension} from '@peculiar/x509';
import {webcrypto,randomBytes,createPrivateKey,X509Certificate} from 'node:crypto';
import {AppError} from '../errors.js';

const file='.observanda/collaboration/live/tls.json';
export const peerName='observanda.local';
// A dedicated TLS key lives only in the encrypted workspace. The signed
// connection card pins this certificate; it never installs a system-wide CA.
export async function liveCertificate(workspace){
 return workspace.withLock(async()=>{
  const raw=await workspace.readMetadata(file,32768);
  if(raw){const saved=JSON.parse(raw),certificate=new X509Certificate(saved.cert),key=createPrivateKey(saved.key);if(!certificate.checkPrivateKey(key))throw new AppError('COLLABORATION_DAMAGED');if(Date.parse(certificate.validTo)>Date.now()+86400000)return saved;}
  const algorithm={name:'ECDSA',namedCurve:'P-256',hash:'SHA-256'},keys=await webcrypto.subtle.generateKey(algorithm,true,['sign','verify']);
  const cert=await X509CertificateGenerator.createSelfSigned({serialNumber:randomBytes(16).toString('hex'),name:'CN='+peerName,notBefore:new Date(Date.now()-300000),notAfter:new Date(Date.now()+365*86400000),signingAlgorithm:algorithm,keys,extensions:[new SubjectAlternativeNameExtension([{type:'dns',value:peerName}]),new KeyUsagesExtension(KeyUsageFlags.digitalSignature,true),new ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1'])]},webcrypto);
  const bytes=Buffer.from(await webcrypto.subtle.exportKey('pkcs8',keys.privateKey));
  try{const saved={cert:cert.toString('pem'),key:createPrivateKey({key:bytes,type:'pkcs8',format:'der'}).export({type:'pkcs8',format:'pem'})};await workspace.writeMetadata(file,JSON.stringify(saved));return saved;}finally{bytes.fill(0);}
 });
}
