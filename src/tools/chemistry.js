import {Molecule} from 'openchemlib';
import {SaxesParser} from 'saxes';
function depiction(molecule){
 if(!molecule.getAllAtoms()||molecule.getAllAtoms()>1000)throw Error('Use structures with 1 to 1,000 atoms.');
 const mf=molecule.getMolecularFormula();return {formula:mf.formula,molarMass:mf.relativeWeight,smiles:molecule.toSmiles(),svg:molecule.toSVG(640,300)};
}
export function chemicalPreview(source,format){
 if(typeof source!=='string'||!source.trim()||source.length>262144)throw Error('Choose a chemical file of at most 256 KiB.');
 if(format==='smiles'){
  const lines=source.split(/\r?\n/).map(s=>s.trim()).filter(s=>s&&!s.startsWith('#'));if(lines.length>50)throw Error('Import up to 50 SMILES structures at a time.');
  return {structures:lines.map((line,i)=>{try{const [smiles,...name]=line.split(/\s+/);return {...depiction(Molecule.fromSmiles(smiles)),name:name.join(' ')||'Structure '+(i+1)};}catch(e){return {name:'Line '+(i+1),error:'Could not interpret this SMILES structure: '+e.message};}}),notes:[]};
 }
 if(format!=='cdxml')throw Error('Choose CDXML or SMILES.');
 const fragments=[],stack=[],notes=new Set(),parser=new SaxesParser();let root=false,count=0;
 parser.on('doctype',s=>{if(/[\[<>]/.test(s))throw Error('Internal XML entities are not supported.');});
 parser.on('opentag',tag=>{
  if(++count>20000)throw Error('The chemical drawing is too complex.');
  if(!root){if(tag.name!=='CDXML')throw Error('This is not a CDXML document.');root=true;}
  if(tag.name==='fragment'){const f={nodes:[],bonds:[],unsupported:[]};if(stack.length)stack.at(-1).unsupported.push('Nested fragment / abbreviation');stack.push(f);fragments.push(f);}
  else if(tag.name==='n'&&stack.length)stack.at(-1).nodes.push(tag.attributes);
  else if(tag.name==='b'&&stack.length)stack.at(-1).bonds.push(tag.attributes);
  else if(['arrow','graphic','t','scheme','step'].includes(tag.name))notes.add('Drawing annotations and reaction layout remain in the original CDXML file; previews show molecular fragments.');
 });
 parser.on('closetag',tag=>{if(tag.name==='fragment')stack.pop();});parser.write(source).close();
 if(!root||!fragments.length||fragments.length>50)throw Error('Use a CDXML drawing with 1 to 50 molecular fragments.');
 const structures=fragments.map((f,index)=>{const name='Fragment '+(index+1);try{
  if(f.unsupported.length)throw Error(f.unsupported.join(', '));
  const mol=new Molecule(0,0),atoms=new Map();
  for(const n of f.nodes){
   if(!n.id||atoms.has(n.id)||n.NodeType&&!['Element','Unspecified'].includes(n.NodeType)||n.Nickname||n.GenericNickname||n.AtomList||n.Radical||n.NumHydrogens)throw Error('A query, abbreviation or special atom needs the original drawing.');
   const atomicNo=Number(n.Element??6);if(!Number.isInteger(atomicNo)||atomicNo<1||atomicNo>118)throw Error('Invalid atomic number.');
   const id=mol.addAtom(atomicNo);atoms.set(n.id,id);
   if(n.p){const xy=n.p.trim().split(/\s+/).map(Number);if(xy.length!==2||xy.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6))throw Error('Invalid coordinates.');mol.setAtomX(id,xy[0]);mol.setAtomY(id,-xy[1]);}
   for(const [key,method,min,max] of [['Charge','setAtomCharge',-8,8],['Isotope','setAtomMass',1,300]])if(n[key]!==undefined){const v=Number(n[key]);if(!Number.isInteger(v)||v<min||v>max)throw Error('Invalid '+key);mol[method](id,v);}
  }
  for(const b of f.bonds){
   if(!atoms.has(b.B)||!atoms.has(b.E)||b.B===b.E)throw Error('Invalid bond endpoints.');
   const types={'1':Molecule.cBondTypeSingle,'2':Molecule.cBondTypeDouble,'3':Molecule.cBondTypeTriple,'1.5':Molecule.cBondTypeDelocalized};let type=types[b.Order??'1'];
   if(type===undefined)throw Error('Unsupported bond order.');
   if(b.Display&&b.Display!=='Solid'){
    if(!['WedgeBegin','WedgeEnd','WedgedHashBegin','WedgedHashEnd'].includes(b.Display)||type!==Molecule.cBondTypeSingle)throw Error('Unsupported bond display / stereochemistry.');
    type=b.Display.startsWith('WedgedHash')?Molecule.cBondTypeDown:Molecule.cBondTypeUp;
   }
   const reverse=b.Display?.endsWith('End'),bond=mol.addBond(atoms.get(reverse?b.E:b.B),atoms.get(reverse?b.B:b.E));mol.setBondType(bond,type);
  }
  return {name,...depiction(mol)};
 }catch(e){return {name,error:e.message+' Original retained without conversion.'};}});
 return {structures,notes:[...notes]};
}
