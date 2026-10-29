import {m} from '../modules/editor-presentation.js';
import {defaultCalculationPolicy,calculationWorkerTimeout} from './calculation-policy.js';
import {calculationPolicyControls,calculationPolicyInput,approximationTitle,calculationErrorText} from './calculation-policy-ui.js';
import {moduleEditor} from '../modules/workbench.js';
import {ux} from '../experience-ui.js';
import {t,language} from '../i18n/index.js';
import {toolSpecs} from './manifests.js';
import {reaction,formula} from './stoichiometry.js';
import {readDelimitedTable} from '../tabular-data.js';
import '../i18n/catalogues/figureDiagnostics.js';
const column=i=>String.fromCharCode(65+Math.floor(i/26)-1).replace('@','')+String.fromCharCode(65+i%26);
const component=(role='reactant')=>({role,formula:'',coefficient:'1',molarMass:'',amount:'',unit:'g',volume:''});
const initial={reaction:{components:[component(),component('product')]},sheet:{cells:Array.from({length:10},()=>Array(5).fill('')),original:null},chemical:{format:'smiles',source:'',original:null}};
function download(bytes,name,type='application/octet-stream'){const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function originalFile(file){if(!file||file.size===0||file.size>262144)throw Error(m('fileSizeLimit'));const bytes=new Uint8Array(await file.arrayBuffer()),sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');let raw='';for(const b of bytes)raw+=String.fromCharCode(b);return {name:file.name.split(/[\\/]/).at(-1),size:bytes.length,sha256,bytes:btoa(raw)};}
export async function createToolUI(services,id){
 const [,,,type]=toolSpecs.find(s=>s[0]===id),{esc}=services;
 const toolLabels=()=>({reaction:['stoichiometry','reactionType','reactions'],sheet:['spreadsheet','sheetType','spreadsheets'],chemical:['chemicalStructures','chemicalType','chemicalImports']})[type].map(key=>m(key));
 let context,worker=null,timer,debounce,sequence=0,last='',cached='',sheetPage=0,disposed=false;
 const area=(key,title,rows=5)=>context.field(esc(title),'<textarea rows="'+rows+'" data-module-field="'+key+'" spellcheck="false">'+esc(context.current.data[key])+'</textarea>');
 function stop(){clearTimeout(timer);clearTimeout(debounce);worker?.terminate();worker=null;sequence++;}
 function output(html){cached=html;const node=document.querySelector('[data-tool-output="'+id+'"]');if(node){node.innerHTML=html;for(const branch of node.querySelectorAll('[data-branch-color]'))branch.style.setProperty('--branch-color',branch.dataset.branchColor);}}
 function calculate(){
  if(disposed||!context?.current)return;const d=context.current.data,key=JSON.stringify([language(),d]);if(last===key){output(cached);return;}last=key;stop();
  if(type==='reaction'){for(const node of document.querySelectorAll('[data-component-mass]')){const source=d.components[Number(node.dataset.componentMass)];try{node.textContent=source.formula?m('standardMolarMass',{mass:Number(formula(source.formula).mass.toPrecision(7))}):'';}catch(e){node.textContent=e.message;}}try{const r=reaction(d.components),num=v=>v===null?'\u2014':Number(v.toPrecision(7)).toString();output('<p>'+esc(!r.balanced?m('balanceFirst'):!r.complete?m('amountsFirst'):m('balancedReaction'))+'</p><div class="tool-scroll"><table><thead><tr><th>'+esc(m('component'))+'</th><th>'+esc(m('molarMassHeading'))+'</th><th>'+esc(m('amountMoles'))+'</th><th>'+esc(m('concentration'))+'</th><th>'+esc(m('remainingMoles'))+'</th><th>'+esc(m('theoreticalYield'))+'</th><th>'+esc(m('yieldPercent'))+'</th></tr></thead><tbody>'+r.values.map(v=>'<tr><th>'+esc(v.limiting?m('limitingComponent',{formula:v.formula}):v.formula)+'</th>'+[v.mass,v.moles,v.concentration,v.remaining,v.theoretical,v.yield].map(n=>'<td>'+num(n)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');}catch(e){output('<p>'+esc(e.message)+'</p>');}return;}
  output('<p role="status">'+esc(m('calculating'))+'</p>');const token=sequence;
  worker=new Worker('/vendor/tools-worker.js',{type:'module'});
  const finish=()=>{clearTimeout(timer);worker?.terminate();worker=null;};
  timer=setTimeout(()=>{if(token!==sequence)return;finish();output('<p role="alert">'+esc(m('calculationTimeout'))+'</p>');},calculationWorkerTimeout(d));
  worker.onerror=()=>{if(token!==sequence)return;finish();output('<p role="alert">'+esc(m('engineLoadFailed'))+'</p>');};
  worker.onmessage=({data})=>{if(token!==sequence||!context?.current||key!==JSON.stringify([language(),context.current.data]))return;finish();if(data.error){output('<p role="alert">'+esc(calculationErrorText(data))+'</p>');return;}
   if(type==='sheet'){output('<p>'+esc(m('sheetResultsHelp'))+'</p>');for(const node of document.querySelectorAll('.dedicated-tool[data-tool-id="'+id+'"] [data-cell-result]')){const [r,c]=node.dataset.cellResult.split(':').map(Number),v=data.result[r]?.[c];node.textContent=d.cells[r]?.[c]?.startsWith('=')?((v?.error?calculationErrorText(v):null)??(v?.approximation?'\u2248 ':'')+(v?.value??'')):'';node.title=v?.approximation?approximationTitle(v.approximation):v?.exact?t('calculator','exactInfo'):'';node.classList.toggle('tool-cell-error',!!v?.error);}}
   if(type==='chemical')output(data.result.notes.map(n=>'<p>'+esc(n)+'</p>').join('')+data.result.structures.map(s=>'<article class="tool-structure"><h3>'+esc(s.name)+'</h3>'+(s.error?'<p role="alert">'+esc(s.error)+'</p>':'<img alt="'+esc(m('molecularStructure',{name:s.name}))+'" src="data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s.svg)+'"><p>'+esc(s.formula)+' / '+esc(s.molarMass)+' g/mol</p><code>'+esc(s.smiles)+'</code>')+'</article>').join(''));
  };
  worker.postMessage({kind:{sheet:'spreadsheet',chemical:'chemical'}[type],value:structuredClone(d)});
 }
 function original(d){return d.original?'<details><summary>'+esc(m('originalFile',{name:d.original.name}))+'</summary><p>'+esc(m('bytes',{size:d.original.size}))+'</p><code class="tool-hash">SHA-256 '+d.original.sha256+'</code>'+context.button(m('downloadOriginal'),'download-original')+'</details>':'';}

 function form(d,c){context=c;const v=d.data;let content='';
  if(type==='reaction')content='<p>'+esc(m('reactionHelp'))+'</p><div class="tool-reaction">'+v.components.map((r,i)=>'<fieldset><legend>'+esc(m('componentNumber',{number:i+1}))+'</legend>'+[['role',m('role'),[['reactant',m('reactant')],['product',m('product')]]],['formula',m('formula')],['coefficient',m('coefficient')],['amount',m('amount')],['unit',m('unit'),[['g','g'],['mg','mg'],['mol','mol'],['mmol','mmol'],['M','mol/L']]],['volume',m('solutionVolume')],['molarMass',m('molarMassOverride')]].map(([k,title,opts])=>c.field(esc(title),opts?'<select data-component="'+i+'" data-key="'+k+'">'+opts.map(([key,name])=>c.option(key,name,r[k])).join('')+'</select>':'<input data-component="'+i+'" data-key="'+k+'" value="'+esc(r[k])+'" '+(k==='formula'?'placeholder="'+esc(m('formulaExample'))+'"':'inputmode="decimal"')+'>')).join('')+'<output data-component-mass="'+i+'"></output>'+c.button(m('removeComponent'),'remove-component','data-index="'+i+'" '+(v.components.length<=2?'disabled':''))+'</fieldset>').join('')+'</div>'+c.button(m('addReactant'),'add-component','data-role="reactant"')+c.button(m('addProduct'),'add-component','data-role="product"')+'<p class="muted">'+esc(m('molarMassHelp'))+'</p>';
  if(type==='sheet')content=(v.engine!==3?'<p>'+esc(t('calculator',v.engine===1?'legacyEngine':'fixedPolicyEngine'))+' '+c.button(t('calculator','upgradeEngine'),'upgrade-engine')+'</p>':calculationPolicyControls(v,c,esc))+'<div class="module-inline">'+c.field(esc(m('importCsv')),'<input type="file" data-tool-file accept=".csv,.tsv,text/csv,text/tab-separated-values">')+c.button(m('addRow'),'add-row')+c.button(m('addColumn'),'add-column')+'</div><p>'+esc(m('sheetHelp'))+'</p>'+original(v)+'<div class="tool-scroll"><table class="tool-sheet"><thead><tr><th scope="col">'+esc(m('row'))+'</th>'+v.cells[0].map((_,i)=>'<th scope="col">'+column(i)+'</th>').join('')+'</tr></thead><tbody>'+v.cells.slice(sheetPage*25,sheetPage*25+25).map((row,index)=>{const r=index+sheetPage*25;return '<tr><th scope="row">'+(r+1)+'</th>'+row.map((value,col)=>'<td><input aria-label="'+esc(m('cell',{cell:column(col)+(r+1)}))+'" data-cell="'+r+':'+col+'" value="'+esc(value)+'" spellcheck="false"><output data-cell-result="'+r+':'+col+'"></output></td>').join('')+'</tr>';}).join('')+'</tbody></table></div>'+c.button(m('previousRows'),'sheet-back',sheetPage?'':'disabled')+'<span> '+esc(m('rowRange',{start:sheetPage*25+1,end:Math.min(v.cells.length,sheetPage*25+25),total:v.cells.length}))+' </span>'+c.button(m('nextRows'),'sheet-next',(sheetPage+1)*25<v.cells.length?'':'disabled')+c.button(m('downloadCsv'),'export-sheet')+'<p class="muted">'+esc(m('csvHelp'))+'</p>';
  if(type==='chemical')content=c.field(esc(m('importChemical')),'<input type="file" data-tool-file accept=".cdxml,.smi,.smiles,.txt">')+c.select('format',m('format'),[['smiles','SMILES'],['cdxml','ChemDraw CDXML']])+area('source',m('chemicalSource'),8)+original(v)+'<p>'+esc(m('chemicalHelp'))+'</p>';
  return '<div class="dedicated-tool" data-tool-id="'+id+'">'+c.input('name',m('name'))+(type==='sheet'?'<p>'+esc(ux('keyboardSheet'))+'</p>':'')+content+'<section class="tool-results" aria-label="'+esc(m('results'))+'" data-tool-output="'+id+'" aria-live="polite"></section>'+c.referenceFields(v.links)+'</div>';
 }
 async function importFile(el,c){const d=c.current,file=el.files?.[0];if(!file)return;try{const original=await originalFile(file),bytes=Uint8Array.from(atob(original.bytes),ch=>ch.charCodeAt(0)),source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(disposed||c.current!==d)return;
  if(type==='sheet'){const parsed=readDelimitedTable(source,{header:false,preserveEmptyRows:true,minColumns:1,translate:t}),cells=parsed.rows.map(row=>row.cells.map(s=>s.startsWith('=')||s.startsWith("'")?"'"+s:s));if(cells.length>1000||cells[0].length>32||cells.length*cells[0].length>20000||cells.some(row=>row.some(s=>s.length>2000)))throw Error(m('sheetSizeLimit'));d.data.cells=cells;sheetPage=0;}
  else{d.data.format=/\.cdxml$/i.test(file.name)?'cdxml':'smiles';d.data.source=source;}
  d.data.original=original;if(!d.data.name)d.data.name=file.name;c.change();last='';c.draw();
 }catch(e){services.notify(e.message);el.value='';}}
 const editor=await moduleEditor(services,{id,get label(){return toolLabels()[0]},paged:true,
  get types(){const [,singular,plural]=toolLabels();return [{id:type,label:plural,singular,empty:m('toolEmpty',{type:singular})}]},showTabs:()=>false,blank:()=>({name:'',links:[],engine:type==='sheet'?3:1,...(type==='sheet'?{policy:defaultCalculationPolicy()}:{}),...structuredClone(initial[type])}),card:(e,c)=>'<h2>'+c.esc(e.data.name)+'</h2>',form,
  input(el,c){context=c;if(calculationPolicyInput(el,c.current.data)){stop();last='';debounce=setTimeout(calculate,200);return true;}if(el.matches('[data-tool-file]')){void importFile(el,c);return true;}if(el.hasAttribute('data-component'))c.current.data.components[Number(el.dataset.component)][el.dataset.key]=el.value;
   if(el.dataset.cell){const [r,col]=el.dataset.cell.split(':').map(Number);c.current.data.cells[r][col]=el.value;}
   if(el.dataset.moduleField==='mode'){last='';c.draw();}else{clearTimeout(debounce);debounce=setTimeout(calculate,200);}return el.hasAttribute('data-component')||!!el.dataset.cell;
  },
  async action(name,node,c){context=c;const d=c.current.data;
   if(name==='upgrade-engine'&&type==='sheet'){d.engine=3;d.policy=defaultCalculationPolicy();}
   else if(name==='add-component'&&d.components.length<40)d.components.push(component(node.dataset.role));
   else if(name==='remove-component'&&d.components.length>2)d.components.splice(Number(node.dataset.index),1);
   else if(name==='add-row'){if(d.cells.length>=1000||(d.cells.length+1)*d.cells[0].length>20000)throw Error(m('sheetRowLimit'));d.cells.push(Array(d.cells[0].length).fill(''));sheetPage=Math.floor((d.cells.length-1)/25);}
   else if(name==='add-column'){if(d.cells[0].length>=32||d.cells.length*(d.cells[0].length+1)>20000)throw Error(m('sheetColumnLimit'));d.cells.forEach(row=>row.push(''));}
   else if(name==='sheet-back')sheetPage=Math.max(0,sheetPage-1);else if(name==='sheet-next')sheetPage++;
   else if(name==='download-original'){download(Uint8Array.from(atob(d.original.bytes),ch=>ch.charCodeAt(0)),d.original.name);return;}
   else if(name==='export-sheet'){const safe=s=>{s=s.startsWith("'")?s.slice(1):s;return '"'+(/^[=+@\-\t\r]/.test(s)?"'":'')+s.replace(/"/g,'""')+'"';};download(d.cells.map(row=>row.map(safe).join(',')).join('\r\n'),'spreadsheet.csv','text/csv;charset=utf-8');return;}
   else return;c.change();last='';c.draw();
  }
 });
 function bindGrid(){
  const grid=document.querySelector('.dedicated-tool[data-tool-id="'+id+'"] .tool-sheet');if(!grid)return;
  grid.onkeydown=event=>{
   const cell=event.target.closest('[data-cell]');if(!cell||event.isComposing||event.ctrlKey||event.metaKey)return;
   let [row,column]=cell.dataset.cell.split(':').map(Number);const cells=context?.current?.data.cells;if(!cells)return;
   if(event.key==='Enter')row+=event.shiftKey?-1:1;
   else if(event.altKey&&event.key==='ArrowUp')row--;
   else if(event.altKey&&event.key==='ArrowDown')row++;
   else if(event.altKey&&event.key==='ArrowLeft')column--;
   else if(event.altKey&&event.key==='ArrowRight')column++;
   else return;
   event.preventDefault();event.stopPropagation();
   if(row<0||row>=cells.length||column<0||column>=cells[row].length)return;
   const nextPage=Math.floor(row/25);if(nextPage!==sheetPage){sheetPage=nextPage;context.draw();}
   const next=document.querySelector('[data-cell="'+row+':'+column+'"]');next?.focus();next?.select();next?.scrollIntoView({block:'nearest',inline:'nearest'});
  };
 }
 return {...editor,bind(){editor.bind();if(type==='sheet'){last='';bindGrid();}calculate();},dispose(){disposed=true;stop();editor.dispose();}};
}
