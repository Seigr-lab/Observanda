// CIAAW abridged standard atomic weights 2024, g/mol for normal materials.
// https://ciaaw.org/abridged-atomic-weights.htm. Not isotope-specific masses.
export const atomicWeights={H:1.0080,He:4.0026,Li:6.94,Be:9.0122,B:10.81,C:12.011,N:14.007,O:15.999,F:18.998,Ne:20.180,Na:22.990,Mg:24.305,Al:26.982,Si:28.085,P:30.974,S:32.06,Cl:35.45,Ar:39.95,K:39.098,Ca:40.078,Sc:44.956,Ti:47.867,V:50.942,Cr:51.996,Mn:54.938,Fe:55.845,Co:58.933,Ni:58.693,Cu:63.546,Zn:65.38,Ga:69.723,Ge:72.630,As:74.922,Se:78.971,Br:79.904,Kr:83.798,Rb:85.468,Sr:87.62,Y:88.906,Zr:91.222,Nb:92.906,Mo:95.95,Ru:101.07,Rh:102.91,Pd:106.42,Ag:107.87,Cd:112.41,In:114.82,Sn:118.71,Sb:121.76,Te:127.60,I:126.90,Xe:131.29,Cs:132.91,Ba:137.33,La:138.91,Ce:140.12,Pr:140.91,Nd:144.24,Sm:150.36,Eu:151.96,Gd:157.25,Tb:158.93,Dy:162.50,Ho:164.93,Er:167.26,Tm:168.93,Yb:173.05,Lu:174.97,Hf:178.49,Ta:180.95,W:183.84,Re:186.21,Os:190.23,Ir:192.22,Pt:195.08,Au:196.97,Hg:200.59,Tl:204.38,Pb:207.2,Bi:208.98,Th:232.04,Pa:231.04,U:238.03};
export function formula(source){
 if(typeof source!=='string'||!source||source.length>200)throw Error('Enter a molecular formula.');
 const parts=source.replace(/\s/g,'').split(/[.\u00b7]/),atoms={};let charge=0;
 const suffix=/\^(\d*)([+-])$/.exec(parts.at(-1));if(suffix){charge=Number(suffix[1]||1)*(suffix[2]==='+'?1:-1);parts[parts.length-1]=parts.at(-1).slice(0,-suffix[0].length);}
 for(let part of parts){
  let multiplier=1;const leading=/^([1-9]\d*)/.exec(part);if(leading){multiplier=Number(leading[0]);part=part.slice(leading[0].length);}let at=0;
  function number(){const m=/^[1-9]\d*/.exec(part.slice(at));if(!m)return 1;at+=m[0].length;const n=Number(m[0]);if(n>100000)throw Error('Formula count is too large.');return n;}
  function group(close='',depth=0){
   if(depth>12)throw Error('Formula nesting is too deep.');const values={};let count=0;
   while(at<part.length&&part[at]!==close){
    let item;if('(['.includes(part[at])){const c=part[at++]==='('?')':']';item=group(c,depth+1);if(part[at++]!==c)throw Error('Unclosed formula group.');}
    else{const m=/^[A-Z][a-z]?/.exec(part.slice(at));if(!m)throw Error('Check formula near '+part.slice(at));at+=m[0].length;item={[m[0]]:1};}
    const n=number();for(const [element,value] of Object.entries(item))values[element]=(values[element]??0)+value*n;count++;
   }
   if(!count)throw Error('Empty formula group.');return values;
  }
  const values=group();if(at!==part.length||!Number.isSafeInteger(multiplier)||multiplier>100000)throw Error('Invalid formula.');
  for(const [element,n] of Object.entries(values))atoms[element]=(atoms[element]??0)+n*multiplier;
 }
 let mass=0;for(const [element,n] of Object.entries(atoms)){if(!atomicWeights[element])throw Error('No standard atomic weight for '+element+'. This formula calculator supports elements with standard atomic weights.');if(!Number.isSafeInteger(n)||n>1e8)throw Error('Formula is too large.');mass+=n*atomicWeights[element];}
 return {atoms,charge,mass};
}
const positive=(value,label,zero=false)=>{if(typeof value!=='string'||!/^\d+(?:\.\d*)?(?:e[+-]?\d+)?$/i.test(value.trim()))throw Error('Enter '+label+' as a positive number.');const n=Number(value);if(!Number.isFinite(n)||(zero?n<0:n<=0))throw Error('Check '+label+'.');return n;};
export function reaction(rows){
 if(!Array.isArray(rows)||rows.length>40)throw Error('Use up to 40 reaction components.');
 const values=rows.map(r=>{const f=formula(r.formula),coefficient=positive(r.coefficient,'coefficient'),mass=r.molarMass?positive(r.molarMass,'molar mass'):f.mass;let moles=null,concentration=null;
  if(r.amount!==''){const amount=positive(r.amount,'amount',true);moles=r.unit==='g'?amount/mass:r.unit==='mg'?amount/1000/mass:r.unit==='mmol'?amount/1000:r.unit==='mol'?amount:r.unit==='M'?amount*positive(r.volume,'solution volume')/1000:null;if(moles===null)throw Error('Choose an amount unit.');}
  if(moles!==null&&!Number.isFinite(moles))throw Error('The amount is outside the supported numerical range.');
  if(r.volume&&moles!==null)concentration=moles/(positive(r.volume,'solution volume')/1000);
  if(concentration!==null&&!Number.isFinite(concentration))throw Error('Concentration is outside the supported numerical range.');
  return {...r,...f,mass,coefficient,moles,concentration};});
 const reactants=values.filter(r=>r.role==='reactant'),products=values.filter(r=>r.role==='product');if(!reactants.length||!products.length)throw Error('Add reactants and products.');
 const balance={};let charge=0;for(const r of values){const sign=r.role==='reactant'?-1:1;for(const [e,n] of Object.entries(r.atoms))balance[e]=(balance[e]??0)+sign*n*r.coefficient;charge+=sign*r.charge*r.coefficient;}
 const balanced=Object.values(balance).every(n=>Math.abs(n)<1e-9)&&Math.abs(charge)<1e-9;
 const complete=reactants.every(r=>r.moles!==null),extent=balanced&&complete?Math.min(...reactants.map(r=>r.moles/r.coefficient)):null;
 return {balanced,complete,values:values.map(r=>({...r,limiting:extent!==null&&r.role==='reactant'&&Math.abs(r.moles/r.coefficient-extent)<=Math.max(1e-15,extent*1e-10),theoretical:extent===null||r.role!=='product'?null:extent*r.coefficient*r.mass,yield:extent===null||extent===0||r.role!=='product'||r.moles===null?null:r.moles/(extent*r.coefficient)*100,remaining:extent===null||r.role!=='reactant'?null:Math.max(0,r.moles-extent*r.coefficient)}))};
}
