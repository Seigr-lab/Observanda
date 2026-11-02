import {safeEquationElement} from './website-equation-markup.js';
const protectedNodes='[data-observanda-source],[data-observanda-part],[data-observanda-link],[data-website-instance],nav,header,footer';
export const templates={
 fraction:['equationNumerator','equationDenominator'],power:['equationBase','equationExponent'],subscript:['equationBase','equationSubscript'],
 root:['equationRadicand'],matrix:[],text:['equationWords']
};
const textEscape=s=>s.replace(/[\\{}%&#_$^~]/g,c=>({'\\':'\\textbackslash{}','^':'\\textasciicircum{}','~':'\\textasciitilde{}'}[c]??'\\'+c));
export function templateSource(kind,values,columns){
 const [a,b]=values;
 if(kind==='fraction')return '\\frac{'+a+'}{'+b+'}';
 if(kind==='power'||kind==='subscript')return '{'+a+'}'+(kind==='power'?'^':'_')+'{'+b+'}';
 if(kind==='root')return '\\sqrt{'+a+'}';
 if(kind==='text')return '\\text{'+textEscape(a)+'}';
 if(kind!=='matrix'||!Number.isInteger(columns)||columns<1||columns>12||!values.length||values.length%columns)throw TypeError('Invalid template');
 const rows=[];for(let i=0;i<values.length;i+=columns)rows.push(values.slice(i,i+columns).join(' & '));
 return '\\begin{bmatrix}'+rows.join(' \\\\ ')+'\\end{bmatrix}';
}
export function renderedMath(doc,source,render){
 if(typeof source!=='string'||!source.trim()||source.length>4000||/\\(?:href|url|includegraphics|html\w*|class|style|cssId|def|gdef|edef|xdef|let|futurelet|newcommand|renewcommand|providecommand|require|input|include)\b/i.test(source))throw TypeError('Invalid expression');
 const template=doc.createElement('template');template.innerHTML=render(source);
 const math=template.content.querySelector('math');
 if(!math)throw TypeError('Invalid rendering');
 for(const node of [math,...math.querySelectorAll('*')]){
  if(!safeEquationElement(node.localName,node.namespaceURI,node.attributes))throw TypeError('Invalid rendering');
  if(node.localName==='annotation'&&(node.getAttribute('encoding')!=='application/x-tex'||node.children.length))throw TypeError('Invalid annotation');
 }
 if(math.querySelector('annotation[encoding="application/x-tex"]')?.textContent!==source)throw TypeError('Unbound expression');
 return doc.importNode(math,true);
}
// Native Core expressions from a saved HTML file can also be reopened when
// their original generator did not include a TeX annotation.
function nativeSource(node){
 const children=[...node.children],parts=()=>children.map(nativeSource);
 switch(node.localName){
  case 'math':case 'mrow':return parts().join('');
  case 'semantics':return nativeSource(children[0]);
  case 'mi':case 'mn':case 'mo':if(children.length)throw TypeError();return node.textContent;
  case 'mtext':return templateSource('text',[node.textContent]);
  case 'mfrac':case 'msup':case 'msub':if(children.length!==2)throw TypeError();return templateSource(({mfrac:'fraction',msup:'power',msub:'subscript'})[node.localName],parts());
  case 'msqrt':return templateSource('root',[parts().join('')]);
  case 'mroot':if(children.length!==2)throw TypeError();return '\\sqrt['+nativeSource(children[1])+']{'+nativeSource(children[0])+'}';
  case 'mtable':{
   const rows=children.map(row=>{if(row.localName!=='mtr'||[...row.children].some(c=>c.localName!=='mtd'))throw TypeError();return [...row.children].map(c=>[...c.children].map(nativeSource).join(''));});
   if(!rows[0]?.length||rows.some(r=>r.length!==rows[0].length))throw TypeError();
   return '\\begin{matrix}'+rows.map(r=>r.join(' & ')).join(' \\\\ ')+'\\end{matrix}';
  }
  default:throw TypeError('Unsupported native expression');
 }
}
export function equationTarget(doc,at){
 if(at?.closest(protectedNodes))throw TypeError('Protected selection');
 let math=at?.closest('math');
 if(!math&&at?.matches('figure,p,div')&&at.querySelector('math')){
  const all=at.querySelectorAll('math');if(all.length!==1)throw TypeError('Ambiguous equation');math=all[0];
 }
 if(!math)return {source:'',label:'',apply(next,label){
  const figure=doc.createElement('figure');figure.dataset.websiteEquation='';figure.append(next);
  if(label){const caption=doc.createElement('figcaption');caption.textContent=label;figure.append(caption);}
  let anchor=at;
  while(anchor&&!anchor.matches('body,main')&&!anchor.parentElement?.matches('body,main,section,article,aside,div,blockquote,li,td,th,dd,figure'))anchor=anchor.parentElement;
  if(anchor?.parentElement&&!anchor.matches('body,main')&&doc.body.contains(anchor))anchor.after(figure);
  else ([...doc.querySelectorAll('main:not([hidden])')].find(node=>!node.closest(protectedNodes))??doc.body).append(figure);
 }};
 if(math.closest(protectedNodes))throw TypeError('Protected equation');
 const figure=math.closest('figure[data-website-equation],figure.book-equation'),caption=figure?.querySelector(':scope > figcaption');
 const source=math.querySelector('semantics > annotation[encoding="application/x-tex"]')?.textContent??nativeSource(math);
 const label=caption?.textContent??math.getAttribute('aria-description')??math.getAttribute('aria-label')??'';
 return {source,label,apply(next,description){
  for(const attr of ['id','class','display','lang','dir','aria-labelledby','aria-describedby'])if(math.hasAttribute(attr))next.setAttribute(attr,math.getAttribute(attr));
  if(!math.hasAttribute('display'))next.removeAttribute('display');
  if(figure){
   if(description){const text=caption??doc.createElement('figcaption');text.textContent=description;if(!caption)figure.append(text);}else caption?.remove();
   if(figure.matches('.book-equation')){
    math.closest('[role="math"]')?.setAttribute('aria-label',description);
    const code=figure.querySelector('details pre > code');if(code)code.textContent=next.querySelector('annotation').textContent;
   }
  }else if(description)next.setAttribute('aria-description',description);
  math.replaceWith(next);
 }};
}
