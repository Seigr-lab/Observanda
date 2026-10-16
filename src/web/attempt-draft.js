// Native and shared authoring start with the same facts and row defaults.
export function attemptDraft(kind,attempt,relations,prior,{uuid=()=>crypto.randomUUID(),now=new Date()}={}){
 const base={id:uuid(),supersedes:prior?.id??null,recordedAt:now.toISOString(),reason:''};
 if(prior)return {...structuredClone(prior),...base};
 if(kind==='preparation')return {...base,applicability:'',basedOn:null,protocols:relations.filter(l=>l.role==='uses-method').map(l=>({...l.target,label:l.label})),conditions:[],inputs:[],observations:[],criteria:[]};
 const preparation=attempt.preparations.findLast(p=>kind==='event'||p.criteria.length),shared={...base,preparationId:preparation?.id??'',actor:'',source:'',time:{meaning:'unknown',value:''},references:[]};
 return kind==='event'?{...shared,kind:'prepared',label:'',extent:'unknown',context:'unspecified',circumstances:''}:{...shared,criterionId:preparation?.criteria[0]?.id??'',outcome:'not-assessed',domainOutcome:'',observed:'',denominator:''};
}
export function attemptDraftRow(group,uuid=()=>crypto.randomUUID()){
 const defaults={conditions:{name:'',value:'',unit:'',basis:'stated',reference:null,reason:''},inputs:{label:'',kind:'configuration',algorithm:'sha256',hash:'',reference:null},observations:{label:''},criteria:{label:'',expected:'',comparator:'',denominator:'',scope:'prospective',reason:''}};
 return {id:uuid(),...defaults[group]};
}
