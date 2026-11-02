// These commands operate on the saved HTML. Never split links or duplicate
// identities while formatting part of an existing inline element.
const tags={
  bold:['strong','b'],italic:['em','i'],underline:['u'],strikeThrough:['s','strike','del'],
  superscript:['sup'],subscript:['sub'],highlight:['mark'],inlineCode:['code']
};
const tagMarks=new Map(Object.entries(tags).flatMap(([mark,names])=>names.map(tag=>[tag,mark])));
const formattingClass=/^(?:rt-(?:font|size|color|highlight)-|ow-visual-[a-f0-9-]{36}$)/;
const protectedNodes='[data-observanda-source],[data-observanda-part],[data-observanda-link],[data-website-instance]';
function marksOn(el){
  const tag=tagMarks.get(el.localName);
  if(tag)return tag;
  if(el.localName==='span'&&[...el.classList].some(name=>name.startsWith('rt-highlight-')))return 'highlight';
  return null;
}
function textRuns(range){
  if(range.collapsed)return [];
  const root=range.commonAncestorContainer, nodes=[];
  if(root.nodeType===3)nodes.push(root);
  else{
    const walker=root.ownerDocument.createTreeWalker(root,5,{acceptNode(node){
      if(!range.intersectsNode(node))return 2;
      return node.nodeType===3?1:3;
    }});
    for(let node=walker.nextNode();node;node=walker.nextNode())nodes.push(node);
  }
  return nodes.map(node=>({node,start:range.startContainer===node?range.startOffset:0,end:range.endContainer===node?range.endOffset:node.length})).filter(run=>run.end>run.start);
}
function ancestry(node,visit){
  for(let el=node.parentElement;el;el=el.parentElement){
    if(el.matches(protectedNodes)||el.localName==='body')break;
    visit(el);
  }
}
function statesFor(nodes){
  const states=new Map();
  for(const node of nodes){
    const own=new Set();
    if(node.nodeType===1)own.add(marksOn(node));
    ancestry(node,el=>own.add(marksOn(el)));
    for(const mark of own)if(mark)states.set(mark,(states.get(mark)??0)+1);
  }
  return new Map([...states].map(([mark,count])=>[mark,count===nodes.length?'true':'mixed']));
}
export function selectionMarkStates(range){
  if(!range)return new Map();
  return statesFor(range.collapsed?[range.startContainer]:textRuns(range).map(run=>run.node));
}
function controlledClasses(el){return [...el.classList].filter(name=>formattingClass.test(name));}
const directStyles=['font','font-family','font-size','font-style','font-weight','font-variant','line-height','color','background-color','letter-spacing','text-decoration','vertical-align'];

function removeFromSelected(wrapper,affected,clear){
  const doc=wrapper.ownerDocument,mark=marksOn(wrapper),format=doc.createElement(tagMarks.has(wrapper.localName)?wrapper.localName:'span');
  const classes=controlledClasses(wrapper).filter(name=>clear||mark==='highlight'&&name.startsWith('rt-highlight-'));
  if(classes.length){
    format.classList.add(...classes);wrapper.classList.remove(...classes);
    if(!wrapper.classList.length)wrapper.removeAttribute('class');
  }
  if(clear){
    for(const prop of directStyles){
      const value=wrapper.style.getPropertyValue(prop);if(!value)continue;
      format.style.setProperty(prop,value,wrapper.style.getPropertyPriority(prop));wrapper.style.removeProperty(prop);
    }
    if(!wrapper.style.length)wrapper.removeAttribute('style');
  }
  // Put the formatting back on only the unaffected siblings. Existing
  // children (including links and nested emphasis) keep their identities.
  function preserve(parent){
    let run=null;
    for(const child of [...parent.childNodes]){
      if(affected.has(child)){
        run=null;if(child.nodeType===1)preserve(child);
      }else{
        if(!run){run=format.cloneNode(false);child.before(run);}
        run.append(child);
      }
    }
  }
  preserve(wrapper);
  if(!wrapper.attributes.length)wrapper.replaceWith(...wrapper.childNodes);
  else if(wrapper.localName!=='span'){
    const neutral=doc.createElement('span');for(const attr of wrapper.attributes)neutral.setAttribute(attr.name,attr.value);
    neutral.append(...wrapper.childNodes);wrapper.replaceWith(neutral);
  }
}

export function setSelectionMark(range,command){
  const runs=textRuns(range);if(!runs.length)return false;
  const clear=command==='clearFormatting',toggleOff=!clear&&statesFor(runs.map(run=>run.node)).get(command)==='true';
  if(!clear&&!tags[command])return false;
  const doc=runs[0].node.ownerDocument,affected=new Set(),wrappers=new Set(),selected=[];
  const opposite=command==='superscript'?'subscript':command==='subscript'?'superscript':null;
  for(const {node,start,end} of runs){
    if(end<node.length)node.splitText(end);
    const text=start?node.splitText(start):node;
    selected.push(text);affected.add(text);
    ancestry(text,el=>{
      affected.add(el);
      const mark=marksOn(el);
      if(clear?(mark||el.localName==='span'&&(controlledClasses(el).length||directStyles.some(prop=>el.style.getPropertyValue(prop)))):mark&&(toggleOff?mark===command:mark===opposite))wrappers.add(el);
    });
  }
  // Document order puts each wrapper before all of its descendants, including
  // when the selection also spans independent formatting on another branch.
  const following=doc.defaultView.Node.DOCUMENT_POSITION_FOLLOWING;
  const outerFirst=[...wrappers].sort((a,b)=>a.compareDocumentPosition(b)&following?-1:1);
  for(const wrapper of outerFirst)removeFromSelected(wrapper,affected,clear);
  if(!clear&&!toggleOff)for(const node of selected){
    let present=false;ancestry(node,el=>{if(marksOn(el)===command)present=true;});
    if(present)continue;
    const tag=doc.createElement(tags[command][0]);node.before(tag);tag.append(node);
  }
  range.setStart(selected[0],0);range.setEnd(selected.at(-1),selected.at(-1).length);
  const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
  return true;
}
