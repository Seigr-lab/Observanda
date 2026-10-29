import {m,inventoryLocation,statusLabel} from './editor-presentation.js';
import {stockTracked,assetPlacement,inventoryLocations,inventoryOwner,inventoryQuantity,inventoryBOMUsage,inventoryScope} from './inventory-model.js';
import {balance,compare,negate,add} from './quantities.js';
import {projectUsesTool,projectToolScope} from '../project-tools.js';

export function inventoryPlaces(c,{existing=[]}={}){
 const book=c.services.state.book;
 return [[null,inventoryLocation(book,null)],...book.projects.filter(p=>projectUsesTool(book,p.id,'resources')||existing.includes(p.id)).map(p=>[p.id,inventoryLocation(book,p.id)])];
}
const placeSelect=(c,label,key,value,choices)=>c.field(c.esc(label),`<select data-operation-field="${key}" required>${choices.map(([id,label])=>c.option(id??'workspace',label,value??'workspace')).join('')}</select>`);
const destinationSelect=(c,label,key,value,choices)=>c.field(c.esc(label),`<select data-operation-field="${key}" required>${c.option('',m('chooseLocation'),value??'')}${choices.map(([id,label])=>c.option(id??'workspace',label,value??'')).join('')}</select>`);
const placeId=value=>value==='workspace'?null:value;
const stockTotals=rows=>rows.reduce((sum,row)=>({physical:add(sum.physical,row.physical),reserved:add(sum.reserved,row.reserved),available:add(sum.available,row.available)}),{physical:'0',reserved:'0',available:'0'});

