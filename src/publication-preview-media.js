import {AppError} from './errors.js';
import {MediaStore} from './media.js';
import {OwnedFileContent} from './owned-file-content.js';
import {FileContent} from './file-content.js';

// Preview descriptors contain no borrowed source key. Every later image/range
// request reauthorizes its source and owns that credential until streaming ends.
export function publicationPreviewMedia(workspace,origins,sourceReader){
 const local=new MediaStore(workspace);
 async function use(origin,options,consume){
  const reader=await sourceReader?.({signal:options?.signal});if(!reader)throw new AppError('ACCESS_LOCKED');
  try{
   const {value}=await reader.use(origin.workspaceId,origin.snapshotId,async(_store,_snapshot,pinned)=>consume(await new MediaStore(pinned.storage).get(origin.attachmentId,{streamed:true,signal:options?.signal}),pinned));
   await reader.verify();return value;
  }finally{await reader.close();}
 }
 return {async get(id,options={}){
  const origin=structuredClone(origins.get(id));if(!origin)return local.get(id,options);
  return use(origin,options,async file=>{
   if(!(file.bytes instanceof FileContent))throw new AppError('MEDIA_INVALID');
   const {size,sha256,header}=file.bytes,kind=file.kind,extension=file.extension,mime=file.mime;
   const content=new OwnedFileContent(workspace,'publication-preview/'+id,size,sha256,(consume,readOptions)=>use(origin,readOptions,async current=>{
    if(!(current.bytes instanceof FileContent)||current.bytes.size!==size||current.bytes.sha256!==sha256||current.kind!==kind||current.extension!==extension||current.mime!==mime)throw new AppError('MEDIA_INVALID');
    return consume(current.bytes);
   }));
   content.header=header?Buffer.from(header):undefined;
   return {...file,id,bytes:content};
  });
 }};
}
