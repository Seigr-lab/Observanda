// Calendar axes for time-stamped measurements. Values are UTC milliseconds
// (see xValue in figure-model.js); labels are ISO-8601 spellings in UTC, so a
// tick never depends on the reader's time zone. Sub-second formats keep the
// millisecond resolution the stored timestamps carry.
export const FIGURE_DATE_FORMATS=['date','month','year','datetime','seconds','milliseconds'];
const day=86400000;
const minimumStep={year:day*365.25,month:day*30,date:day,datetime:60000,seconds:1000,milliseconds:1};
const steps=[1,2,5,10,20,50,100,200,500,1000,2000,5000,10000,15000,30000,60000,300000,900000,1800000,3600000,10800000,21600000,43200000,day,2*day,7*day,14*day,28*day];
export function figureDateTicks(domain,count,format){
 const span=domain.max-domain.min,interval=Math.max(minimumStep[format]??day,span/Math.max(2,count)),result=[];
 if(interval>=day*28){
  const months=interval<day*75?1:interval<day*150?3:interval<day*300?6:12*Math.max(1,Math.ceil(interval/(day*365.25)));
  const date=new Date(domain.min),month=date.getUTCFullYear()*12+date.getUTCMonth();
  let index=Math.ceil(month/months)*months;
  for(let i=0;i<40;i++,index+=months){
   const value=Date.UTC(Math.floor(index/12),index%12,1);
   if(value>domain.max)break;
   if(value>=domain.min)result.push(value);
  }
 }else{
  const step=steps.find(step=>step>=interval)??28*day;
  for(let value=Math.ceil(domain.min/step)*step;value<=domain.max&&result.length<40;value+=step)result.push(value);
 }
 return result.length?result:[(domain.min+domain.max)/2];
}
export function figureDateLabel(value,format){
 const iso=new Date(value).toISOString();
 if(format==='year')return iso.slice(0,4);
 if(format==='month')return iso.slice(0,7);
 if(format==='datetime')return iso.slice(0,16).replace('T',' ')+' UTC';
 if(format==='seconds')return iso.slice(0,19).replace('T',' ')+' UTC';
 if(format==='milliseconds')return iso.slice(0,23).replace('T',' ')+' UTC';
 return iso.slice(0,10);
}