export function inventoryScopeControl(c){
 const {book}=c.services.state,{esc}=c;
 return `<div class="operations-scope"><label>${esc(m('inventoryLocation'))}<select data-operation-scope><option value="">${esc(m('allInventory',{name:book.title}))}</option>${book.projects.filter(p=>projectToolScope(book,p.id,'resources')).map(p=>`<option value="${p.id}" ${p.id===c.scopeId?'selected':''}>${esc(inventoryLocation(book,p.id))}</option>`).join('')}</select></label><label class="checkbox"><input type="checkbox" data-operation-descendants ${c.recursive?'checked':''}>${esc(c.scopeId?m('includeLocations'):m('includeAllocations'))}</label></div>`;
}
export function inventoryBreakdown(resource,c){
 const {book}=c.services.state,{esc}=c,rows=(c.inventory?c.inventory.get(resource.id)?.locations??[]:inventoryLocations(c.all(),resource.id)).filter(row=>compare(row.physical,'0')!==0||compare(row.reserved,'0')!==0);
 return `<div class="inventory-allocation-table"><table><caption>${esc(m('stockHeld'))}</caption><thead><tr><th scope="col">${esc(m('location'))}</th><th scope="col">${esc(m('onHand'))}</th><th scope="col">${esc(m('reserved'))}</th><th scope="col">${esc(m('available'))}</th></tr></thead><tbody>${rows.map(row=>`<tr><th scope="row">${esc(inventoryLocation(book,row.projectId))}</th><td data-inventory-label="${esc(m('onHand'))}">${esc(row.physical)}</td><td data-inventory-label="${esc(m('reserved'))}">${esc(row.reserved)}</td><td data-inventory-label="${esc(m('available'))}">${esc(row.available)}</td></tr>`).join('')||'<tr><td colspan="4">'+esc(m('noStock'))+'</td></tr>'}</tbody></table></div>`;
}
export function inventoryCardFacts(resource,c){
 const {book}=c.services.state,{esc}=c,v=resource.data;
 if(!stockTracked(v))return `<p><strong>${esc(m('heldAt'))}</strong> ${esc(inventoryLocation(book,assetPlacement(resource)))}</p>`;
 if(c.inventory&&!c.inventory.get(resource.id))return c.inventory.message();
 const scope=inventoryScope(book,c.scopeId,c.recursive),rows=c.inventory?.get(resource.id)?.locations,total=c.inventory?stockTotals(rows):balance(c.all(),resource.id),shown=c.inventory?stockTotals(rows.filter(r=>!scope||scope.has(r.projectId))):inventoryQuantity(book,c.all(),resource.id,c.scopeId,c.recursive),specific=c.scopeId||!c.recursive;
 const use=c.inventory?c.inventory.get(resource.id).usage:inventoryBOMUsage(c.all(),resource.id,scope);
 return `<dl class="module-metrics inventory-metrics"><div><dt>${esc(specific?m('atLocation'):m('totalOnHand'))}</dt><dd>${esc(shown.physical+' '+v.unit)}</dd></div><div><dt>${esc(m('available'))}</dt><dd>${esc(shown.available+' '+v.unit)}</dd></div><div><dt>${esc(specific?m('acrossLocations'):m('reserved'))}</dt><dd>${esc((specific?total.physical:total.reserved)+' '+v.unit)}</dd></div></dl>${use.builds?'<p class="inventory-bom-use">'+esc(m('bomStockUse',{used:use.used+' '+v.unit,scrapped:use.scrapped+' '+v.unit,count:use.builds}))+'</p>':''}${!specific?inventoryBreakdown(resource,c):''}`;
}
export function inventoryStockSection(c){
 const d=c.current,resource=c.get(d.id),{esc,field,button}=c,{book}=c.services.state;
 if(!resource)return '<section class="module-block"><p>'+esc(m('saveTransfer'))+'</p></section>';
 const v=resource.data,tracked=stockTracked(v),op=c.operation,rows=c.inventory?c.inventory.get(d.id)?.locations??[]:inventoryLocations(c.all(),d.id);
 const places=inventoryPlaces(c,{existing:rows.map(r=>r.projectId).concat(assetPlacement(resource))});
 if(op){
  const moving=op.kind==='transfer',asset=op.kind==='assign',titles={receive:m('receiveStock'),consume:m('consumeStock'),adjust:m('reconcileStock'),reserve:m('reserveStock'),transfer:m('transferStock'),assign:m('moveItem')};
  const from=moving?placeId(op.values.fromProjectId):asset?assetPlacement(resource):placeId(op.values.projectId);
  const available=tracked?(c.inventory?rows.find(r=>r.projectId===from)?.available??'0':balance(c.all(),d.id,new Set([from])).available):null;
  return `<form data-module-form data-operation="${op.kind}" class="module-block inventory-transaction"><h2>${esc(titles[op.kind])}</h2><p><strong>${esc(v.name)}</strong> · ${esc(m('ownedBy',{owner:inventoryOwner(book,v.projectId)}))}</p>
   ${asset?`<p>${esc(m('currentlyAt',{location:inventoryLocation(book,from)}))}</p>`:placeSelect(c,moving?m('from'):m('stockLocation'),moving?'fromProjectId':'projectId',moving?op.values.fromProjectId:op.values.projectId,places)}
   ${moving||asset?destinationSelect(c,m('to'),'toProjectId',op.values.toProjectId,inventoryPlaces(c).filter(([id])=>id!==from)):''}
   ${tracked?`<p class="muted">${esc(m('stockAvailable',{quantity:available+' '+v.unit,location:inventoryLocation(book,from)}))}</p>${field(esc(op.kind==='adjust'?m('adjustment'):m('quantityUnit',{unit:v.unit})),`<input data-operation-field="quantity" inputmode="decimal" required value="${esc(op.values.quantity)}">`)}`:''}
   ${field(esc(m('reasonReference')),`<textarea data-operation-field="reason" required rows="2">${esc(op.values.reason)}</textarea>`)}
   ${moving?'<p class="muted">'+esc(m('transferHelp'))+'</p>':''}
   <div class="module-actions">${button(m('cancel'),'cancel-operation')}<button class="button primary" type="submit">${esc(moving?m('transferStock'):asset?m('moveItem'):op.kind==='reserve'?m('recordReservation'):m('recordMovement'))}</button></div></form>`;
 }
 const reservations=c.inventory?c.inventory.rows('reservations'):c.all('reservation').filter(e=>e.data.resourceId===d.id),events=c.inventory?c.inventory.rows('movements'):c.all().filter(e=>['movement','stock-transfer','asset-transfer'].includes(e.type)&&e.data.resourceId===d.id).toReversed();
 const operations=tracked?[['receive',m('receive')],['transfer',m('transferStock')],['consume',m('consume')],['reserve',m('reserve')],['adjust',m('reconcile')]]:[['assign',m('moveItem')]];
 return `<section class="module-block"><h2>${esc(tracked?m('stockAllocations'):m('placement'))}</h2><p>${esc(m('ownedBy',{owner:inventoryOwner(book,v.projectId)}))}</p>${inventoryCardFacts(resource,c)}${tracked&&(c.scopeId||!c.recursive)?inventoryBreakdown(resource,c):''}<div class="module-actions">${operations.map(([id,label])=>button(label,'stock-operation',`data-operation="${id}"`)).join('')}</div></section>
  ${tracked?`<section class="module-block"><h2>${esc(m('reservations'))}</h2>${reservations.map(r=>`<article class="module-ledger"><div><strong>${esc(r.data.quantity+' '+v.unit)}</strong><p>${esc(r.data.reason)}</p><small>${esc(inventoryLocation(book,Object.hasOwn(r.data,'projectId')?r.data.projectId:v.projectId))} · ${esc(statusLabel(r.data.status))}</small></div>${(c.inventory?c.inventory.managed(r.id):c.all('bom').some(b=>b.data.allocations.some(a=>a.reservationId===r.id)))?c.links(r.data.links.filter(l=>l.type==='bom')):r.data.status==='active'?`<div class="module-actions">${button(m('consumeReserved'),'resolve-stock',`data-id="${r.id}" data-decision="consume"`)}${button(m('release'),'resolve-stock',`data-id="${r.id}" data-decision="release"`)}</div>`:''}</article>`).join('')||'<p>'+esc(m('noReservations'))+'</p>'}${c.inventory?.navigation('reservations')??''}</section>`:''}
  <section class="module-block"><h2>${esc(tracked?m('stockLedger'):m('placementHistory'))}</h2>${events.map(e=>{
   const v=e.data,transfer=e.type!=='movement',title=transfer?(e.type==='stock-transfer'?m('quantityTransferred',{quantity:v.quantity+' '+v.unit}):m('itemMoved')):v.delta+' '+v.unit;
   const location=transfer?inventoryLocation(book,v.fromProjectId)+' → '+inventoryLocation(book,v.toProjectId):inventoryLocation(book,Object.hasOwn(v,'projectId')?v.projectId:resource.data.projectId);
   return `<article class="module-ledger"><div><strong>${esc(title)}</strong><p>${esc(location)}</p><p>${esc(v.reason)}</p>${c.links(v.links)}</div><time>${esc(new Date(e.createdAt).toLocaleString())}</time></article>`;
  }).join('')||'<p>'+esc(m('noMovements'))+'</p>'}${c.inventory?.navigation('movements')??''}</section>`;
}
export async function inventoryStockAction(name,node,c){
 const d=c.current,a=node.dataset;
 if(name==='stock-operation'){
  if(c.inventory&&(c.inventory.loading||c.inventory.error||!c.inventory.get(d.id)))return true;
  if(JSON.stringify(d.data)!==JSON.stringify(d.base))throw new Error(m('saveTransaction'));
  const r=c.get(d.id),from=c.scopeId??(stockTracked(r.data)?null:assetPlacement(r));
  c.openOperation(a.operation,{expectedRevision:r.revision,projectId:from??'workspace',fromProjectId:from??'workspace',toProjectId:'',quantity:'',reason:''});return true;
 }
 if(name==='resolve-stock'){
  const r=c.inventory?c.inventory.rows('reservations').find(r=>r.id===a.id):c.get(a.id);if(!r)return true;await c.command('stock.resolve',{id:r.id,expectedRevision:r.revision,decision:a.decision});
  const latest=c.get(d.id);d.expectedRevision=latest.revision;d.base=structuredClone(latest.data);c.draw();return true;
 }
 return false;
}
export async function inventoryStockSubmit(form,c){
 const r=c.get(c.current.id),op=c.operation,values=op.values,quantity=values.quantity.trim();
 const payload={resourceId:r.id,expectedRevision:values.expectedRevision,reason:values.reason.trim(),links:r.data.links};
 if(op.kind==='transfer'){Object.assign(payload,{fromProjectId:placeId(values.fromProjectId),toProjectId:placeId(values.toProjectId),quantity});await c.command('stock.transfer',payload);}
 else if(op.kind==='assign'){payload.toProjectId=placeId(values.toProjectId);await c.command('resource.assign',payload);}
 else{
  payload.projectId=placeId(values.projectId);
  if(op.kind==='reserve')payload.quantity=quantity;else payload.delta=op.kind==='consume'?negate(quantity):quantity;
  if(op.kind!=='adjust'&&quantity.startsWith('-'))throw new Error(m('positiveQuantity'));
  await c.command(op.kind==='reserve'?'stock.reserve':'stock.move',payload);
 }
 const latest=c.get(r.id);c.current.expectedRevision=latest.revision;c.current.base=structuredClone(latest.data);c.current.data=structuredClone(latest.data);
}
