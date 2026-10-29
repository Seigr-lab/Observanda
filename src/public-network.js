import {BlockList,isIP} from 'node:net';

// Public publication/calendar fetches must not address local services or
// special-purpose networks. Keep the policy independent of URL spelling.
// Sources: IANA IPv4 and IPv6 Special-Purpose Address Registries.
const blocked=new BlockList(),globalV6=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]])blocked.addSubnet(address,prefix,'ipv4');
globalV6.addSubnet('2000::',3,'ipv6');
for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked.addSubnet(address,prefix,'ipv6');
export function publicAddress(address){
 if(typeof address!=='string'||address.includes('%'))return false;
 const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&globalV6.check(address,'ipv6')&&!blocked.check(address,'ipv6');
}
export function publicHttpsUrl(value){
 const url=new URL(value),hostname=url.hostname.replace(/^\[|\]$/g,'');
 if(url.protocol!=='https:'||url.username||url.password||url.hash||isIP(hostname)&&!publicAddress(hostname))throw new TypeError('Public HTTPS destination required');
 return url;
}
