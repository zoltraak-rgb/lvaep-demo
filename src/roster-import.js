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
