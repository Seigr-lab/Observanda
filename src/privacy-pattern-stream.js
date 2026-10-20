import {privateTextPatterns} from './privacy-text.js';

// The privacy rules use only regular-language constructs. Compile those same
// expressions once, then retain automaton state instead of an unbounded match
// prefix (for example a long URL username or whitespace before a secret).
function expression(source,flags){
 // The bounded alphabet below distinguishes ASCII, Unicode whitespace and
 // other code units. New Unicode literals/flags need an explicit compiler
 // extension, never an approximate cached transition.
 if(!['','i'].includes(flags)||/[^\x00-\x7f]|\\(?:[uxpPk]|[1-9])/.test(source))throw Error('Unsupported privacy alphabet');
 let at=0;
 const sequence=()=>{const items=[];while(at<source.length&&![')', '|'].includes(source[at]))items.push(repeated());return {kind:'sequence',items};};
 const alternatives=()=>{const items=[sequence()];while(source[at]==='|'){at++;items.push(sequence());}return {kind:'alternatives',items};};
 const atom=()=>{
  const start=at;let value=source[at++];
  if(value==='('){if(source.slice(at,at+2)==='?:')at+=2;const value=alternatives();if(source[at++]!==')')throw Error('Invalid privacy expression');return value;}
  if(value==='^')return {kind:'assertion',test:(previous,current,first)=>first};
  if(value==='\\'){
   value=source[at++];if(value==='b')return {kind:'assertion',test:(previous,current)=>previous!==word(current)};
  }else if(value==='['){while(at<source.length){const next=source[at++];if(next==='\\'){at++;continue;}if(next===']')break;}}
  return {kind:'character',test:new RegExp('^(?:'+source.slice(start,at)+')$',flags)};
 };
 const repeated=()=>{
  const value=atom(),symbol=source[at];let min=1,max=1;
  if(symbol==='*'){min=0;max=Infinity;at++;}else if(symbol==='+'){max=Infinity;at++;}else if(symbol==='?'){min=0;at++;}
  else if(symbol==='{'){const match=/^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(at));if(!match)throw Error('Invalid privacy repetition');min=Number(match[1]);max=match[2]===undefined?min:match[2]===''?Infinity:Number(match[2]);at+=match[0].length;}
  return {kind:'repeat',value,min,max};
 };
 const value=alternatives();if(at!==source.length)throw Error('Unsupported privacy expression');return value;
}
const word=value=>value!==null&&/[a-z0-9_]/i.test(value);
function compile(){
 const nodes=[],node=()=>{const id=nodes.length;nodes.push({edges:[]});return id;},edge=(from,to,test=null)=>nodes[from].edges.push({to,test}),start=node(),end=node();
 function build(value,from,to){
  if(value.kind==='character'){nodes[from].character={to,test:value.test};return;}
  if(value.kind==='assertion'){edge(from,to,value.test);return;}
  if(value.kind==='alternatives'){for(const item of value.items){const next=node();edge(from,next);build(item,next,to);}return;}
  if(value.kind==='sequence'){if(!value.items.length){edge(from,to);return;}let current=from;for(let i=0;i<value.items.length;i++){const next=i===value.items.length-1?to:node();build(value.items[i],current,next);current=next;}return;}
  let current=from;
  for(let i=0;i<value.min;i++){const next=node();build(value.value,current,next);current=next;}
  if(value.max===Infinity){edge(current,to);const next=node();build(value.value,current,next);edge(next,current);return;}
  for(let i=value.min;i<value.max;i++){edge(current,to);const next=node();build(value.value,current,next);current=next;}
  edge(current,to);
 }
 for(const pattern of privateTextPatterns){const next=node();edge(start,next);build(expression(pattern.source,pattern.flags),next,end);}
 return {nodes,start,end};
}
const automaton=compile(),MAX_TRANSITIONS=8192,MAX_STATES=2048;
export class PrivacyPatternStream{
 constructor({stats}={}){this.stats=stats;this.states=new Map();this.transitions=new Map();this.nextId=0;this.current=this.state([],false,true);this.found=false;}
 state(nodes,previous,first=false){
  const key=nodes.join(',')+':'+Number(previous)+':'+Number(first);let value=this.states.get(key);if(value)return value;
  if(this.states.size===MAX_STATES){this.states.clear();this.transitions.clear();}
  value={id:this.nextId++,nodes,previous,first};this.states.set(key,value);return value;
 }
 closure(state,current){
  const seen=new Set(),pending=[...state.nodes,automaton.start];
  while(pending.length){const id=pending.pop();if(seen.has(id))continue;seen.add(id);for(const edge of automaton.nodes[id].edges)if(!edge.test||edge.test(state.previous,current,state.first))pending.push(edge.to);}
  return seen;
 }
 push(text){
  if(this.found)return true;
  for(let i=0;i<text.length;i++){
   const char=text[i],code=char.charCodeAt(0),key=this.current.id+':'+(code<128?code:/\s/.test(char)?128:129);let next=this.transitions.get(key);
   if(!next){
    const closure=this.closure(this.current,char),targets=new Set();let found=closure.has(automaton.end);
    for(const id of closure){const edge=automaton.nodes[id].character;if(edge?.test.test(char))targets.add(edge.to);}
    found ||=targets.has(automaton.end);next={found,state:this.state([...targets].sort((a,b)=>a-b),word(char))};
    if(this.transitions.size===MAX_TRANSITIONS)this.transitions.clear();this.transitions.set(key,next);
    if(this.stats)this.stats.maximumPatternTransitions=Math.max(this.stats.maximumPatternTransitions??0,this.transitions.size);
   }
   this.current=next.state;if(next.found){this.found=true;return true;}
  }
  return false;
 }
 finish(){return this.found||this.closure(this.current,null).has(automaton.end);}
}

