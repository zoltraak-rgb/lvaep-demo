import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {createDeliveryStore} from '../server/delivery-store.js';
let db;
const key=n=>n.toString(16).padStart(64,'0');
const claim=async n=>(await db.query('select public.claim_access_mail($1) as state',[key(n)])).rows[0].state;
const finish=(n,state)=>db.query('select public.finish_access_mail($1,$2)',[key(n),state]);
async function enable(allowance=10){
 await db.exec('reset role');
 await db.query("update app_private.access_mail_budget set enabled=true,allowance=$1,next_send_at='-infinity'",[allowance]);
 await db.exec('set role service_role');
}
before(async()=>{
 db=new PGlite();
 await db.exec('create role anon;create role authenticated;create role service_role;create schema app_private;revoke all on schema app_private from public;');
 await db.exec(await readFile(new URL('../supabase/migrations/0002_access_mail_delivery.sql',import.meta.url),'utf8'));
});
after(async()=>db?.close());
test('delivery is disabled by default and browser roles cannot access ledger or RPCs',async()=>{
 await db.exec('set role service_role');assert.equal(await claim(1),'blocked');
 for(const role of ['anon','authenticated']){
  await db.exec(`reset role;set role ${role}`);
  await assert.rejects(claim(1),/permission denied/);
  await assert.rejects(finish(1,'accepted'),/permission denied/);
  await assert.rejects(db.query('select * from app_private.access_mail_deliveries'),/permission denied/);
 }
});
test('database ledger preserves pending and unknown claims without resending',async()=>{
 await enable();assert.equal(await claim(1),'claimed');assert.equal(await claim(1),'blocked');
 await finish(1,'unknown');assert.equal(await claim(1),'blocked');
 await assert.rejects(finish(1,'accepted'),/already recorded/);
});
test('global rate and conservative budget block additional sends without losing successful replay',async()=>{
 await enable(2);assert.equal(await claim(2),'claimed');
 assert.equal(await claim(3),'blocked');
 await finish(2,'accepted');await finish(2,'accepted');assert.equal(await claim(2),'accepted');
 await enable(2);assert.equal(await claim(3),'blocked');
 await db.exec('reset role');
 assert.equal((await db.query('select reserved from app_private.access_mail_budget')).rows[0].reserved,2);
 assert.equal((await db.query('select count(*)::integer as n from app_private.access_mail_deliveries')).rows[0].n,2);
});
test('invalid keys and unclaimed outcomes cannot create ledger records',async()=>{
 await db.exec('set role service_role');
 await assert.rejects(db.query("select public.claim_access_mail('raw-token')"),/Invalid delivery key/);
 await assert.rejects(finish(99,'accepted'),/not claimed/);
 await assert.rejects(finish(2,'delivered'),/Invalid delivery outcome/);
});
test('server adapter propagates storage failure without exposing provider/database details',async()=>{
 const store=createDeliveryStore({rpc:async()=>({error:{message:'private database details'}})});
 await assert.rejects(store.claim(key(1)),/^Error: Delivery claim unavailable$/);
 await assert.rejects(store.finish(key(1),{state:'accepted'}),/^Error: Delivery completion unavailable$/);
});
