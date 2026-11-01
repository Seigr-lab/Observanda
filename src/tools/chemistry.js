import {Molecule} from 'openchemlib';
import {SaxesParser} from 'saxes';
import {modelMessages} from '../web/model-messages.js';
import messages from '../web/locales/en/chemistryDiagnostics.json' with {type:'json'};
function depiction(molecule,fail){
 if(!molecule.getAllAtoms()||molecule.getAllAtoms()>1000)throw fail('structureAtoms');
 const mf=molecule.getMolecularFormula();return {formula:mf.formula,molarMass:mf.relativeWeight,smiles:molecule.toSmiles(),svg:molecule.toSVG(640,300)};
}
export function chemicalPreview(source,format,{translate}={}){
 const text=modelMessages('chemistryDiagnostics',messages,translate),ownErrors=new WeakSet();
 const fail=(key,values)=>{const error=Error(text(key,values));ownErrors.add(error);return error;};
 // Library diagnostics are not locale messages. Explicit display requests use
 // a translated explanation; the pure default retains the original diagnostic.
 const detail=error=>!translate||ownErrors.has(error)?error.message:text('structureInterpretation');
 if(typeof source!=='string'||!source.trim()||source.length>262144)throw fail('chemicalFile');
 if(format==='smiles'){
  const lines=source.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));if(lines.length>50)throw fail('smilesLimit');
  return {structures:lines.map((line,i)=>{try{const [smiles,...name]=line.split(/\s+/);return {...depiction(Molecule.fromSmiles(smiles),fail),name:name.join(' ')||text('structureName',{number:i+1})};}catch(e){return {name:text('lineName',{number:i+1}),error:text('smilesInvalid',{message:detail(e)})};}}),notes:[]};
 }
 if(format!=='cdxml')throw fail('chemicalFormat');
 const fragments=[],stack=[],notes=new Set(),parser=new SaxesParser();let root=false,count=0;
 parser.on('doctype',s=>{if(/[\[<>]/.test(s))throw fail('xmlEntities');});
 parser.on('opentag',tag=>{
  if(++count>20000)throw fail('drawingComplexity');
  if(!root){if(tag.name!=='CDXML')throw fail('cdxmlInvalid');root=true;}
  if(tag.name==='fragment'){const f={nodes:[],bonds:[],unsupported:[]};if(stack.length)stack.at(-1).unsupported.push(text('nestedFragment'));stack.push(f);fragments.push(f);}
  else if(tag.name==='n'&&stack.length)stack.at(-1).nodes.push(tag.attributes);
  else if(tag.name==='b'&&stack.length)stack.at(-1).bonds.push(tag.attributes);
  else if(['arrow','graphic','t','scheme','step'].includes(tag.name))notes.add(text('drawingAnnotations'));
 });
 parser.on('closetag',tag=>{if(tag.name==='fragment')stack.pop();});
 try{parser.write(source).close();}catch(error){if(!translate||ownErrors.has(error))throw error;throw new Error(text('cdxmlSyntax'),{cause:error});}
 if(!root||!fragments.length||fragments.length>50)throw fail('fragmentLimit');
 const structures=fragments.map((f,index)=>{const name=text('fragmentName',{number:index+1});try{
  if(f.unsupported.length){const error=Error(f.unsupported.join(', '));ownErrors.add(error);throw error;}
  const mol=new Molecule(0,0),atoms=new Map();
  for(const n of f.nodes){
   if(!n.id||atoms.has(n.id)||n.NodeType&&!['Element','Unspecified'].includes(n.NodeType)||n.Nickname||n.GenericNickname||n.AtomList||n.Radical||n.NumHydrogens)throw fail('specialAtom');
   const atomicNo=Number(n.Element??6);if(!Number.isInteger(atomicNo)||atomicNo<1||atomicNo>118)throw fail('atomicNumber');
   const id=mol.addAtom(atomicNo);atoms.set(n.id,id);
   if(n.p){const xy=n.p.trim().split(/\s+/).map(Number);if(xy.length!==2||xy.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6))throw fail('coordinates');mol.setAtomX(id,xy[0]);mol.setAtomY(id,-xy[1]);}
   for(const [key,method,min,max] of [['Charge','setAtomCharge',-8,8],['Isotope','setAtomMass',1,300]])if(n[key]!==undefined){const v=Number(n[key]);if(!Number.isInteger(v)||v<min||v>max)throw fail(key==='Charge'?'invalidCharge':'invalidIsotope');mol[method](id,v);}
  }
  for(const b of f.bonds){
   if(!atoms.has(b.B)||!atoms.has(b.E)||b.B===b.E)throw fail('bondEndpoints');
   const types={'1':Molecule.cBondTypeSingle,'2':Molecule.cBondTypeDouble,'3':Molecule.cBondTypeTriple,'1.5':Molecule.cBondTypeDelocalized};let type=types[b.Order??'1'];
   if(type===undefined)throw fail('bondOrder');
   if(b.Display&&b.Display!=='Solid'){
    if(!['WedgeBegin','WedgeEnd','WedgedHashBegin','WedgedHashEnd'].includes(b.Display)||type!==Molecule.cBondTypeSingle)throw fail('bondDisplay');
    type=b.Display.startsWith('WedgedHash')?Molecule.cBondTypeDown:Molecule.cBondTypeUp;
   }
   const reverse=b.Display?.endsWith('End'),bond=mol.addBond(atoms.get(reverse?b.E:b.B),atoms.get(reverse?b.B:b.E));mol.setBondType(bond,type);
  }
  return {name,...depiction(mol,fail)};
 }catch(e){return {name,error:text('originalRetained',{message:detail(e)})};}});
 return {structures,notes:[...notes]};
}
