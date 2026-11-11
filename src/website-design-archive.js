import {unzipSync} from 'fflate';
import {AppError} from './errors.js';

// A website design package is one ZIP file. Reading it is bounded before any
// member is inflated: the archive size, the number of members, each member's
// declared size and their total, and every member name, which must be one of
// the plain relative names a design package writes.
export const designPackageType='application/vnd.observanda.website-design';
export const designPackageExtension='.observanda-design';
export const designArchiveLimits=Object.freeze({archive:64*1024*1024,members:2048,member:24*1024*1024,total:192*1024*1024});
const memberName=/^(?:design\.json|stylesheet\.css|page-designs\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.css|files\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}(?:\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}){0,7})$/;
export const designMemberName=name=>typeof name==='string'&&name.length<=512&&memberName.test(name)&&!name.split('/').some(part=>part==='.'||part==='..'||/\.\.|\.$/.test(part));

export function readDesignArchive(bytes,limits=designArchiveLimits){
 if(!(bytes instanceof Uint8Array)||!bytes.length)throw new AppError('INVALID');
 if(bytes.length>limits.archive)throw new AppError('LIMIT');
 const seen=new Set();let count=0,total=0;
 let members;
 try{
  members=unzipSync(bytes,{filter(file){
   if(!designMemberName(file.name)||seen.has(file.name))throw new AppError('WEBSITE_DESIGN_PACKAGE');
   if(![0,8].includes(file.compression))throw new AppError('WEBSITE_DESIGN_PACKAGE');
   seen.add(file.name);count++;total+=file.originalSize;
   if(count>limits.members||!Number.isSafeInteger(file.originalSize)||file.originalSize<0||file.originalSize>limits.member||total>limits.total)throw new AppError('LIMIT');
   return true;
  }});
 }catch(error){
  if(error instanceof AppError)throw error;
  throw new AppError('WEBSITE_DESIGN_PACKAGE');
 }
 const files=new Map();
 for(const [name,value] of Object.entries(members))files.set(name,Buffer.from(value.buffer,value.byteOffset,value.byteLength));
 if(files.size!==seen.size||!files.has('design.json'))throw new AppError('WEBSITE_DESIGN_PACKAGE');
 return files;
}
