import test from 'node:test';
import assert from 'node:assert/strict';
import {createGeocoding} from './promotion-geocoding.js';
test('explicit address search validates coordinates, caches results and caps upstream traffic',async()=>{
 let time=10000,calls=0;const search=createGeocoding({env:{PROMOTION_MAP_SEARCH_ENABLED:'true'},now:()=>time,fetchImpl:async url=>{calls++;assert.equal(url.searchParams.get('q'),'3215 Fern Valley Road');return {ok:true,json:async()=>({features:[{properties:{street:'Fern Valley Road',housenumber:'3215',city:'Louisville'},geometry:{coordinates:[-85.705,38.157]}},{properties:{name:'Invalid'},geometry:{coordinates:[999,999]}}]})};}});
 const results=await search('3215 Fern Valley Road');assert.equal(results.length,1);assert.equal(results[0].latitude,38.157);assert.match(results[0].label,/Louisville/);await search('3215 Fern Valley Road');assert.equal(calls,1);await assert.rejects(search('Other business address'),{status:429});await assert.rejects(search('abc'),{status:400});time+=86400001;await search('3215 Fern Valley Road');assert.equal(calls,2);
});
test('disabled or unavailable lookup leaves a manual pin fallback',async()=>{
 await assert.rejects(createGeocoding({env:{}})('Business address'),{status:503});
 await assert.rejects(createGeocoding({env:{PROMOTION_MAP_SEARCH_ENABLED:'true'},fetchImpl:async()=>{throw Error('offline');}})('Business address'),error=>error.status===502&&/mapa/.test(error.message));
});
