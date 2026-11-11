// Numeric geometry is independent of presentation and never changes saved data.
const padding=value=>value===0?1:Math.max(Number.MIN_VALUE,Math.abs(value)*.1);
const positive=value=>Math.max(Number.MIN_VALUE,value);

export function figureDomain(values,axis,zero=false){
 const log=axis.scale==='log',includeZero=zero&&!log;
 const usable=values.filter(n=>Number.isFinite(n)&&(!log||n>0));
 let min=usable.length?usable.reduce((a,b)=>Math.min(a,b),Infinity):log?1:0;
 let max=usable.length?usable.reduce((a,b)=>Math.max(a,b),-Infinity):log?10:1;
 if(includeZero){min=Math.min(0,min);max=Math.max(0,max);}
 if(min===max){
  if(log){min=positive(min/10);max*=10;}
  else{const pad=padding(min);min-=pad;max+=pad;}
 }
 const pad=(max-min)*.05;
 if(log){min=positive(min/1.08);max*=1.08;}
 else{if(!includeZero||min!==0)min-=pad;if(!includeZero||max!==0)max+=pad;}
 if(axis.min!==null)min=axis.min;if(axis.max!==null)max=axis.max;
 if(min>=max){
  if(axis.max===null)max=log?min*10:min+padding(min);
  else if(axis.min===null)min=log?positive(max/10):max-padding(max);
 }
 return {min,max};
}

export function figureFraction(value,{min,max},log=false){
 if(!log)return (value-min)/(max-min);
 // Subtract before taking logarithms for narrow ranges. Subtracting two
 // nearly equal logarithms can otherwise erase distinct measured values.
 const span=(max-min)/min,offset=(value-min)/min;
 if(Number.isFinite(span)&&Number.isFinite(offset)&&offset>-.5)
  return Math.log1p(offset)/Math.log1p(span);
 return (Math.log(value)-Math.log(min))/(Math.log(max)-Math.log(min));
}

export function figureTicks({min,max},log,count=5){
 if(log){
  const values=[];
  for(let n=Math.ceil(Math.log10(min));n<=Math.floor(Math.log10(max));n++){
   const value=10**n;if(value>=min&&value<=max&&value!==values.at(-1))values.push(value);
  }
  if(values.length>2)return values.filter((_,i)=>i%Math.max(1,Math.ceil(values.length/count))===0);
  // Spans of about a decade or less: label 1, 2 and 5 multiples, then plain
  // steps inside the span, before falling back to the two bounds.
  const mantissas=[1,2,5],within=[];
  for(let n=Math.floor(Math.log10(min));n<=Math.ceil(Math.log10(max));n++)for(const m of mantissas){const value=Number((m+'e'+n));if(value>=min&&value<=max)within.push(value);}
  if(within.length>=2&&within.length<=Math.max(3,count+1))return within;
  if(within.length>count+1)return values.length>1?values:within.filter((_,i)=>i%Math.ceil(within.length/count)===0);
  const linear=figureTicks({min,max},false,count).filter(value=>value>0);
  return linear.length>1?linear:[min,max];
 }
 const rough=(max-min)/Math.max(2,count),power=10**Math.floor(Math.log10(rough)),scaled=rough/power;
 const step=(scaled<=1?1:scaled<=2?2:scaled<=5?5:10)*power;
 const values=[],first=Math.ceil(min/step),places=Math.max(0,-Math.floor(Math.log10(step))+1);
 for(let i=0;i<40;i++){
  // Multiply, then drop binary noise below the step (17×0.2 is 3.4, not 3.4000000000000004).
  const raw=(first+i)*step,n=places<=100?Number(raw.toFixed(places)):raw;if(n>max)break;
  if(n>=min&&n!==values.at(-1))values.push(n);
 }
 return values.length>1?values:[min,max];
}
