// Facts used to filter inventory choices without opening their schemas or
// authored ledger reasons. Originals remain the authority during verification.
export function inventoryFacts(entity){
 const d=entity.data;
 if(entity.type==='category')return {id:entity.id,type:entity.type,data:{archived:d.archived}};
 if(entity.type==='asset-transfer')return {id:entity.id,type:entity.type,data:{fromProjectId:d.fromProjectId,toProjectId:d.toProjectId}};
 return null;
}
