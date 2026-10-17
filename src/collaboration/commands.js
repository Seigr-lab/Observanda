import {ResearchExchange} from './research-exchange.js';
import {ChangeReview} from './change-review.js';
import {ExchangeParts} from './exchange-parts.js';
import {packageSelection} from './research-package.js';
import {AppError} from '../errors.js';
import {matchesWorkingCopy,receiptPath} from './working-copy.js';

export async function sharingCommand(workspace,device,operation,data){
 if(data.workspaceId!==(await workspace.outline()).metadata.id)throw new AppError('WORKSPACE_CHANGED');
 const exchange=new ResearchExchange(workspace,device),identity=await exchange.identity.signer.public();
 if(operation==='state'){
  const working=await exchange.working();let access={revision:0,grants:[],projects:[],notebooks:[]};
  const authority=await exchange.access.organizations.load();if(authority.devices.some(d=>d.active&&d.identity.id===identity.id))access=await exchange.access.directory(identity);
  const packages=[];
  for await(const id of workspace.metadataNames('.observanda/collaboration/staging')){
   if(!/^[a-f0-9-]{36}$/.test(id))continue;const parts=new ExchangeParts(workspace,id);
   if(await workspace.readMetadata(parts.prefix+'/head.json',8192)===null)continue;
   const head=await parts.open();if(!['incoming','outgoing'].includes(head.direction))continue;
   const selection=await packageSelection(parts),receiptRaw=await workspace.readMetadata(receiptPath(selection.id),16*1024*1024),receipt=receiptRaw?JSON.parse(receiptRaw):null,update=matchesWorkingCopy(working,selection);
   packages.push({...exchange.summary(parts,selection),direction:head.direction,update,obsolete:update&&selection.edition<=working.selection.edition,receipt:receipt?{acceptedAt:receipt.acceptedAt,accepted:receipt.accepted.length,kept:receipt.kept.length}:null});
  }
  packages.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  return {...access,packages,working:working?{role:working.selection.grant.role,receivedAt:working.receivedAt,notebooks:working.selection.metadata.notebooks.map(({id,title})=>({id,title}))}:null};
 }
 if(operation==='contact')return {contact:await exchange.contact()};
 if(operation==='grant')return exchange.access.saveLocal(identity,data.command);
 if(operation==='recipients')return {recipients:await exchange.access.recipients(identity,data.grantId)};
 if(operation==='offer')return exchange.prepareOffer({grantId:data.grantId,contact:data.contact});
 if(operation==='changes')return exchange.prepareChanges();
 if(operation==='copy')return {path:await exchange.acceptCopy(data.id,data.destination)};
 const review=new ChangeReview(exchange);
 if(operation==='review')return review.review(data.id);
 if(operation==='configuration')return review.configuration(data);
 if(operation==='record')return {record:await review.record(data.reviewId,data.recordId,data.version),materials:await review.materials(data.reviewId,data.recordId,data.version),fonts:await review.fonts(data.reviewId,data.recordId,data.version)};
 if(operation==='apply')return review.apply({reviewId:data.reviewId,choices:data.choices});
 throw new AppError('INVALID');
}
