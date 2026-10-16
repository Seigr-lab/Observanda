// Derive scalar membership from owned values. New members retain collection
// references; older members retain their exact historical summary spelling.
export async function recordDocumentSummary(document,header,encoding,{signal,collections}={}){
 const ids=async field=>{
  const result=[];for await(const ref of document.items([field],{signal}))result.push((await document.tree.selected(ref.value,['id'])).value);return result;
 };
 const cardItems={};if(!collections)for(const field of ['contributors','relations','figures','attachments'])cardItems[field]=await ids(field);
 const runOf=[];for await(const ref of document.items(['relations'],{signal})){
  if((await document.tree.selected(ref.value,['role'])).value==='run-of')runOf.push((await document.tree.selected(ref.value,['target'])).value);
 }
 return {id:header.id,revision:encoding.revision,type:header.type,notebookId:header.notebookId,share:header.share,occurredOn:header.occurredOn,updatedAt:header.updatedAt,
  ...(header.attempt?{hasAttempt:true}:{}),template:header.template?{id:header.template.id,label:header.template.label}:null,
  ...(collections?{collections}:{cardItems,sections:await ids('sections')}),runOf,bytes:encoding.memberBytes};
}
