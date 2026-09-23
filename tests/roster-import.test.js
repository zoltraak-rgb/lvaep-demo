import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,validImportDate} from '../src/roster-import.js';
test('CSV preserves quoted commas, escaped quotes, multiline content and BOM',()=>{
 const csv=parseCsv('\uFEFFName,Notes\r\n"Rivera, Jordan","Said ""hello""\nsecond line"\r\n\r\n');
 assert.deepEqual(csv.headers,['name','notes']);assert.deepEqual(csv.rows,[{line:2,values:['Rivera, Jordan','Said "hello"\nsecond line']}]);
});
test('CSV rejects malformed quoting, duplicated headers and excessive input',()=>{
 for(const csv of ['name,name\na,b','name\n"unfinished','name\n"closed"oops','name\nnot"quoted'])assert.throws(()=>parseCsv(csv));
 assert.throws(()=>parseCsv('name\n'+'x\n'.repeat(501)),/500 rows/);assert.throws(()=>parseCsv('x'.repeat(500001)),/500 KB/);
});
test('import dates reject rollover and ambiguous formats',()=>{
 assert.equal(validImportDate('2026-02-29'),false);assert.equal(validImportDate('2028-02-29'),true);assert.equal(validImportDate('09/22/2026'),false);assert.equal(validImportDate('2026-13-01'),false);
});
