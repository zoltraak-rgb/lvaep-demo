import './styles.css';
import {showAccountAccess} from './account-access.js';
import {client,rememberSession} from './auth.js';
import {nyToday,previousMonth,minutesLabel,monthLabel,summarize} from './domain.js';
const app=document.querySelector('#app');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let person,students=[],assignments=[],lessons=[],people=[];
let reportMonth=previousMonth();
let requestId=crypto.randomUUID();
const isStaff=()=>person?.roles.some(r=>['staff','admin'].includes(r));
const isTutor=()=>person?.roles.includes('tutor');
function shell(body) {
  app.innerHTML=`<header class="site-header"><a class="brand" href="/" aria-label="LVAEP Demo home"><span class="brand-mark" aria-hidden="true">L</span><span>LVAEP <small>TUTORING RECORDS</small></span></a><div class="header-right"><span class="demo-tag">Student demonstration</span>${person?`<span class="identity">${escape(person.display_name)}</span><button class="quiet" id="signout">Sign out</button>`:''}</div></header><main id="main" tabindex="-1">${body}</main><footer>Fictional demonstration · Not an official LVAEP service</footer>`;
  document.querySelector('#signout')?.addEventListener('click',async()=>{
    const {error}=await client.auth.signOut({scope:'local'});
    if(error) { alert('Sign out could not finish. Please try again.'); return; }
    person=null; students=[]; assignments=[]; lessons=[]; people=[]; login();
  });
}
function login() {
  shell(`<section class="welcome"><div class="intro"><p class="eyebrow">LESS PAPERWORK. MORE TEACHING.</p><h1>A little less admin.<br>A little more possibility.</h1><p class="lede">Keep your tutoring records together, one lesson at a time.</p><div class="steps"><div><span>01</span><p><strong>Record a lesson</strong><br>Capture time with your students.</p></div><div><span>02</span><p><strong>Review your month</strong><br>Check your records in one place.</p></div><div><span>03</span><p><strong>See the difference</strong><br>Help staff understand the month.</p></div></div></div><section class="card signin" aria-labelledby="signin-title"><p class="eyebrow">WELCOME BACK</p><h2 id="signin-title">Sign in to your workspace</h2><p class="muted">Use the email address linked to your invitation.</p>${!client?'<div class="notice" role="status"><strong>Setup is still in progress.</strong><br>Sign-in will be available once the project’s account service is connected. No records are being saved in this preview.</div>':''}<form id="signin-form"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required ${!client?'disabled':''}><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required ${!client?'disabled':''}><label class="check"><input name="remember" type="checkbox" checked> <span>Keep me signed in<small>Uncheck on a shared computer.</small></span></label><button class="primary full" ${!client?'disabled':''}>Sign in <span aria-hidden="true">→</span></button><p id="login-status" role="alert"></p></form><p class="small muted">Access is by invitation. Account setup and password recovery are still being connected.</p></section></section>`);
  document.querySelector('#signin-form').addEventListener('submit',async event=>{
    event.preventDefault(); const form=event.currentTarget,button=form.querySelector('button');
    button.disabled=true; document.querySelector('#login-status').textContent='Signing in…';
    rememberSession(form.remember.checked);
    try {
      const {error}=await client.auth.signInWithPassword({email:form.email.value.trim(),password:form.password.value});
      if(error) throw error;
      form.password.value=''; await loadHome();
    } catch { document.querySelector('#login-status').textContent='Could not sign in. Check your email and password, then try again.'; button.disabled=false; }
  });
}
async function checked(query) { const {data,error}=await query; if(error) throw error; return data; }
async function loadHome() {
  try {
    const {data:{user},error}=await client.auth.getUser();
    if(error||!user) { person=null; login(); return; }
    person=await checked(client.from('people').select('*').eq('id',user.id).maybeSingle());
    if(!person?.active) { shell('<section class="card"><h1>Your access is not ready</h1><p>Your account needs an active project assignment. Contact the project administrator.</p></section>'); return; }
    await reloadData(); home();
  } catch {
    shell('<section class="card"><h1>We couldn’t load your workspace</h1><p role="alert">Check your connection, then try again. This does not mean your students or records are missing.</p><button id="retry" class="primary">Try again</button></section>');
    document.querySelector('#retry').onclick=loadHome;
  }
}
async function allRows(makeQuery) {
  const rows=[];
  for(let offset=0;;offset+=1000) {
    const page=await checked(makeQuery().range(offset,offset+999));
    rows.push(...page);
    if(page.length<1000) return rows;
  }
}
async function reloadData() {
  [students,assignments,lessons,people]=await Promise.all([
    allRows(()=>client.from('students').select('*').order('display_name').order('id')),
    allRows(()=>client.from('assignments').select('*').order('id')),
    allRows(()=>client.from('lessons').select('id,tutor_id,lesson_date,minutes,voided,attendance(student_id,minutes)').order('lesson_date',{ascending:false}).order('id')),
    allRows(()=>client.from('people').select('id,display_name,roles,active').order('display_name').order('id'))
  ]);
}
const studentName=id=>students.find(s=>s.id===id)?.display_name||'Student';
function lessonList(items) {
  return items.length?`<ul class="record-list">${items.map(l=>`<li><div><strong>${l.attendance.map(a=>escape(studentName(a.student_id))).join(', ')}</strong><span>${escape(l.lesson_date)} · Recorded</span></div><strong>${minutesLabel(l.minutes)}</strong></li>`).join('')}</ul>`:'<p class="empty">No recorded lessons in this period.</p>';
}
function home() {
  const mine=lessons.filter(l=>l.tutor_id===person.id&&!l.voided);
  const current=summarize(mine,nyToday().slice(0,7));
  shell(`<section class="page-heading"><div><p class="eyebrow">YOUR WORKSPACE</p><h1>Hello, ${escape(person.display_name)}.</h1><p class="muted">${isTutor()?'Your students. Your lessons. All in one place.':'A clear picture of your tutoring program.'}</p></div>${isTutor()?'<button class="primary" id="open-log">+ Log session</button>':''}</section><nav class="tabs" aria-label="Workspace sections">${isTutor()?'<a href="#tutor-home">Home</a><a href="#calendar">Calendar</a>':''}${isStaff()?'<a href="#report">Reports</a><a href="#roster">Roster</a>':''}</nav>${isTutor()?`<section id="tutor-home"><div class="metric-grid"><div class="card metric"><span>This month · Teaching time</span><strong>${minutesLabel(current.teachingMinutes)}</strong></div><div class="card metric"><span>Students taught this month</span><strong>${current.studentCount}</strong></div></div><section class="card"><div class="section-heading"><h2>Recently recorded</h2><span class="muted">Saved lessons</span></div>${lessonList(mine.slice(0,5))}</section><section id="calendar" class="card"><div class="section-heading"><h2>Calendar</h2><label class="inline-label">Month <input id="calendar-month" type="month" value="${nyToday().slice(0,7)}"></label></div><div id="calendar-records">${lessonList(current.lessons)}</div></section></section>`:''}${isStaff()?`<section id="report" class="card"><div class="section-heading"><div><p class="eyebrow">PROGRAM OVERVIEW</p><h2>Monthly report</h2></div><label class="inline-label">Month <input id="report-month" type="month" value="${reportMonth}"></label></div><div id="report-content"></div><button class="quiet" id="refresh-report">Refresh saved records</button><p class="small muted">Review confirmations and exports are not available in this first build.</p></section><section id="roster" class="card"><div class="section-heading"><h2>Student roster</h2><button id="add-student" class="secondary">+ Add student</button></div>${students.length?`<ul class="record-list">${students.map(s=>`<li><div><strong>${escape(s.display_name)}</strong><span>${s.archived?'Archived':'Active'}</span></div><button class="quiet assign" data-id="${s.id}">Assign tutor</button></li>`).join('')}</ul>`:'<p class="empty">Add the first fictional student to get started.</p>'}</section>`:''}<dialog id="form-dialog"></dialog>`);
  document.querySelector('#open-log')?.addEventListener('click',()=>logForm());
  document.querySelector('#calendar-month')?.addEventListener('change',event=>{
    document.querySelector('#calendar-records').innerHTML=lessonList(summarize(mine,event.target.value).lessons);
  });
  if(isStaff()) {
    report();
    document.querySelector('#report-month').onchange=event=>{ if(event.target.value) {reportMonth=event.target.value;report();} };
    document.querySelector('#refresh-report').onclick=async event=>{event.target.disabled=true; try {await reloadData();report();} catch {alert('Could not refresh. Previously loaded records are still shown.');} finally {event.target.disabled=false;} };
    document.querySelector('#add-student').onclick=studentForm;
    document.querySelectorAll('.assign').forEach(button=>button.onclick=()=>assignmentForm(button.dataset.id));
  }
}
function report() {
  const totals=summarize(lessons,reportMonth);
  const tutorIds=[...new Set(totals.lessons.map(l=>l.tutor_id))];
  document.querySelector('#report-content').innerHTML=`<p class="muted">${monthLabel(reportMonth)} · Records retrieved ${new Date().toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</p><div class="metric-grid"><div class="metric"><span>Distinct students attending</span><strong>${totals.studentCount}</strong></div><div class="metric"><span>Student attendance time</span><strong>${minutesLabel(totals.studentMinutes)}</strong></div></div><details><summary>Teaching time details</summary><p>Total hours taught: <strong>${minutesLabel(totals.teachingMinutes)}</strong></p><p class="small muted">Across all tutors for this month. Each shared lesson counts once, regardless of how many students attended.</p></details>${tutorIds.map(id=>{
    const data=summarize(totals.lessons.filter(l=>l.tutor_id===id),reportMonth);
    return `<details><summary>${escape(people.find(p=>p.id===id)?.display_name||'Tutor')} <span>${minutesLabel(data.teachingMinutes)}</span></summary>${lessonList(data.lessons)}</details>`;
  }).join('')||'<p class="empty">No recorded lessons for this month.</p>'}`;
}
function dialog(title,body) {
  const el=document.querySelector('#form-dialog');
  el.innerHTML=`<div class="section-heading"><h2>${title}</h2><button class="quiet" id="close-dialog" aria-label="Close dialog">Close</button></div>${body}`;
  el.setAttribute('aria-label',title);el.showModal();
  document.querySelector('#close-dialog').onclick=()=>el.close();
  return el;
}
function logForm() {
  requestId=crypto.randomUUID();
  const el=dialog('Log a session',`<p class="muted">Record one lesson taught together. Only select students who attended.</p><form id="lesson-form"><label for="lesson-date">Lesson date</label><input id="lesson-date" type="date" value="${nyToday()}" required><label for="duration">Lesson duration, in minutes</label><input id="duration" type="number" min="1" step="1" value="90" required><fieldset><legend>Who attended?</legend><div id="participants"></div></fieldset><div id="duplicate-warning"></div><p id="save-status" role="status" aria-live="polite"></p><button class="primary full">Save session</button></form>`);
  const form=document.querySelector('#lesson-form');
  function choices() {
    const date=document.querySelector('#lesson-date').value;
    const assigned=new Set(assignments.filter(a=>a.tutor_id===person.id&&a.starts_on<=date&&(!a.ends_on||a.ends_on>=date)).map(a=>a.student_id));
    document.querySelector('#participants').innerHTML=students.filter(s=>assigned.has(s.id)).map(s=>`<div class="participant"><label class="check"><input type="checkbox" name="student" value="${s.id}"> ${escape(s.display_name)}</label><label class="partial">Minutes <input aria-label="Attendance minutes for ${escape(s.display_name)}" type="number" min="1" step="1" data-student="${s.id}" placeholder="Same as lesson"></label></div>`).join('')||'<p class="muted">No students are assigned for this date. Contact staff to check your assignments.</p>';
  }
  document.querySelector('#lesson-date').onchange=choices; choices();
  let pendingPayload=null;
  form.onsubmit=async event=>{
    event.preventDefault();
    const minutes=Number(document.querySelector('#duration').value);
    const selected=[...form.querySelectorAll('[name=student]:checked')].map(input=>({student_id:input.value,minutes:Number(form.querySelector(`[data-student="${input.value}"]`).value)||minutes}));
    const status=document.querySelector('#save-status');
    if(!selected.length) {status.textContent='Select at least one student who attended.';return;}
    if(selected.some(s=>s.minutes>minutes||!Number.isInteger(s.minutes)||s.minutes<=0)) {status.textContent='Each attendance duration must be positive whole minutes, no more than the lesson duration.';return;}
    const payload={p_request:requestId,p_date:document.querySelector('#lesson-date').value,p_minutes:minutes,p_participants:selected,p_allow_additional:form.querySelector('#additional')?.checked||false};
    // Freeze the request after an uncertain response. Retrying sends the same logical save.
    if(pendingPayload) Object.assign(payload,pendingPayload);
    const button=form.querySelector('button[type=submit]')||form.querySelector('button.primary');
    button.disabled=true;status.textContent='Saving…';
    try {
      const result=await checked(client.rpc('record_lesson',payload));
      pendingPayload=null;
      if(result.status==='duplicate_warning') {
        document.querySelector('#duplicate-warning').innerHTML=`<div class="notice"><strong>There is already attendance on this date.</strong><ul>${result.existing.map(l=>`<li>${escape(l.date)} · ${minutesLabel(l.minutes)}</li>`).join('')}</ul><label class="check"><input id="additional" type="checkbox"> This is another lesson. Save it separately.</label><p class="small">Or close this form to return to your recorded lessons.</p></div>`;
        status.textContent='Check the existing entries before adding another session.';button.disabled=false;return;
      }
      if(result.status!=='saved') throw new Error('Unexpected save result');
      status.textContent='Saved.';
      form.querySelectorAll('input').forEach(input=>input.disabled=true);
      button.textContent='Saved';
      // A refresh failure must never be reported as a failed save.
      try {await reloadData();el.close();home();} catch {status.textContent='Saved. The record list could not refresh; close this form and reload the page.';}
    } catch(error) {
      if(!error.code) {
        pendingPayload=payload;
        form.querySelectorAll('input').forEach(input=>input.disabled=true);
        status.textContent='Not saved yet—check your connection. Retry will safely check this exact submission.';
      } else {status.textContent=error.message||'Could not save. Check the values and try again.';}
      button.textContent='Retry save';button.disabled=false;
    }
  };
}
function studentForm() {
  const id=crypto.randomUUID();
  dialog('Add student','<form id="student-form"><label for="student-name">Student name</label><input id="student-name" maxlength="120" required><p class="small muted">Use fictional information for this demonstration. Matching names are kept as separate people.</p><p id="form-status" role="alert"></p><button class="primary">Save student</button></form>');
  document.querySelector('#student-form').onsubmit=async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
    try {await checked(client.rpc('save_student',{p_id:id,p_name:document.querySelector('#student-name').value,p_archived:false,p_version:0})); document.querySelector('#form-status').textContent='Saved.';await loadHome();}
    catch(error) {document.querySelector('#form-status').textContent=error.message||'Could not save. Try again.';button.disabled=false;}
  };
}
function assignmentForm(studentId) {
  const id=crypto.randomUUID();
  dialog('Assign a tutor',`<p>${escape(studentName(studentId))}</p><form id="assignment-form"><label for="tutor">Tutor</label><select id="tutor" required><option value="">Choose a tutor</option>${people.filter(p=>p.active&&p.roles.includes('tutor')).map(p=>`<option value="${p.id}">${escape(p.display_name)}</option>`).join('')}</select><label for="starts">First tutoring date</label><input id="starts" type="date" value="${nyToday()}" required><p id="form-status" role="alert"></p><button class="primary">Save assignment</button></form>`);
  document.querySelector('#assignment-form').onsubmit=async event=>{
    event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
    try {await checked(client.rpc('assign_student',{p_id:id,p_tutor:document.querySelector('#tutor').value,p_student:studentId,p_start:document.querySelector('#starts').value}));await loadHome();}
    catch(error) {document.querySelector('#form-status').textContent=error.message||'Could not save. Try again.';button.disabled=false;}
  };
}
if(showAccountAccess({client,shell})) {
  // Account-link handling owns this page until the user finishes or leaves.
} else if(client) {
  shell('<section class="card" role="status"><h1>Opening your workspace…</h1></section>');
  loadHome();
  client.auth.onAuthStateChange(event=>{
    if(event==='SIGNED_OUT') {person=null;students=[];assignments=[];lessons=[];people=[];login();}
  });
} else login();
