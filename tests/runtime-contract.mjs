import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {checkSlippy} from './slippy-contract.mjs';
import {checkAssets} from './asset-contract.mjs';

const require=createRequire(import.meta.url);
const AlanMap=require('../assets/map-ui.js');
assert.equal(AlanMap.version,'7.0.23');
const profile=AlanMap.__test.resolveQualityProfile({}, {devicePixelRatio:3,deviceMemory:8,hardwareConcurrency:12});
assert.equal(profile.mode,'balanced');
assert.equal(profile.antialias,false);
assert.ok(profile.maxTileCacheSize<=96);
const slippy=checkSlippy(import.meta.url);
const png=checkAssets(import.meta.url,slippy.source);
console.log(JSON.stringify({version:AlanMap.version,slippy:slippy.version,layers:slippy.ids,png},null,2));