function prefixTable(text){const table=new Uint32Array(text.length);for(let i=1,j=0;i<text.length;i++){while(j&&text[i]!==text[j])j=table[j-1];if(text[i]===text[j])j++;table[i]=j;}return table;}
const cased=/\p{Cased}/u,ignorable=/\p{Case_Ignorable}/u;
export class PrivacyBlockedStream{
 constructor(blocked){this.patterns=blocked.map(text=>({text,table:prefixTable(text)}));this.current={positions:new Uint32Array(blocked.length),found:blocked.includes('')};this.previousCased=false;this.pending=null;this.surrogate='';}
 branch(){return {positions:Uint32Array.from(this.current.positions),found:this.current.found};}
 feed(state,text){
  if(state.found)return;
  for(let p=0;p<this.patterns.length;p++){
   const pattern=this.patterns[p];let j=state.positions[p];
   for(let i=0;i<text.length;i++){while(j&&text[i]!==pattern.text[j])j=pattern.table[j-1];if(text[i]===pattern.text[j])j++;if(j===pattern.text.length){state.found=true;return;}}
   state.positions[p]=j;
  }
 }
 point(char){
  const ignored=ignorable.test(char),isCased=cased.test(char);
  if(this.pending&&!ignored){this.current=isCased?this.pending.normal:this.pending.final;this.pending=null;}
  if(char==='\u03a3'&&this.previousCased){this.pending={normal:this.branch(),final:this.branch()};this.feed(this.pending.normal,'\u03c3');this.feed(this.pending.final,'\u03c2');}
  else if(this.pending){const lower=char.toLowerCase();this.feed(this.pending.normal,lower);this.feed(this.pending.final,lower);}
  else this.feed(this.current,char.toLowerCase());
  if(!ignored)this.previousCased=isCased;
 }
 push(text){
  if(!this.patterns.length)return false;
  text=this.surrogate+text;this.surrogate='';if(/[\ud800-\udbff]/.test(text.at(-1)??'')){this.surrogate=text.at(-1);text=text.slice(0,-1);}
  for(const char of text)this.point(char);
  return this.pending?this.pending.normal.found&&this.pending.final.found:this.current.found;
 }
 finish(){if(this.surrogate)this.point(this.surrogate);if(this.pending)this.current=this.pending.final;return this.current.found;}
}
