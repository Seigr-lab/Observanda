// Retained previews select one file. Export and deployment enumerate the same
// immutable owner; neither opening an edition nor reading a page loads a site.
import {openPublicationOutput,verifyOutputManifest} from './publication-output.js';
import {verifyPublication,verifyPublicationManifest} from './publication.js';
import {admitRetainedPublicFile,assertPublicFiles} from './privacy.js';
import {AppError} from './errors.js';
export class RetainedPublicationFiles{
 constructor(workspace,stored,output,{blockedValues=[]}={}){this.workspace=workspace;this.stored=stored;this.output=output;this.blockedValues=blockedValues;this.size=output.count('files');}
 static async open(workspace,stored,options={}){return new RetainedPublicationFiles(workspace,stored,await openPublicationOutput(workspace,stored,options),options);}
 async has(name){return (await this.output.get('files',name))!==null;}
 async admit(file,content,{privacy=true}={}){
  if(!privacy){await content.verify();return content;}
  if(file.type==='media'){await content.verify();assertPublicFiles(new Map([[file.name,content]]),this.blockedValues);return content;}
  return admitRetainedPublicFile(file.name,content,{type:file.type,blockedValues:this.blockedValues});
 }
 async *contents(options){const {projectPublicationContents}=await import('./project-publication-content.js');yield* projectPublicationContents(this.workspace,this.stored,options);}
 async get(name){for await(const {file,content} of this.contents({name}))return this.admit(file,content);return undefined;}
 async *keys(){for await(const {key} of this.output.items('files'))yield key;}
 async *values(){for await(const [,content] of this)yield content;}
 async *[Symbol.asyncIterator](){for await(const {file,content} of this.contents())yield [file.name,await this.admit(file,content)];}
 async verify({signal,privacy=true,onFile}={}){
  await this.output.verify({signal});await verifyOutputManifest(this.output,this.stored,{signal});
  for await(const {file,content} of this.contents({signal})){signal?.throwIfAborted();await this.admit(file,content,{privacy});await onFile?.();}
 }
}
export async function verifyPublicationCandidate(candidate,{allowDesign=false,signal,privacy=true,onFile}={}){
 if(!(candidate.files instanceof RetainedPublicationFiles))return privacy?verifyPublication(candidate,{allowDesign}):verifyPublicationManifest(candidate);
 if(candidate.partial||candidate.designOnly)throw new AppError('INVALID');
 if(candidate.id!==candidate.files.stored.id||candidate.reviewId!==candidate.files.stored.reviewId)throw new AppError('STALE');
 await candidate.files.verify({signal,privacy,onFile});
}
