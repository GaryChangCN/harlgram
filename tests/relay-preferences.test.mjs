import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),ts=require(process.env.HARLGRAM_TYPESCRIPT);
const models=require('../artifacts/tests/js/model/RelayModels.js');
const source=fs.readFileSync(new URL('../entry/src/main/ets/services/RelayPreferences.ets',import.meta.url),'utf8');
function fixture(initial){
 let stored=initial,failWrite=false,failRead=false;
 const asset={Tag:{ALIAS:1,RETURN_TYPE:2,SECRET:3,ACCESSIBILITY:4,CONFLICT_RESOLUTION:5},ReturnType:{ALL:1},Accessibility:{DEVICE_FIRST_UNLOCKED:1},ConflictResolution:{OVERWRITE:1},
  query:async()=>{if(failRead)throw {code:123};if(stored===undefined)throw {code:24000002};return [new Map([[3,new TextEncoder().encode(stored)]])];},
  add:async map=>{if(failWrite)throw Error('synthetic write failure');stored=new TextDecoder().decode(map.get(3));}};
 const kit={TextEncoder:class {encodeInto(v){return new TextEncoder().encode(v);}},TextDecoder:class{decodeToString(v){return new TextDecoder().decode(v);}}};
 const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 const mod={exports:{}};new Function('require','exports','module',js)(name=>({'@kit.AssetStoreKit':{asset},'@kit.ArkTS':{util:kit},'@kit.BasicServicesKit':{},'../model/RelayModels':models})[name],mod.exports,mod);
 return {api:mod.exports.RelayPreferences,get stored(){return stored;},set failWrite(v){failWrite=v;},set failRead(v){failRead=v;}};
}
const token='synthetic-token-for-tests-only-12345678';
test('legacy Asset reads migrate losslessly without a destructive eager write',async()=>{
 const old=JSON.stringify({enabled:true,endpoint:'https://relay.example.com',token});const f=fixture(old);
 const routes=await f.api.loadRegistry();assert.equal(routes.activeId,'legacy');assert.equal(f.stored,old);
 routes.profiles.push({id:'custom',name:'Custom',endpoint:'other.example.com',token,headerName:'X-Relay-Token'});
 await f.api.saveRegistry(routes);assert.equal(JSON.parse(f.stored).version,2);assert.equal((await f.api.load()).headerName,'Authorization');
 routes.activeId='custom';await f.api.saveRegistry(routes);assert.equal((await f.api.load()).headerName,'X-Relay-Token');
});
test('Asset failures and malformed active selection fail closed; only absent records default to direct',async()=>{
 assert.equal((await fixture().api.load()).enabled,false);
 for(const raw of ['{bad','null',JSON.stringify({version:2,activeId:'missing',profiles:[]}),JSON.stringify({enabled:'true',endpoint:'relay.example.com',token})])await assert.rejects(fixture(raw).api.load());
 const f=fixture();f.failRead=true;await assert.rejects(f.api.load());
});
test('failed Asset overwrite preserves the old configuration and secret',async()=>{
 const old=JSON.stringify({enabled:true,endpoint:'relay.example.com',token});const f=fixture(old);const routes=await f.api.loadRegistry();f.failWrite=true;
 await assert.rejects(f.api.saveRegistry({...routes,activeId:''}));assert.equal(f.stored,old);assert.equal((await f.api.load()).enabled,true);
});
