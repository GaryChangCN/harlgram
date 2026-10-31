import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { relayConfiguration, relayTargetAllowed, RelaySocksHandshake, relayProbePacket, relayProbeResponse } = require('../artifacts/tests/js/model/RelayModels.js');
const { TelegramClient } = require('../artifacts/tests/js/telegram/TelegramClient.js');
const { ChatRepository } = require('../artifacts/tests/js/data/ChatRepository.js');
const token='synthetic-token-for-tests-only-12345678';
test('relay domain input cannot introduce paths, credentials, plaintext transport or header injection', () => {
  assert.equal(relayConfiguration({enabled:true,endpoint:'WSS://Relay.Example.com:443/',token}).endpoint,'https://relay.example.com');
  for (const endpoint of ['http://relay.example.com','relay.example.com/secret','user@relay.example.com','relay.example.com?token=x','127.0.0.1','relay.example.com:444','-bad.example.com']) {
    assert.throws(()=>relayConfiguration({enabled:true,endpoint,token}));
  }
  assert.throws(()=>relayConfiguration({enabled:true,endpoint:'relay.example.com',token:token+'\r\nHeader: x'}));
});
const buffer = values => Uint8Array.from(values).buffer;
const authentication = (user, pass) => buffer([1,user.length,...Buffer.from(user),pass.length,...Buffer.from(pass)]);
const target = buffer([5,1,0,1,149,154,167,51,1,187]);
test('SOCKS handshake supports every-byte fragmentation, mandatory credentials and pending MTProto bytes', () => {
  const socks=new RelaySocksHandshake('user','pass');
  const combined=Buffer.concat([Buffer.from([5,1,2]),Buffer.from(authentication('user','pass')),Buffer.from(target)]);
  let result;
  for (const byte of combined) { result=socks.feed(buffer([byte])); assert.equal(result.failed,false); }
  assert.deepEqual(result.target,{host:'149.154.167.51',port:443});
  const coalesced=new RelaySocksHandshake('user','pass');
  const all=Buffer.concat([combined,Buffer.from([239,10,0,0])]);
  const done=coalesced.feed(all.buffer.slice(all.byteOffset,all.byteOffset+all.length));
  assert.deepEqual([...new Uint8Array(done.pending)],[239,10,0,0]);
  assert.deepEqual(done.replies.map(b=>[...new Uint8Array(b)]),[[5,2],[1,0]]);
});
test('SOCKS rejects unauthenticated callers, incorrect secrets, private targets, domains and oversized negotiation', () => {
  assert.equal(new RelaySocksHandshake('user','pass').feed(buffer([5,1,0])).failed,true);
  const wrong=new RelaySocksHandshake('user','pass');wrong.feed(buffer([5,1,2]));assert.equal(wrong.feed(authentication('user','wrong')).failed,true);
  for (const request of [[5,1,0,1,127,0,0,1,1,187],[5,1,0,3,1,97,1,187],[5,1,0,4,0]]) {
    const socks=new RelaySocksHandshake('u','p');socks.feed(buffer([5,1,2]));socks.feed(authentication('u','p'));
    assert.equal(socks.feed(buffer(request)).failed,true);
  }
  assert.equal(new RelaySocksHandshake('u','p').feed(new ArrayBuffer(8193)).failed,true);
  assert.equal(relayTargetAllowed('149.154.167.51',22),false);
  assert.equal(relayTargetAllowed('149.154.176.0',443),false);
});
test('protocol probe requires a real matching resPQ nonce, not an echo or truncated packet', () => {
  const nonce=Uint8Array.from({length:16},(_,i)=>i);
  assert.equal(new Uint8Array(relayProbePacket(nonce,1700000000000)).length,42);
  const response=new Uint8Array(41);response[0]=10;new DataView(response.buffer).setUint32(21,0x05162463,true);response.set(nonce,25);
  assert.equal(relayProbeResponse(response.slice(0,15),nonce),'pending');
  assert.equal(relayProbeResponse(response,nonce),'valid');response[25]^=1;
  assert.equal(relayProbeResponse(response,nonce),'invalid');
});
function fixture(relay=true) {
  const requests=[], queue=[];
  const transport={createClient:()=>7,send:(_,raw)=>requests.push(JSON.parse(raw)),receive:()=>queue.shift()||''};
  const client=new TelegramClient(transport,new ChatRepository());
  client.start({apiId:1234,apiHash:'0'.repeat(32),databaseDirectory:'/test',filesDirectory:'/test/files',encryptionKey:'synthetic',
    relayProxy:relay?{server:'127.0.0.1',port:12345,username:'synthetic',password:'synthetic'}:undefined});
  const push=event=>{queue.push(JSON.stringify({'@client_id':7,...event}));client.drain();};
  return {client,requests,push};
}
test('TDLib network stays blocked until proxy acknowledgement, including cached authorization', () => {
  const {client,requests,push}=fixture();
  assert.equal(requests[0]['@type'],'setNetworkType');assert.equal(requests[0].type['@type'],'networkTypeNone');
  const proxy=requests.find(r=>r['@type']==='addProxy');assert.equal(proxy.proxy.type['@type'],'proxyTypeSocks5');
  push({'@type':'updateAuthorizationState',authorization_state:{'@type':'authorizationStateReady'}});
  assert.equal(client.state().ready,false);
  assert.equal(requests.some(r=>r.type?.['@type']==='networkTypeOther'),false);
  push({'@type':'addedProxy','@extra':proxy['@extra'],id:1});assert.equal(client.state().ready,true);
  assert.equal(requests.some(r=>r.type?.['@type']==='networkTypeOther'),true);
});
test('proxy error never enables direct network and rejects late Ready updates', () => {
  const {client,requests,push}=fixture();const proxy=requests.find(r=>r['@type']==='addProxy');
  push({'@type':'error','@extra':proxy['@extra'],code:400,message:'synthetic failure'});
  push({'@type':'updateAuthorizationState',authorization_state:{'@type':'authorizationStateReady'}});
  assert.equal(client.state().ready,false);assert.equal(requests.some(r=>r.type?.['@type']==='networkTypeOther'),false);
  assert.ok(requests.some(r=>r['@type']==='close'));
});
test('proxy initialization timeout closes safely and late acknowledgements cannot reactivate network', () => {
  const {client,requests,push}=fixture();const proxy=requests.find(r=>r['@type']==='addProxy'), now=Date.now;
  try {const future=now()+31000;Date.now=()=>future;client.drain();} finally {Date.now=now;}
  push({'@type':'addedProxy','@extra':proxy['@extra'],id:1});
  assert.equal(client.state().ready,false);assert.equal(requests.some(r=>r.type?.['@type']==='networkTypeOther'),false);
});
test('explicit direct mode clears the old persisted loopback proxy on startup', () => {
  const {requests}=fixture(false);assert.equal(requests[0]['@type'],'disableProxy');assert.equal(requests.some(r=>r['@type']==='addProxy'),false);
});

