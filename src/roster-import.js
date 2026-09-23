// CSV is parsed locally. Nothing is saved until the staff member confirms a valid preview.
export function parseCsv(text) {
 if(typeof text!=='string'||text.length>500000)throw Error('Choose a CSV smaller than 500 KB.');
 text=text.replace(/^\uFEFF/,'');
 const rows=[];let row=[],field='',quoted=false,closed=false;
 const endField=()=>{row.push(field);field='';closed=false;};
 const endRow=()=>{endField();if(row.some(value=>value.trim()))rows.push(row);row=[];};
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=c;continue;}
  if(c===','){endField();continue;}
  if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;endRow();continue;}
  if(closed)throw Error('Unexpected text after a closing quote. Export the file as CSV again.');
  if(c==='"'){if(field)throw Error('Quotes must surround the entire field.');quoted=true;}else field+=c;
 }
 if(quoted)throw Error('A quoted field is unfinished.');
 if(field||row.length||closed)endRow();
 if(!rows.length)throw Error('The CSV is empty.');
 if(rows.length>501)throw Error('Import up to 500 rows at a time.');
 const headers=rows.shift().map(value=>value.trim().toLowerCase());
 if(headers.some(h=>!h)||new Set(headers).size!==headers.length)throw Error('Column names must be present and unique.');
 return {headers,rows:rows.map((values,index)=>({line:index+2,values}))};
}
export function validImportDate(value) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const date=new Date(`${value}T00:00:00Z`);return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value;
}
export function rosterRows(text) {
 const {headers,rows}=parseCsv(text),expected=['student_ref','student_name','tutor_ref','starts_on'];
 if(headers.length!==expected.length||expected.some(h=>!headers.includes(h)))throw Error('Use exactly these columns: '+expected.join(', '));
 if(!rows.length)throw Error('Add at least one student row.');
 const seen=new Set(),names=new Map();
 return rows.map(({line,values})=>{
  if(values.length!==headers.length)throw Error(`Row ${line}: expected four columns.`);
  const row=Object.fromEntries(headers.map((key,i)=>[key,values[i].trim()]));
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(row.student_ref))throw Error(`Row ${line}: student reference must use letters, numbers, hyphens or underscores (up to 80).`);
  if(!row.student_name||row.student_name.length>120)throw Error(`Row ${line}: enter a student name, up to 120 characters.`);
  if(Boolean(row.tutor_ref)!==Boolean(row.starts_on))throw Error(`Row ${line}: supply both tutor reference and start date, or leave both blank.`);
  if(row.starts_on&&!validImportDate(row.starts_on))throw Error(`Row ${line}: use a real date in YYYY-MM-DD format.`);
  const identity=[row.student_ref,row.tutor_ref,row.starts_on].join('|');
  if(seen.has(identity))throw Error(`Row ${line}: this student/assignment row is repeated.`);seen.add(identity);
  if(names.has(row.student_ref)&&names.get(row.student_ref)!==row.student_name)throw Error(`Row ${line}: the same student reference has different names.`);names.set(row.student_ref,row.student_name);
  return row;
 });
}
