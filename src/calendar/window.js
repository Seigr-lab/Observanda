// RFC dates stay date-only. Instants use the viewer's IANA timezone at window boundaries.
export function wallInstant(t,zone){
 const desired=Date.UTC(t.year,t.month-1,t.day,t.hour,t.minute,t.second);
 const fmt=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 let value=desired;
 for(let n=0;n<4;n++){const p=Object.fromEntries(fmt.formatToParts(new Date(value)).map(p=>[p.type,p.value])),actual=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second),next=value+desired-actual;if(next===value)break;value=next;}
 return new Date(value).toISOString();
}
export function zonedMidnight(value,timeZone){
 const [year,month,day]=value.split('-').map(Number);
 return Date.parse(wallInstant({year,month,day,hour:0,minute:0,second:0},timeZone));
}
export function calendarWindow(range){
 const from=zonedMidnight(range.from,range.timeZone??'UTC'),to=zonedMidnight(range.to,range.timeZone??'UTC');
 return e=>e.allDay?e.startsAt<range.to&&e.endsAt>range.from:Date.parse(e.startsAt)<to&&(Date.parse(e.endsAt)>from||e.startsAt===e.endsAt&&Date.parse(e.startsAt)>=from);
}
