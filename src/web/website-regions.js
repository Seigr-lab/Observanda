// Shared compositions and their assignments are authoring data. Publication
// resolves them per admitted page; unused definitions never enter the export.
export const REGION_KINDS=['sidebar','footer','header'];
// Slots describe placement; designs describe reusable content. A sidebar design
// can be assigned to either slot without cloning its content or presentation.
export const REGION_SLOTS=['header','sidebar','secondary-sidebar','footer'];
export const regionKind=slot=>slot==='secondary-sidebar'?'sidebar':slot;
const target=value=>typeof value==='string'&&/^(\*|home|(?:project|notebook|entry|page):[a-f0-9-]{36})$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,names,optional=[])=>object(value)&&Object.keys(value).every(key=>names.includes(key)||optional.includes(key))&&names.every(key=>Object.hasOwn(value,key));
export function validRegions(value,validSections){
  if(!keys(value,['definitions','assignments'])||!Array.isArray(value.definitions)||value.definitions.length>100||!Array.isArray(value.assignments)||value.assignments.length>5000)return false;
  const ids=new Set();
  for(const region of value.definitions){
    if(!keys(region,['id','name','kind','side','width','sticky','background','color','padding','sections'],['mobile','mobileTitle'])||typeof region.id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(region.id)||ids.has(region.id)||typeof region.name!=='string'||!region.name.trim()||region.name.length>160||/[\u0000-\u001f]/.test(region.name)||!REGION_KINDS.includes(region.kind)||!['left','right'].includes(region.side)||!Number.isInteger(region.width)||region.width<180||region.width>480||typeof region.sticky!=='boolean'||!Number.isInteger(region.padding)||region.padding<0||region.padding>80||![region.background,region.color].every(v=>v===null||typeof v==='string'&&/^#[a-f0-9]{6}$/i.test(v))||!validSections(region.sections))return false;
    if(region.mobile!==undefined&&!['expanded','collapsed'].includes(region.mobile))return false;
    if(region.mobileTitle!==undefined&&(typeof region.mobileTitle!=='string'||region.mobileTitle.length>160||/[\u0000-\u001f]/.test(region.mobileTitle)))return false;
    ids.add(region.id);
  }
  const assignments=new Set();
  return value.assignments.every(a=>{
    const key=a?.target+'/'+a?.kind;
    if(!keys(a,['target','kind','regionId'])||!target(a.target)||!REGION_SLOTS.includes(a.kind)||assignments.has(key)||!(a.regionId===null||value.definitions.some(r=>r.id===a.regionId&&r.kind===regionKind(a.kind))))return false;
    assignments.add(key);return true;
  });
}