const { relayHeaderName, relayHeaders, relayRegistry, relaySelected, relayMigrate, relayUpsert, relayRemove } = require('../artifacts/tests/js/model/RelayModels.js');
const route = (id, overrides={}) => ({id,name:'Example '+id,endpoint:'relay.example.com',token,...overrides});
test('token header defaults preserve Bearer auth and custom fields send only the token',()=>{
 assert.deepEqual(relayHeaders({enabled:true,endpoint:'relay.example.com',token}),{Authorization:'Bearer '+token});
 assert.deepEqual(relayHeaders({enabled:true,endpoint:'relay.example.com',token,headerName:'X-Relay-Token'}),{'X-Relay-Token':token});
 assert.equal(relayHeaderName('authorization'),'Authorization');
 for(const header of ['Host','Connection','Upgrade','Sec-WebSocket-Key','Content-Length','Cookie','Proxy-Authorization','X-Token\r\nX-Injection: value'])assert.throws(()=>relayHeaderName(header));
});
test('single-route Asset migration retains the endpoint, token, active choice and default header',()=>{
 const old={enabled:true,endpoint:'relay.example.com',token};
 const registry=relayMigrate(old);assert.equal(registry.activeId,'legacy');assert.equal(registry.profiles.length,1);
 assert.deepEqual(relaySelected(registry),{...old,endpoint:'https://relay.example.com',headerName:'Authorization'});
 assert.deepEqual(relayMigrate({enabled:false,endpoint:'',token:''}),{version:2,activeId:'',profiles:[]});
 assert.throws(()=>relayMigrate({enabled:'true',endpoint:'relay.example.com',token}));
});
test('route management retains other secrets and direct selection retains all saved routes',()=>{
 let registry=relayRegistry({version:2,activeId:'a',profiles:[route('a'),route('b',{headerName:'X-Relay-Token'})]});
 const original=structuredClone(registry.profiles[0]);
 registry=relayUpsert(registry,route('b',{name:'Renamed',headerName:'X-Access-Token'}));
 assert.deepEqual(registry.profiles[0],original);assert.equal(registry.activeId,'a');
 assert.throws(()=>relayRemove(registry,'a'));assert.equal(relayRemove(registry,'b').profiles.length,1);
 const direct=relayRegistry({...registry,activeId:''});assert.equal(relaySelected(direct).enabled,false);assert.equal(direct.profiles.length,2);
 assert.equal(relaySelected({...registry,activeId:'b'}).headerName,'X-Access-Token');
});
test('corrupt route registries never silently fall back to direct',()=>{
 for(const registry of [{version:3,activeId:'',profiles:[]},{version:2,activeId:'missing',profiles:[]},{version:2,activeId:'a',profiles:[route('a'),route('a')]},{version:2,activeId:'',profiles:Array.from({length:33},(_,i)=>route('r'+i))},{version:2,activeId:'',profiles:[route('bad id')]},{version:2,activeId:'',profiles:[route('a',{name:''})]},{version:2,activeId:'',profiles:[route('a',{headerName:42})]}])assert.throws(()=>relayRegistry(registry));
});
