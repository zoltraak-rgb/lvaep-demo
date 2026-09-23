import './styles.css';
import {rosterRows} from './roster-import.js';
import {showAccountAccess} from './account-access.js';
import {client,rememberSession} from './auth.js';
import {nyToday,previousMonth,minutesLabel,monthLabel,summarize,monthlyReportMembers,calendarDays,reportCsv,achievementTypes} from './domain.js';
const app=document.querySelector('#app');
app.addEventListener('click',event=>{const button=event.target.closest('[data-edit-lesson]');if(button)editLesson(button.dataset.editLesson);const plan=event.target.closest('[data-edit-plan]');if(plan)editPlan(plan.dataset.editPlan);const held=event.target.closest('[data-held-plan]');if(held){const o=occurrences.find(o=>o.id===held.dataset.heldPlan);if(o)logForm(o.lesson_date,o);}});
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let person,students=[],assignments=[],lessons=[],people=[],plans=[],occurrences=[],studentRequests=[],pendingReady=false,recordsRetrievedAt=null,achievements=[],achievementsReady=false,absences=[],programSettings=null;
let reportMonth=previousMonth();
let requestId=crypto.randomUUID();
const isStaff=()=>person?.roles.some(r=>['staff','admin'].includes(r));
const isTutor=()=>person?.roles.includes('tutor');
function shell(body) {
  document.querySelector('#workspace-coach')?.remove();
  app.innerHTML=`<header class="site-header"><a class="brand" href="./" aria-label="LVAEP Demo home"><span class="brand-mark" aria-hidden="true">L</span><span>LVAEP <small>TUTORING RECORDS</small></span></a><div class="header-right">${person?`<span class="identity">${escape(person.display_name)}</span><button class="quiet" id="signout">Sign out</button>`:''}</div></header><main id="main" tabindex="-1">${body}</main><footer>LVAEP · Tutoring records</footer>`;
  document.querySelector('#signout')?.addEventListener('click',async()=>{
    const {error}=await client.auth.signOut({scope:'local'});
    if(error) { alert('Sign out could not finish. Please try again.'); return; }
    person=null; students=[]; assignments=[]; lessons=[]; people=[]; plans=[]; occurrences=[]; login();
  });
}
function login() {
  shell(`<section class="welcome"><div class="intro"><p class="eyebrow">LESS PAPERWORK. MORE TEACHING.</p><h1>A little less admin.<br>A little more possibility.</h1><p class="lede">Keep your tutoring records together, one lesson at a time.</p><div class="steps"><div><span>01</span><p><strong>Record a lesson</strong><br>Capture time with your students.</p></div><div><span>02</span><p><strong>Review your month</strong><br>Check your records in one place.</p></div><div><span>03</span><p><strong>See the difference</strong><br>Help staff understand the month.</p></div></div></div><section class="card signin" aria-labelledby="signin-title"><p class="eyebrow">WELCOME BACK</p><h2 id="signin-title">Sign in to your workspace</h2><p class="muted">Use the email address linked to your invitation.</p>${!client?'<div class="notice" role="status"><strong>Setup is still in progress.</strong><br>Sign-in will be available once the project’s account service is connected. No records are being saved in this preview.</div>':''}<form id="signin-form"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="username" required ${!client?'disabled':''}><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required ${!client?'disabled':''}><label class="check"><input name="remember" type="checkbox" checked> <span>Keep me signed in<small>Uncheck on a shared computer.</small></span></label><button class="primary full" ${!client?'disabled':''}>Sign in <span aria-hidden="true">→</span></button><p id="login-status" role="alert"></p></form><section class="demo-entry"><p class="eyebrow">TRY IT NOW · NO SIGN-UP NEEDED</p><p>Try a prebuilt account with students, lessons and reviews.</p><div class="demo-buttons"><button type="button" class="secondary" data-demo-role="tutor">Try as tutor →</button><button type="button" class="secondary" data-demo-role="staff">Try as staff →</button></div><p class="small muted">Shared accounts with fictional records. Changes are visible to other visitors. The intended account setup uses one email invitation link; these buttons let you explore directly.</p></section><p class="small muted">For your own account, contact your program administrator.</p></section></section>`);
  document.querySelectorAll('[data-demo-role]').forEach(button=>button.onclick=async()=>{
    const buttons=[...document.querySelectorAll('[data-demo-role]')];buttons.forEach(b=>b.disabled=true);
    const status=document.querySelector('#login-status');status.textContent='Opening shared workspace…';rememberSession(false);
    try {const {error}=await client.auth.signInWithPassword({email:button.dataset.demoRole+'@lvaep-demo.example',password:'Lvaep-Public-Explore-2026!'});if(error)throw error;await loadHome();}
    catch {status.textContent='Could not open this account. Please try again shortly.';buttons.forEach(b=>b.disabled=false);}
  });
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
async function loadLessons() {
  try {
    const rows=await allRows(()=>client.from('lessons').select('id,tutor_id,lesson_date,minutes,version,voided,attendance(student_id,minutes),pending_attendance(request_id,minutes)').order('lesson_date',{ascending:false}).order('id'));
    studentRequests=await allRows(()=>client.from('student_requests').select('*').order('created_at').order('id'));
    pendingReady=true;return rows;
  } catch(error) {
    if(!['PGRST200','PGRST205','42P01'].includes(error.code))throw error;
    pendingReady=false;studentRequests=[];
    return allRows(()=>client.from('lessons').select('id,tutor_id,lesson_date,minutes,version,voided,attendance(student_id,minutes)').order('lesson_date',{ascending:false}).order('id'));
  }
}
const requestStatus=id=>studentRequests.find(r=>r.id===id)?.status==='rejected'?'Rejected — attendance retained outside official totals':'Waiting for staff';
const requestName=id=>studentRequests.find(r=>r.id===id)?.display_name||'Student awaiting connection';
function pendingDetails(items) {
  const entries=items.flatMap(l=>(l.pending_attendance||l.pending||[]).map(a=>({...a,date:l.lesson_date||l.date})));
  if(!entries.length)return '';
  return `<details class="pending-details"><summary>${new Set(entries.map(a=>a.request_id)).size} student connection request(s) unresolved · ${minutesLabel(entries.reduce((n,a)=>n+a.minutes,0))}</summary><p>Teaching time is already counted once. These attendance minutes remain separate from official student totals until staff connects the student.</p><ul class="record-list">${entries.map(a=>`<li>${escape(requestName(a.request_id))} — ${escape(requestStatus(a.request_id))} · ${escape(a.date)} · ${minutesLabel(a.minutes)}</li>`).join('')}</ul></details>`;
}
async function loadAchievements() {
  try {const rows=await allRows(()=>client.from('achievements').select('*').order('achieved_on').order('id'));achievementsReady=true;return rows;}
  catch(error){if(!['PGRST205','42P01'].includes(error.code))throw error;achievementsReady=false;return [];}
}
async function loadAbsences() {
 try{const settings=await checked(client.from('program_settings').select('*').maybeSingle());const rows=await allRows(()=>client.from('absence_records').select('*').order('absence_date').order('id'));programSettings=settings;return rows;}
 catch(error){if(!['PGRST205','42P01'].includes(error.code))throw error;programSettings=null;return [];}
}
async function reloadData() {
  [students,assignments,lessons,people,plans,occurrences,achievements,absences]=await Promise.all([
    allRows(()=>client.from('students').select('*').order('display_name').order('id')),
    allRows(()=>client.from('assignments').select('*').order('id')),
    loadLessons(),
    allRows(()=>client.from('people').select('id,display_name,roles,active,version').order('display_name').order('id')),
    isTutor()?allRows(()=>client.from('lesson_plans').select('id,tutor_id,version').order('id')):[],
    isTutor()?allRows(()=>client.from('planned_occurrences').select('*').order('lesson_date').order('id')):[],
    loadAchievements(),loadAbsences()
  ]);
  recordsRetrievedAt=new Date().toISOString();
}
const studentName=id=>students.find(s=>s.id===id)?.display_name||'Student';
function lessonList(items) {
  return items.length?`<ul class="record-list">${items.map(l=>`<li><div><strong>${[...l.attendance.map(a=>escape(studentName(a.student_id))),...(l.pending_attendance||[]).map(a=>`${escape(requestName(a.request_id))} — ${escape(requestStatus(a.request_id))}`)].join(', ')}</strong><span>${escape(l.lesson_date)} · Recorded</span></div><strong>${minutesLabel(l.minutes)}</strong><button class="quiet" data-edit-lesson="${l.id}">View / edit</button></li>`).join('')}</ul>`:'<p class="empty">No recorded lessons in this period.</p>';
}
function home() {
  const mine=lessons.filter(l=>l.tutor_id===person.id&&!l.voided);
  const current=summarize(mine,nyToday().slice(0,7));
  shell(`<section class="page-heading"><div><p class="eyebrow">YOUR WORKSPACE</p><h1>Hello, ${escape(person.display_name)}.</h1><p class="muted">${isTutor()?'Your students. Your lessons. All in one place.':'A clear picture of your tutoring program.'}</p></div>${isTutor()?'<button class="primary" id="open-log">+ Log session</button>':''}</section><nav class="tabs" aria-label="Workspace sections"><button class="quiet" id="workspace-tour">Quick tour</button>${isTutor()?'<a href="#tutor-home">Home</a><a href="#calendar">Calendar</a>':''}${isStaff()?`<a href="#report">Reports</a><a href="#roster">Roster</a><button class="quiet" id="open-history">Change history</button>${person.roles.includes('admin')?'<button class="quiet" id="program-settings">Program settings</button><button class="quiet" id="manage-access">Account access</button>':''}`:''}</nav>${isTutor()?`<section id="tutor-home">${occurrences.some(o=>o.lesson_date===nyToday()&&!o.canceled)?`<section class="card" id="today-plans"><h2>Today’s plans</h2><p class="small muted">Check who attended before saving. Planned time is not recorded attendance.</p>${plannedList(occurrences.filter(o=>o.lesson_date===nyToday()&&!o.canceled))}</section>`:""}<section class="card"><h2>Monthly review</h2><p>Check all your students together, then confirm the month.</p><button class="secondary" id="open-review">Review a month</button> <button class="quiet" id="new-group">Create a student group</button> <button class="quiet" id="manage-groups">My groups</button> <button class="quiet" id="missing-student">Student missing?</button> <button class="quiet" id="student-profiles">My students / achievements</button></section><div class="metric-grid"><div class="card metric"><span>This month · Teaching time</span><strong>${minutesLabel(current.teachingMinutes)}</strong></div><div class="card metric"><span>Students taught this month</span><strong>${current.studentCount}</strong></div></div><section class="card"><div class="section-heading"><h2>Recently recorded</h2><span class="muted">Saved lessons</span></div>${lessonList(mine.slice(0,5))}</section><section id="calendar" class="card"><div class="section-heading"><h2>Calendar</h2><label class="inline-label">Month <input id="calendar-month" type="month" value="${nyToday().slice(0,7)}"></label></div><button id="new-plan" class="secondary">Plan weekly lessons</button><div class="calendar-switch" aria-label="Calendar view"><button id="calendar-grid-view" class="secondary" aria-pressed="true">Month view</button><button id="calendar-list-view" class="quiet" aria-pressed="false">List view</button></div><div id="calendar-records"></div><div id="calendar-day" aria-live="polite"></div></section></section>`:''}${isStaff()?`<section id="report" class="card"><div class="section-heading"><div><p class="eyebrow">PROGRAM OVERVIEW</p><h2>Monthly report</h2></div><label class="inline-label">Month <input id="report-month" type="month" value="${reportMonth}"></label></div><div id="report-content"></div><button class="quiet" id="refresh-report">Refresh saved records</button><p class="small muted">Open a tutor’s monthly review to check confirmation. Use Print / Save PDF to save a PDF through your browser’s print window.</p></section><section id="roster" class="card"><div class="section-heading"><h2>Student roster</h2><button id="add-student" class="secondary">+ Add student</button><button id="import-roster" class="secondary">Import roster</button><button id="student-requests" class="quiet">Missing-student requests</button></div>${students.length?`<ul class="record-list">${students.map(s=>`<li><div><strong>${escape(s.display_name)}</strong><span>${s.archived?'Archived':'Active'}${assignments.some(a=>a.student_id===s.id&&a.stopped)?' · Assignment ended — check profile':''}</span></div><div><button class="quiet student-profile" data-id="${s.id}">Student profile</button><button class="quiet edit-student" data-id="${s.id}">Edit student</button>${!s.archived?`<button class="quiet assign" data-id="${s.id}">Assign tutor</button>`:""}</div></li>`).join('')}</ul>`:'<p class="empty">Add the first fictional student to get started.</p>'}</section>`:''}<dialog id="form-dialog"></dialog>`);
  document.querySelector('#workspace-tour').onclick=()=>startTour();
  document.querySelector('#student-profiles')?.addEventListener('click',studentProfiles);
  document.querySelectorAll('.student-profile').forEach(button=>button.onclick=()=>studentProfile(button.dataset.id));
  document.querySelector('#program-settings')?.addEventListener('click',programSettingsForm);
  document.querySelector('#manage-access')?.addEventListener('click',accessList);
  document.querySelector('#import-roster')?.addEventListener('click',importRosterForm);
  document.querySelector('#student-requests')?.addEventListener('click',staffRequests);
  document.querySelector('#missing-student')?.addEventListener('click',missingStudentForm);
  document.querySelector('#new-plan')?.addEventListener('click',planForm);
  document.querySelector('#manage-groups')?.addEventListener('click',manageGroups);
  document.querySelector('#new-group')?.addEventListener('click',()=>groupForm());
  document.querySelector('#open-review')?.addEventListener('click',()=>reviewForm(person.id));
  document.querySelector('#open-log')?.addEventListener('click',()=>logForm());
  if(isTutor()) {
    let view='month';
    const render=()=>{
      const month=document.querySelector('#calendar-month').value;
      if(!calendarDays(month).length)return;
      const items=summarize(mine,month).lessons;
      const planned=occurrences.filter(o=>o.lesson_date.startsWith(month));
      const records=document.querySelector('#calendar-records');
      document.querySelector('#calendar-day').innerHTML='';
      document.querySelector('#calendar-grid-view').setAttribute('aria-pressed',String(view==='month'));
      document.querySelector('#calendar-list-view').setAttribute('aria-pressed',String(view==='list'));
      if(view==='list'){records.innerHTML=plannedList(planned)+lessonList(items);return;}
      records.innerHTML=`<p class="small muted">Plans do not count as attendance. Select a day for planned and recorded lessons.</p><div class="calendar-grid" aria-label="${monthLabel(month)}">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=>`<span class="weekday">${day}</span>`).join('')}${calendarDays(month).map(date=>{
        if(!date)return '<span aria-hidden="true"></span>';
        const count=items.filter(l=>l.lesson_date===date).length;
        const scheduled=planned.filter(o=>o.lesson_date===date&&!o.canceled&&!o.lesson_id).length;
        return `<button class="calendar-date" data-date="${date}" aria-label="${date}, ${count} recorded lesson${count===1?'':'s'}, ${scheduled} planned" ${date===nyToday()?'aria-current="date"':''}><strong>${Number(date.slice(-2))}</strong>${count?`<small>${count} saved</small>`:''}${scheduled?`<small>${scheduled} planned</small>`:''}</button>`;
      }).join('')}</div>`;
      records.querySelectorAll('[data-date]').forEach(button=>button.onclick=()=>{
        records.querySelectorAll('[data-date]').forEach(day=>day.setAttribute('aria-pressed',String(day===button)));
        const date=button.dataset.date;
        document.querySelector('#calendar-day').innerHTML=`<h3>${escape(date)}</h3>${plannedList(planned.filter(o=>o.lesson_date===date))}${lessonList(items.filter(l=>l.lesson_date===date))}<button id="log-calendar-day" class="secondary">Log a lesson on this date</button>`;
        document.querySelector('#log-calendar-day').onclick=()=>logForm(date);
      });
    };
    document.querySelector('#calendar-month').onchange=render;
    document.querySelector('#calendar-grid-view').onclick=()=>{view='month';render();};
    document.querySelector('#calendar-list-view').onclick=()=>{view='list';render();};
    render();
  }
  if(isStaff()) {
    report();
    document.querySelector('#report-month').onchange=event=>{ if(event.target.value) {reportMonth=event.target.value;report();} };
    document.querySelector('#refresh-report').onclick=async event=>{event.target.disabled=true; try {await reloadData();report();} catch {alert('Could not refresh. Previously loaded records are still shown.');} finally {event.target.disabled=false;} };
    document.querySelector('#add-student').onclick=()=>studentForm();
    document.querySelector('#open-history').onclick=historyForm;
    document.querySelectorAll('.edit-student').forEach(button=>button.onclick=()=>studentForm(students.find(s=>s.id===button.dataset.id)));
    document.querySelectorAll('.assign').forEach(button=>button.onclick=()=>assignmentForm(button.dataset.id));
  }
  try {if(!localStorage.getItem('lvaep-tour-v1:'+person.id))startTour();}catch {}
}
function startTour() {
  document.querySelector('#workspace-coach')?.remove();
  const steps=isTutor()?[
    ['#open-log','Record a lesson','Start here after teaching. Enter teaching time once, then record each student’s attendance.'],
    ['#student-profiles','Meet your students','Open student profiles to see assignments and record achievements.'],
    ['#calendar','Plan the week','Plan recurring lessons and open any day. Plans only become recorded hours after attendance is confirmed.'],
    ['#open-review','Finish the month','Review every student together and confirm your monthly records.']
  ]:[
    ['#report','Review the program','Choose a month, then open an individual tutor’s review. Student attendance details are inside each review.'],
    ['#roster','Manage the roster','Open profiles, assign tutors, and update students from this list.'],
    ['#student-requests','Connect missing students','Resolve requests from tutors so pending attendance joins the official student record.'],
    ['#open-history','Follow recent changes','See who changed a record and what changed, with technical details tucked away.']
  ];
  let index=0;const coach=document.createElement('aside');coach.id='workspace-coach';coach.setAttribute('role','dialog');coach.setAttribute('aria-label','Workspace tour');document.body.append(coach);
  const finish=()=>{document.querySelectorAll('.tour-target').forEach(e=>e.classList.remove('tour-target'));coach.remove();try{localStorage.setItem('lvaep-tour-v1:'+person.id,'seen');}catch{}document.querySelector('#workspace-tour')?.focus();};
  const render=()=>{document.querySelectorAll('.tour-target').forEach(e=>e.classList.remove('tour-target'));const [selector,title,body]=steps[index];const target=document.querySelector(selector);target?.classList.add('tour-target');target?.scrollIntoView?.({behavior:'smooth',block:'center'});coach.innerHTML=`<p class="eyebrow">QUICK TOUR · ${index+1} OF ${steps.length}</p><h2>${title}</h2><p>${body}</p><div class="demo-buttons"><button class="quiet" id="tour-skip">Skip tour</button><button class="primary" id="tour-next">${index===steps.length-1?'Get started':'Next →'}</button></div>`;coach.querySelector('#tour-skip').onclick=finish;coach.querySelector('#tour-next').onclick=()=>{if(++index===steps.length)finish();else render();};coach.querySelector('#tour-next').focus();};
  coach.addEventListener('keydown',event=>{if(event.key==='Escape')finish();});render();
}
function report() {
  const totals=summarize(lessons,reportMonth);
  const members=monthlyReportMembers(assignments,lessons,reportMonth);
  const tutorIds=[...members.keys()].sort((a,b)=>(people.find(p=>p.id===a)?.display_name||'').localeCompare(people.find(p=>p.id===b)?.display_name||''));
  const year=Number(reportMonth.slice(0,4)), fiscalStart=Number(reportMonth.slice(5))>=7?year:year-1;
  document.querySelector('#report-content').innerHTML=`<p class="muted">${monthLabel(reportMonth)} · July ${fiscalStart}–June ${fiscalStart+1}<br>Records retrieved ${escape(new Date(recordsRetrievedAt).toLocaleString())}</p><div class="report-actions"><button class="secondary" id="download-csv">Download CSV</button><button class="secondary" id="print-report">Print / Save PDF</button></div><p class="small muted">Download covers the entire selected month, including pending attendance. It is a dated snapshot; search filters do not change it.</p><label for="report-search">Find a tutor or student</label><input id="report-search" type="search" placeholder="Search by name"><label class="check"><input id="needs-review" type="checkbox">Needs review</label><p id="review-loading" class="small" role="status">Loading review status…</p><div id="tutor-reports">${tutorIds.map(id=>{
    const data=summarize(totals.lessons.filter(l=>l.tutor_id===id),reportMonth);
    const name=people.find(p=>p.id===id)?.display_name||'Tutor';
    const studentIds=[...members.get(id)].sort((a,b)=>studentName(a).localeCompare(studentName(b)));
    return `<details class="tutor-report" data-tutor-id="${id}" data-review-status="loading" data-search="${escape([name,...studentIds.map(studentName)].join(' ').toLowerCase())}"><summary>${escape(name)}<small class="report-row-meta">${minutesLabel(data.teachingMinutes)} taught · ${data.studentCount} student${data.studentCount===1?'':'s'} · <span class="review-state">Loading review status…</span></small></summary><p class="small muted">${data.lessons.length?'':'No recorded sessions. This does not mean the tutor has confirmed the month. '}Open the review to check confirmation status.</p>${pendingDetails(data.lessons)}${achievementDetails(achievements.filter(a=>a.tutor_id===id&&!a.voided&&a.achieved_on.startsWith(reportMonth)))}${absenceDetails(absences.filter(a=>a.tutor_id===id&&!a.voided&&a.absence_date.startsWith(reportMonth)),false)}<button class="secondary check-review" data-tutor="${id}">View monthly review</button>${studentIds.map(studentId=>{
      const entries=data.lessons.flatMap(l=>l.attendance.filter(a=>a.student_id===studentId).map(a=>({id:l.id,date:l.lesson_date,minutes:a.minutes})));
      return `<details><summary>${escape(studentName(studentId))}<small class="report-row-meta">${entries.length} session${entries.length===1?'':'s'} · ${minutesLabel(entries.reduce((n,e)=>n+e.minutes,0))} attended</small></summary><ul class="record-list">${entries.map(e=>`<li><strong>${escape(e.date)}</strong><span>${minutesLabel(e.minutes)}</span><button class="quiet" data-edit-lesson="${e.id}">View / edit</button></li>`).join('')}</ul></details>`;
    }).join('')}</details>`;
  }).join('')||'<p class="empty">No tutor assignments or recorded lessons for this month.</p>'}</div><p id="report-no-match" class="empty" hidden>No tutor reports match these filters.</p><details id="program-totals"><summary>Program totals</summary><div class="metric-grid"><div class="metric"><span>Total hours taught</span><strong>${minutesLabel(totals.teachingMinutes)}</strong></div><div class="metric"><span>Distinct students attending</span><strong>${totals.studentCount}</strong></div><div class="metric"><span>Student attendance time</span><strong>${minutesLabel(totals.studentMinutes)}</strong></div></div><p id="review-counts" class="small"></p><div id="teaching-chart"></div><p class="small muted">Totals cover the whole month, regardless of search or review filter. Each shared lesson counts once toward teaching time. Student attendance adds each learner’s actual time.</p></details>`;
  const chartRows=tutorIds.map(id=>({name:people.find(p=>p.id===id)?.display_name||'Tutor',minutes:summarize(totals.lessons.filter(l=>l.tutor_id===id),reportMonth).teachingMinutes}));
  const chartMax=Math.max(1,...chartRows.map(row=>row.minutes));
  document.querySelector('#teaching-chart').innerHTML=`<h3>Teaching time by tutor</h3><p class="small muted">${monthLabel(reportMonth)} · Each shared lesson counts once.</p><ul class="hours-chart">${chartRows.map(row=>`<li><span>${escape(row.name)}</span><div class="hours-track" aria-hidden="true"><span style="width:${row.minutes/chartMax*100}%"></span></div><strong>${minutesLabel(row.minutes)}</strong></li>`).join('')}</ul>`;
  const printedMonth=reportMonth,printedRetrieval=recordsRetrievedAt;
  document.querySelector('#print-report').onclick=()=>{
    document.querySelector('#printable-report')?.remove();
    const printArea=document.createElement('section');printArea.id='printable-report';
    const heading=document.createElement('h1');heading.textContent=`LVAEP Demo · ${monthLabel(printedMonth)}`;printArea.append(heading);
    const note=document.createElement('p');note.textContent=`Fictional demonstration — not an official LVAEP service. Records retrieved ${printedRetrieval}. Exported ${new Date().toISOString()}. Entire month; search filters do not apply. This snapshot does not update automatically.`;printArea.append(note);
    for(const selector of ['#tutor-reports','#program-totals']){
      const copy=document.querySelector(selector).cloneNode(true);
      copy.querySelectorAll('button,input,select').forEach(element=>element.remove());
      copy.querySelectorAll('[hidden]').forEach(element=>element.hidden=false);
      if(copy.matches('details'))copy.open=true;
      copy.querySelectorAll('details').forEach(element=>element.open=true);
      copy.querySelectorAll('[id]').forEach(element=>element.removeAttribute('id'));copy.removeAttribute('id');
      printArea.append(copy);
    }
    document.body.append(printArea);
    const cleanup=()=>printArea.remove();window.addEventListener('afterprint',cleanup,{once:true});
    try{window.print();}catch{cleanup();alert('Printing could not open. Please use the CSV download.');}
  };
  const csvSnapshot=structuredClone({month:reportMonth,lessons,assignments,people,students,requests:studentRequests,achievements,absences,retrievedAt:recordsRetrievedAt});
  document.querySelector('#download-csv').onclick=()=>{
    const reviewStates=Object.fromEntries([...document.querySelectorAll('.tutor-report')].map(row=>[row.dataset.tutorId,row.querySelector('.review-state').textContent]));
    const csv=reportCsv({...csvSnapshot,reviewStates,exportedAt:new Date().toISOString()});
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`lvaep-report-${csvSnapshot.month}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  document.querySelectorAll('.check-review').forEach(button=>button.onclick=()=>reviewForm(button.dataset.tutor));
  const container=document.querySelector('#tutor-reports');
  const search=document.querySelector('#report-search'),needsReview=document.querySelector('#needs-review');
  const applyFilter=()=>{
    if(!container.isConnected)return;
    const query=search.value.trim().toLowerCase();let matches=0;
    container.querySelectorAll('.tutor-report').forEach(row=>{
      row.hidden=!row.dataset.search.includes(query)||(needsReview.checked&&['reviewed','not_open'].includes(row.dataset.reviewStatus));
      if(!row.hidden)matches++;
    });
    document.querySelector('#report-no-match').hidden=(!query&&!needsReview.checked)||matches>0;
  };
  search.oninput=applyFilter;needsReview.onchange=applyFilter;
  const month=reportMonth;
  const rows=[...container.querySelectorAll('.tutor-report')];
  const counts=document.querySelector('#review-counts'),loading=document.querySelector('#review-loading');
  // Bound requests to four at a time; stale month responses cannot update replacement DOM.
  let next=0;
  const worker=async()=>{
    while(next<rows.length){
      const row=rows[next++];
      try {
        const review=await checked(client.rpc('get_month_review',{p_tutor:row.dataset.tutorId,p_month:`${month}-01`}));
        if(!container.isConnected)return;
        if(!review||!['reviewed','updated','not_reviewed'].includes(review.status))throw Error('Unavailable');
        const state=!review.can_confirm?'not_open':review.status;
        row.dataset.reviewStatus=state;
        row.querySelector('.review-state').textContent={reviewed:'Reviewed',updated:'Updated since review',not_reviewed:'Not yet reviewed',not_open:'Review opens next month'}[state];
      }catch {
        if(!container.isConnected)return;
        row.dataset.reviewStatus='unknown';row.querySelector('.review-state').textContent='Review status unavailable';
      }
      applyFilter();
    }
  };
  Promise.all(Array.from({length:Math.min(4,rows.length)},worker)).then(()=>{
    if(!container.isConnected)return;
    const count=state=>rows.filter(row=>row.dataset.reviewStatus===state).length;
    counts.textContent=`${count('reviewed')} reviewed · ${count('not_reviewed')} not reviewed · ${count('updated')} updated since review · ${count('not_open')} not yet open · ${count('unknown')} unavailable`;
    loading.textContent=count('unknown')?'Some review statuses could not load. They remain visible under Needs review; refresh saved records to retry.':'';
  });
}

function dialog(title,body) {
  const el=document.querySelector('#form-dialog');
  el.innerHTML=`<div class="section-heading"><h2>${title}</h2><button class="quiet" id="close-dialog" aria-label="Close dialog">Close</button></div>${body}`;
  el.setAttribute('aria-label',title);el.showModal();
  document.querySelector('#close-dialog').onclick=()=>el.close();
  return el;
}
async function reviewForm(tutorId) {
  dialog('Monthly review',`<label for="review-month">Month</label><input id="review-month" type="month" value="${reportMonth}"><div id="review-body" aria-live="polite"></div>`);
  const container=document.querySelector('#review-body');
  let request=0;
  async function load() {
    const attempt=++request, month=document.querySelector('#review-month').value;
    if(!month)return;
    container.innerHTML='<p>Loading saved records…</p>';
    try {
      const data=await checked(client.rpc('get_month_review',{p_tutor:tutorId,p_month:`${month}-01`}));
      if(attempt!==request||!container.isConnected)return;
      if(!data?.snapshot)throw Error('Unavailable');
      const snapshot=data.snapshot;
      const pendingCount=new Set(snapshot.lessons.flatMap(l=>(l.pending||[]).map(a=>a.request_id))).size;
      const status={not_reviewed:'Not yet reviewed',reviewed:'Reviewed',updated:'Updated since review'}[data.status]||'Status unavailable';
      container.innerHTML=`<h3>${monthLabel(month)} · ${escape(status)}${pendingCount?` · ${pendingCount} unresolved request(s)`:""}</h3>${data.confirmed_at?`<p class="small">Last confirmed ${escape(new Date(data.confirmed_at).toLocaleString())}</p>`:''}${snapshot.students.map(id=>{
        const entries=snapshot.lessons.flatMap(l=>l.attendance.filter(a=>a.student_id===id).map(a=>({date:l.date,minutes:a.minutes})));
        return `<details><summary>${escape(studentName(id))}<small class="report-row-meta">${entries.length} sessions · ${minutesLabel(entries.reduce((n,e)=>n+e.minutes,0))}</small></summary>${entries.length?`<ul class="record-list">${entries.map(e=>`<li>${escape(e.date)} · ${minutesLabel(e.minutes)}</li>`).join('')}</ul>`:'<p>No recorded sessions.</p>'}</details>`;
      }).join('')||(snapshot.lessons.length?'':'<p>No assignments or lessons for this month.</p>')}${pendingDetails(snapshot.lessons)}${achievementDetails(snapshot.achievements||[])}${absenceDetails(snapshot.absences||[],false)}<p>Confirmation covers every student listed above, including students with no recorded sessions.</p>${tutorId===person.id&&isTutor()&&data.can_confirm&&(snapshot.students.length||snapshot.lessons.length)?`<button class="primary" id="confirm-review">${data.status==='reviewed'?'Review confirmed':`Confirm ${monthLabel(month)} review`}</button>`:''}${!data.can_confirm?'<p>Review opens on the 1st of the following month, New York time.</p>':''}<p id="review-status" role="alert"></p>`;
      const button=container.querySelector('#confirm-review');
      if(button){
        button.disabled=data.status==='reviewed';
        button.onclick=async()=>{
          button.disabled=true;
          try {
            await checked(client.rpc('confirm_month_review',{p_month:`${month}-01`,p_snapshot:snapshot}));
            if(attempt===request)await load();
          } catch {
            if(attempt!==request||!container.isConnected)return;
            container.querySelector('#review-status').textContent='Confirmation could not be verified, or records changed. Reload the review before trying again.';
            button.textContent='Reload review';button.disabled=false;button.onclick=load;
          }
        };
      }
    } catch {
      if(attempt!==request||!container.isConnected)return;
      container.innerHTML='<p>Monthly review is unavailable. Please check your connection and try again. No confirmation has been made here.</p><button class="secondary" id="retry-review">Try again</button>';
      container.querySelector('#retry-review').onclick=load;
    }
  }
  document.querySelector('#review-month').onchange=load;
  await load();
}
function logForm(initialDate=nyToday(),planned=null) {
  requestId=crypto.randomUUID();
  const el=dialog('Log a session',`<p class="muted">Record one lesson taught together. Only select students who attended.</p><form id="lesson-form"><div id="group-picker"></div><label for="lesson-date">Lesson date</label><input id="lesson-date" type="date" value="${initialDate}" required><label for="duration">Lesson duration, in minutes</label><input id="duration" type="number" min="1" step="1" value="${planned?.minutes||90}" required><fieldset><legend>Who attended?</legend><div id="participants"></div><div id="pending-participants"></div></fieldset><div id="duplicate-warning"></div><p id="save-status" role="status" aria-live="polite"></p><button class="primary full">Save session</button></form>`);
  const form=document.querySelector('#lesson-form');
  let savedGroups=[];
  client.from('tutor_groups').select('*').eq('archived',false).then(({data,error})=>{
    if(!form.isConnected||form.querySelector('#duration').disabled)return;
    if(error){document.querySelector('#group-picker').textContent='Saved groups are unavailable. You can still choose students below.';return;}
    savedGroups=data||[];
    if(!savedGroups.length)return;
    document.querySelector('#group-picker').innerHTML=`<label for="saved-group">Select a saved group (optional)</label><select id="saved-group"><option value="">Choose students individually</option>${savedGroups.map(g=>`<option value="${g.id}">${escape(g.name)}</option>`).join('')}</select><p id="group-hint" class="small muted"></p>`;
    document.querySelector('#saved-group').onchange=event=>{
      const group=savedGroups.find(g=>g.id===event.target.value);if(!group)return;
      const available=[...form.querySelectorAll('[name=student]')];
      available.forEach(input=>input.checked=group.student_ids.includes(input.value));
      const missing=group.student_ids.filter(id=>!available.some(input=>input.value===id)).length;
      document.querySelector('#group-hint').textContent=missing?'Some group members are not assigned for this date and were not selected.':'Change who attended below. This does not change your saved group.';
    };
  }).catch(()=>{});
  function choices() {
    const date=document.querySelector('#lesson-date').value;
    const assigned=new Set(assignments.filter(a=>a.tutor_id===person.id&&a.starts_on<=date&&(!a.ends_on||a.ends_on>=date)).map(a=>a.student_id));
    document.querySelector('#participants').innerHTML=students.filter(s=>assigned.has(s.id)).map(s=>`<div class="participant"><label class="check"><input type="checkbox" name="student" value="${s.id}"> ${escape(s.display_name)}</label><label class="partial">Minutes <input aria-label="Attendance minutes for ${escape(s.display_name)}" type="number" min="1" step="1" data-student="${s.id}" placeholder="Same as lesson"></label></div>`).join('')||'<p class="muted">No students are assigned for this date. Contact staff to check your assignments.</p>';
  }
  document.querySelector('#lesson-date').onchange=()=>{choices();const picker=document.querySelector('#saved-group');if(picker)picker.value='';}; choices();
  if(planned){
    form.querySelectorAll('[name=student]').forEach(input=>input.checked=planned.student_ids.includes(input.value));
    const missing=planned.student_ids.some(id=>!form.querySelector(`[name=student][value="${id}"]`));
    document.querySelector('#save-status').textContent=missing?'Some planned students are no longer assigned on this date. Check participants before saving.':'Check who attended and the actual minutes, then save. Nothing has been recorded yet.';
  }
  if(pendingReady){
    form.querySelector('#pending-participants').innerHTML=studentRequests.filter(r=>r.tutor_id===person.id&&r.status==='pending').map(r=>`<div class="participant"><label class="check"><input type="checkbox" name="pending-student" value="${r.id}"> ${escape(r.display_name)} — Waiting for staff</label><label class="partial">Minutes <input aria-label="Pending attendance minutes for ${escape(r.display_name)}" type="number" min="1" step="1" data-pending="${r.id}" placeholder="Same as lesson"></label></div>`).join('');
  }
  let pendingPayload=null;
  form.onsubmit=async event=>{
    event.preventDefault();
    const minutes=Number(document.querySelector('#duration').value);
    const selected=[...form.querySelectorAll('[name=student]:checked')].map(input=>({student_id:input.value,minutes:form.querySelector(`[data-student="${input.value}"]`).value===''?minutes:Number(form.querySelector(`[data-student="${input.value}"]`).value)}));
    const status=document.querySelector('#save-status');
    const selectedPending=[...form.querySelectorAll('[name=pending-student]:checked')].map(input=>({request_id:input.value,minutes:form.querySelector(`[data-pending="${input.value}"]`).value===''?minutes:Number(form.querySelector(`[data-pending="${input.value}"]`).value)}));
    if(!selected.length&&!selectedPending.length) {status.textContent='Select at least one student who attended.';return;}
    if([...selected,...selectedPending].some(s=>s.minutes>minutes||!Number.isInteger(s.minutes)||s.minutes<=0)) {status.textContent='Each attendance duration must be positive whole minutes, no more than the lesson duration.';return;}
    const payload={p_request:requestId,p_date:document.querySelector('#lesson-date').value,p_minutes:minutes,p_participants:selected,p_allow_additional:form.querySelector('#additional')?.checked||false};
    if(selectedPending.length)payload.p_pending=selectedPending;
    // Freeze the request after an uncertain response. Retrying sends the same logical save.
    if(pendingPayload) Object.assign(payload,pendingPayload);
    const button=form.querySelector('button[type=submit]')||form.querySelector('button.primary');
    button.disabled=true;status.textContent='Saving…';
    try {
      const result=await checked(client.rpc(planned?(payload.p_pending?'record_mixed_planned_lesson':'record_planned_lesson'):(payload.p_pending?'record_mixed_lesson':'record_lesson'),planned?{...payload,p_occurrence:planned.id,p_plan_version:plans.find(p=>p.id===planned.plan_id)?.version}:payload));
      pendingPayload=null;
      if(result.status==='duplicate_warning') {
        document.querySelector('#duplicate-warning').innerHTML=`<div class="notice"><strong>There is already attendance on this date.</strong><ul>${result.existing.map(l=>`<li>${escape(l.date)} · ${minutesLabel(l.minutes)}</li>`).join('')}</ul><label class="check"><input id="additional" type="checkbox"> This is another lesson. Save it separately.</label><p class="small">Or close this form to return to your recorded lessons.</p></div>`;
        status.textContent='Check the existing entries before adding another session.';button.disabled=false;return;
      }
      if(result.status!=='saved') throw new Error('Unexpected save result');
      status.textContent=payload.p_pending?'Lesson saved—student connection pending.':'Saved.';
      form.querySelectorAll('input,select').forEach(input=>input.disabled=true);
      button.textContent='Saved';
      // A refresh failure must never be reported as a failed save.
      try {await reloadData();el.close();home();if(selected.length>1&&!savedGroups.some(g=>g.student_ids.length===selected.length&&selected.every(s=>g.student_ids.includes(s.student_id))))groupForm(selected.map(s=>s.student_id),true);} catch {status.textContent='Saved. The record list could not refresh; close this form and reload the page.';}
    } catch(error) {
      if(!error.code) {
        pendingPayload=payload;
        form.querySelectorAll('input,select').forEach(input=>input.disabled=true);
        status.textContent='Not saved yet—check your connection. Retry will safely check this exact submission.';
      } else {status.textContent=error.message||'Could not save. Check the values and try again.';}
      button.textContent='Retry save';button.disabled=false;
    }
  };
}
function editLesson(id) {
  const lesson=lessons.find(l=>l.id===id);if(!lesson||lesson.voided)return;
  const eligibleStudents=students.filter(s=>lesson.attendance.some(a=>a.student_id===s.id)||assignments.some(a=>a.student_id===s.id&&a.tutor_id===lesson.tutor_id));
  const eligibleRequests=[...studentRequests.filter(r=>r.tutor_id===lesson.tutor_id&&(r.status==='pending'||lesson.pending_attendance?.some(a=>a.request_id===r.id))),...(lesson.pending_attendance||[]).filter(a=>!studentRequests.some(r=>r.id===a.request_id)).map(a=>({id:a.request_id,display_name:requestName(a.request_id)}))];
  const attendanceRow=(id,name,minutes,kind)=>`<div class="attendance-edit-row"><label class="check"><input type="checkbox" data-attending="${kind}:${id}" ${minutes!=null?'checked':''}> <span>${escape(name)}</span></label><label>Attendance minutes<input type="number" min="1" step="1" value="${minutes??lesson.minutes}" data-edit-${kind}="${id}" ${minutes==null?'disabled':''} required></label></div>`;
  dialog('Correct a recorded lesson',`<p>Changes update the saved record and its monthly review status. Previous values stay in the change history.</p><form id="edit-lesson-form"><label for="edit-date">Lesson date</label><input id="edit-date" type="date" value="${lesson.lesson_date}" required><label for="edit-minutes">Teaching minutes</label><input id="edit-minutes" type="number" min="1" step="1" value="${lesson.minutes}" required><fieldset><legend>Who attended?</legend><p class="small muted">Select only the students who attended. Changes apply to this lesson only, not saved groups. Students must be assigned to this tutor on the lesson date.</p>${eligibleStudents.map(s=>attendanceRow(s.id,s.display_name,lesson.attendance.find(a=>a.student_id===s.id)?.minutes,'student')).join('')}${eligibleRequests.map(r=>attendanceRow(r.id,`${r.display_name} — ${requestStatus(r.id)}`,lesson.pending_attendance?.find(a=>a.request_id===r.id)?.minutes,'pending')).join('')}</fieldset><label class="check"><input id="void-lesson" type="checkbox">Void this mistaken lesson instead of editing it. Exclude its hours from totals and retain its history.</label><div id="edit-warning"></div><p id="edit-status" role="alert"></p><button class="primary">Save correction</button></form>`);
  const form=document.querySelector('#edit-lesson-form');let pending=null;
  const updateInputs=()=>{const voided=document.querySelector('#void-lesson').checked;form.querySelectorAll('input:not(#void-lesson)').forEach(input=>{const participant=input.dataset.editStudent||input.dataset.editPending;const kind=input.dataset.editStudent?'student':'pending';input.disabled=voided||(!!participant&&!form.querySelector(`[data-attending="${kind}:${participant}"]`).checked);});};
  form.querySelectorAll('[data-attending],#void-lesson').forEach(input=>input.onchange=updateInputs);
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button'),status=document.querySelector('#edit-status');if(button.disabled)return;
    const voided=document.querySelector('#void-lesson').checked;
    const payload=pending||{p_id:id,p_version:lesson.version,p_date:voided?lesson.lesson_date:document.querySelector('#edit-date').value,p_minutes:voided?lesson.minutes:Number(document.querySelector('#edit-minutes').value),p_participants:voided?lesson.attendance.map(a=>({student_id:a.student_id,minutes:a.minutes})):[...form.querySelectorAll('[data-edit-student]')].filter(input=>form.querySelector(`[data-attending="student:${input.dataset.editStudent}"]`).checked).map(input=>({student_id:input.dataset.editStudent,minutes:Number(input.value)})),p_void:voided,p_allow_additional:form.querySelector('#edit-additional')?.checked||false};
    if(!pending&&pendingReady)payload.p_pending=voided?(lesson.pending_attendance||[]).map(a=>({request_id:a.request_id,minutes:a.minutes})):[...form.querySelectorAll('[data-edit-pending]')].filter(input=>form.querySelector(`[data-attending="pending:${input.dataset.editPending}"]`).checked).map(input=>({request_id:input.dataset.editPending,minutes:Number(input.value)}));
    if(!payload.p_participants.length&&!payload.p_pending?.length){status.textContent='Choose at least one attendee, or void the mistaken lesson.';return;}
    if([...payload.p_participants,...(payload.p_pending||[])].some(a=>!Number.isInteger(a.minutes)||a.minutes<=0||a.minutes>payload.p_minutes)){status.textContent='Student attendance must be positive whole minutes and no longer than the lesson.';return;}
    button.disabled=true;status.textContent='Saving correction…';
    try {
      const result=await checked(client.rpc(payload.p_pending?'correct_mixed_lesson':'correct_lesson',payload));
      if(result.status==='duplicate_warning'){
        pending=null;document.querySelector('#edit-warning').innerHTML=`<p>Other attendance is already recorded on this date:</p><ul>${result.existing.map(l=>`<li>${escape(l.date)} · ${minutesLabel(l.minutes)}</li>`).join('')}</ul><label class="check"><input id="edit-additional" type="checkbox">This is a separate lesson on that date.</label>`;status.textContent='Check the existing entries before saving.';button.disabled=false;return;
      }
      if(result.status!=='saved')throw Error('Unknown result');
      status.textContent='Saved.';form.querySelectorAll('input').forEach(input=>input.disabled=true);button.textContent='Saved';
      try{await reloadData();document.querySelector('#form-dialog').close();home();}catch{status.textContent='Correction saved. Reload the page to refresh the record list.';}
    }catch(error){
      if(!error.code){pending=payload;form.querySelectorAll('input').forEach(input=>input.disabled=true);status.textContent='Save not confirmed. Retry checks this exact correction.';button.disabled=false;button.textContent='Retry correction';}
      else{status.textContent=error.message||'Correction could not be saved.';button.disabled=error.code==='40001';if(button.disabled)status.textContent+=' Close and refresh the page before editing again.';}
    }
  };
}
async function staffRequests() {
  dialog('Missing-student requests','<p id="staff-requests-status" role="status">Loading requests…</p>');
  const status=document.querySelector('#staff-requests-status');
  try {
    const requests=await allRows(()=>client.from('student_requests').select('*').order('created_at').order('id'));
    if(!status.isConnected)return;
    status.innerHTML=requests.length?`<p>Review the name and context before connecting a student. Choose a request to inspect its original lesson dates and connect a verified student.</p><ul class="record-list">${requests.map(r=>`<li><div><strong>${escape(r.display_name)}</strong><span>${escape(people.find(p=>p.id===r.tutor_id)?.display_name||'Tutor')} · ${escape(r.status)}</span><p>${escape(r.context)}</p>${r.staff_note?`<p>Staff note: ${escape(r.staff_note)}</p>`:''}${pendingReady?`${r.status==='pending'?`<button class="secondary" data-connect-request="${r.id}">Review connection</button>`:''}<button class="quiet" data-change-request="${r.id}">${r.status==='resolved'?'Undo wrong connection':r.status==='rejected'?'Reopen request':'Reject request'}</button>`:''}</div></li>`).join('')}</ul>`:'No missing-student requests.';
    status.querySelectorAll('[data-change-request]').forEach(button=>button.onclick=()=>changeRequestForm(requests.find(r=>r.id===button.dataset.changeRequest)));
    status.querySelectorAll('[data-connect-request]').forEach(button=>button.onclick=()=>connectRequest(requests.find(r=>r.id===button.dataset.connectRequest)));
  }catch {if(status.isConnected)status.textContent='Requests could not load. This does not mean the queue is empty. Check the connection or database setup.';}
}
function changeRequestForm(request) {
  const action=request.status==='resolved'?'disconnect':request.status==='rejected'?'reopen':'reject';
  const title={disconnect:'Undo wrong connection',reopen:'Reopen request',reject:'Reject request'}[action];
  const explanation={disconnect:'Only attendance linked through this request moves back to unresolved attendance. Current minutes and original dates stay intact. Teaching time does not change. Affected monthly records will need review again. Existing assignments are not changed.',reopen:'This request becomes available for future lessons and staff connection again. Previous records are preserved.',reject:'Teaching time and attendance history are preserved. This student’s attendance remains outside official totals. Tutors cannot add new lessons against this request until staff reopens it.'}[action];
  dialog(title,`<p><strong>${escape(request.display_name)}</strong></p><p>${explanation}</p><form id="request-change-form"><label for="request-reason">Brief reason (visible to the tutor)</label><textarea id="request-reason" maxlength="1000" required></textarea><p id="request-change-status" role="status"></p><button class="primary">${title}</button></form>`);
  const form=document.querySelector('#request-change-form');let frozen=null;
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('#request-change-status');if(button.disabled)return;
    const payload=frozen||{p_id:request.id,p_version:request.version,p_action:action,p_reason:form.querySelector('textarea').value.trim()};
    if(!payload.p_reason){status.textContent='Give a brief reason.';return;}
    button.disabled=true;status.textContent='Saving…';
    try{
      await checked(client.rpc('change_student_request',payload));status.textContent='Saved. Teaching time is unchanged.';button.textContent='Saved';form.querySelector('textarea').disabled=true;
      try{await reloadData();}catch{status.textContent='Saved. Reload the page to refresh records.';}
    }catch(error){
      if(!error.code){frozen=payload;form.querySelector('textarea').disabled=true;status.textContent='Save not confirmed. Retry checks the same action.';button.textContent='Retry action';}
      else status.textContent=error.message||'Could not save the request change.';
      button.disabled=error.code==='40001';
    }
  };
}
function connectRequest(request) {
  const linked=lessons.filter(l=>(l.pending_attendance||[]).some(a=>a.request_id===request.id));
  dialog('Connect a student',`<p><strong>${escape(request.display_name)}</strong> · ${escape(people.find(p=>p.id===request.tutor_id)?.display_name||'Tutor')}</p><p>${escape(request.context)}</p><p>Verify the person using their context and assignment. A matching name alone is not enough.</p>${linked.length?`<ul>${linked.map(l=>`<li>${escape(l.lesson_date)} · ${minutesLabel(l.pending_attendance.find(a=>a.request_id===request.id).minutes)} attendance${l.voided?' · Voided':''}</li>`).join('')}</ul>`:'<p>No linked attendance yet.</p>'}<form id="connect-request-form"><label for="connect-student">Existing student</label><select id="connect-student" required><option value="">Choose the verified student</option>${students.map(s=>`<option value="${s.id}">${escape(s.display_name)}${s.archived?' (archived)':''}</option>`).join('')}</select><p class="small">If the student or assignment is missing, close this form and use Add student / Assign tutor in the roster first. The assignment must cover every original lesson date.</p><label class="check"><input id="verified-match" type="checkbox" required>I verified this is the correct student.</label><p id="connect-status" role="status"></p><button class="primary">Connect attendance</button></form>`);
  const form=document.querySelector('#connect-request-form');let frozen=null;
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('#connect-status');if(button.disabled)return;
    if(!form.querySelector('#verified-match').checked)return;
    const payload=frozen||{p_request:request.id,p_student:form.querySelector('#connect-student').value,p_version:request.version};
    button.disabled=true;status.textContent='Connecting…';
    try{
      await checked(client.rpc('resolve_student_request',payload));
      frozen=null;status.textContent='Connected. Teaching time and original lesson dates are unchanged.';
      form.querySelectorAll('input,select').forEach(input=>input.disabled=true);button.textContent='Connected';
      try{await reloadData();}catch{status.textContent='Connected. Reload the page to refresh saved records.';}
    }catch(error){
      if(!error.code){frozen=payload;form.querySelectorAll('input,select').forEach(input=>input.disabled=true);status.textContent='Connection not confirmed. Retry checks the same student.';button.textContent='Retry connection';}
      else status.textContent=error.message||'Connection could not be saved.';
      button.disabled=false;
    }
  };
}
async function missingStudentForm() {
  dialog('Missing students', '<p id="request-loading" role="status">Loading your existing requests…</p>');
  const loading=document.querySelector('#request-loading');
  let requests;
  try {requests=await allRows(()=>client.from('student_requests').select('*').eq('tutor_id',person.id).order('created_at').order('id'));}
  catch {if(loading.isConnected)loading.textContent='Requests could not load. Check your connection or ask the administrator to finish setup. No new request was created.';return;}
  if(!loading.isConnected)return;
  dialog('Missing students',`<p>Check your existing requests first. Each request can be reused; matching names do not necessarily mean the same person.</p>${requests.length?`<ul class="record-list">${requests.map(r=>`<li><div><strong>${escape(r.display_name)}</strong><span>${r.status==='pending'?'Waiting for staff':escape(r.status)}</span>${r.staff_note?`<p>Staff note: ${escape(r.staff_note)}</p>`:''}</div></li>`).join('')}</ul>`:'<p>No requests yet.</p>'}<p class="small">Submitting this request does not record attendance. Once saved, select the student marked Waiting for staff when logging a lesson.</p><form id="missing-form"><label for="missing-name">Student name</label><input id="missing-name" maxlength="120" required><label for="missing-context">Brief context (optional)</label><textarea id="missing-context" maxlength="1000" placeholder="For example, where you met. Do not include sensitive personal details."></textarea><p id="missing-status" role="alert"></p><button class="primary">Send request to staff</button></form>`);
  const id=crypto.randomUUID(),form=document.querySelector('#missing-form'),button=form.querySelector('button'),status=document.querySelector('#missing-status');
  let pending;
  form.onsubmit=async event=>{
    event.preventDefault();if(button.disabled)return;
    const payload=pending||{p_id:id,p_name:document.querySelector('#missing-name').value.trim(),p_context:document.querySelector('#missing-context').value.trim()};
    if(!payload.p_name){status.textContent='Enter the student name.';return;}
    button.disabled=true;status.textContent='Saving request…';
    try {
      const result=await checked(client.rpc('request_missing_student',payload));
      if(!result?.id)throw Error('Unconfirmed');
      studentRequests=[...studentRequests.filter(request=>request.id!==result.id),result];
      form.querySelectorAll('input,textarea').forEach(input=>input.disabled=true);
      status.textContent='Request saved—waiting for staff. No email or attendance was sent.';button.textContent='Request saved';
    }catch(error){
      if(!error.code){pending=payload;form.querySelectorAll('input,textarea').forEach(input=>input.disabled=true);status.textContent='Save not confirmed. Retry checks the same request without creating another.';}
      else status.textContent=error.message||'Could not save request.';
      button.disabled=false;button.textContent='Retry request';
    }
  };
}
function plannedList(items) {
  return items.length?`<h3>Planned lessons</h3><ul class="record-list">${items.map(o=>`<li><div><strong>${o.student_ids.map(id=>escape(studentName(id))).join(', ')}</strong><span>${escape(o.lesson_date)} · ${o.lesson_id?'Attendance recorded':o.canceled?'Canceled':'Planned'} · ${minutesLabel(o.minutes)}</span></div>${o.lesson_id?`<button class="quiet" data-edit-lesson="${o.lesson_id}">View / edit attendance</button>`:o.canceled?'':`${'lesson_id' in o?`<button class="secondary" data-held-plan="${o.id}">Held as planned — log ${minutesLabel(o.minutes)}</button>`:''}<button class="quiet" data-edit-plan="${o.id}">Change plan</button>`}</li>`).join('')}</ul>`:'';
}
function editPlan(id) {
  const occurrence=occurrences.find(o=>o.id===id),plan=plans.find(p=>p.id===occurrence?.plan_id);
  if(!occurrence||!plan)return;
  dialog('Change planned lesson',`<p>Saved attendance will not change. Moving this and future lessons shifts their dates by the same number of days.</p><form id="edit-plan"><label for="plan-scope">Apply to</label><select id="plan-scope"><option value="one">This lesson only</option><option value="future">This and future lessons</option></select><label for="occurrence-date">Lesson date</label><input id="occurrence-date" type="date" value="${occurrence.lesson_date}" required><label for="occurrence-minutes">Usual duration, in minutes</label><input id="occurrence-minutes" type="number" min="1" step="1" value="${occurrence.minutes}" required><p>Students: ${occurrence.student_ids.map(id=>escape(studentName(id))).join(', ')}</p><label class="check"><input id="cancel-plan" type="checkbox">Cancel the selected planned lesson(s)</label><p id="change-plan-status" role="alert"></p><button class="primary">Save plan changes</button></form>`);
  const form=document.querySelector('#edit-plan'),button=form.querySelector('button'),status=document.querySelector('#change-plan-status');
  form.onsubmit=async event=>{
    event.preventDefault();if(button.disabled)return;
    const payload={p_occurrence:id,p_scope:document.querySelector('#plan-scope').value,p_new_date:document.querySelector('#occurrence-date').value,p_minutes:Number(document.querySelector('#occurrence-minutes').value),p_students:occurrence.student_ids,p_cancel:document.querySelector('#cancel-plan').checked,p_version:plan.version};
    button.disabled=true;status.textContent='Saving…';
    let saved=false;
    try {
      await checked(client.rpc('change_plan_occurrence',payload));saved=true;
      await reloadData();home();
    } catch(error) {
      status.textContent=saved?'Changes saved, but the calendar could not refresh. Reload before editing again.':!error.code?'Save not confirmed. Reload and check the plan before editing again.':error.message;
      // Do not repeat a potentially applied date shift after an uncertain response.
      if(saved||!error.code)form.querySelectorAll('input,select').forEach(input=>input.disabled=true);
      else button.disabled=false;
    }
  };
}
function planForm() {
  const id=crypto.randomUUID();
  const assigned=new Set(assignments.filter(a=>a.tutor_id===person.id).map(a=>a.student_id));
  dialog('Plan weekly lessons',`<p>Repeat weekly on the weekday of your first lesson, through the end date. Plans do not count as attendance.</p><form id="plan-form"><label for="plan-start">First lesson</label><input id="plan-start" type="date" value="${nyToday()}" required><label for="plan-end">Repeat through</label><input id="plan-end" type="date" value="${nyToday()}" required><label for="plan-minutes">Usual duration, in minutes</label><input id="plan-minutes" type="number" min="1" step="1" value="90" required><fieldset><legend>Students</legend>${students.filter(s=>assigned.has(s.id)&&!s.archived).map(s=>`<label class="check"><input type="checkbox" name="plan-student" value="${s.id}">${escape(s.display_name)}</label>`).join('')}</fieldset><p id="plan-preview" class="small"></p><p id="plan-status" role="alert"></p><button class="primary">Save plan</button></form>`);
  const form=document.querySelector('#plan-form');
  let pending=null;
  const preview=()=>{
    const start=document.querySelector('#plan-start').value,end=document.querySelector('#plan-end').value;
    const count=Math.floor((Date.parse(`${end}T12:00:00Z`)-Date.parse(`${start}T12:00:00Z`))/604800000)+1;
    document.querySelector('#plan-preview').textContent=Number.isFinite(count)&&count>0?`${count} planned lesson${count===1?'':'s'}. Each lesson will still need attendance confirmation.`:'Choose an end date on or after the first lesson.';
  };
  form.oninput=preview;preview();
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button'),status=document.querySelector('#plan-status');
    if(button.disabled)return;
    const payload=pending||{p_id:id,p_start:document.querySelector('#plan-start').value,p_end:document.querySelector('#plan-end').value,p_minutes:Number(document.querySelector('#plan-minutes').value),p_students:[...form.querySelectorAll('[name=plan-student]:checked')].map(input=>input.value)};
    if(!payload.p_students.length||!payload.p_start||payload.p_end<payload.p_start||!Number.isInteger(payload.p_minutes)||payload.p_minutes<=0){status.textContent='Select students, a valid date range, and a positive whole-minute duration.';return;}
    button.disabled=true;status.textContent='Saving plan…';
    try {
      const result=await checked(client.rpc('create_weekly_plan',payload));
      if(!result?.id)throw Error('Unconfirmed');
      form.querySelectorAll('input').forEach(input=>input.disabled=true);
      status.textContent='Plan saved. No attendance has been recorded.';button.textContent='Saved';
      try {await reloadData();home();} catch {status.textContent='Plan saved, but the calendar could not refresh. Reload to see it.';}
    }catch(error){
      if(!error.code){pending=payload;form.querySelectorAll('input').forEach(input=>input.disabled=true);status.textContent='Plan save not confirmed. Retry will check the same plan without creating another.';}
      else status.textContent=error.message||'Could not save the plan. Check assignments and try again.';
      button.disabled=false;button.textContent='Retry save';
    }
  };
}
async function manageGroups() {
  dialog('My groups','<p id="groups-loading" role="status">Loading saved groups…</p>');
  const loading=document.querySelector('#groups-loading');
  try{
    const groups=await allRows(()=>client.from('tutor_groups').select('*').order('name').order('id'));
    if(!loading.isConnected)return;
    loading.innerHTML=groups.length?`<p>Groups are selection shortcuts. Editing them never changes recorded attendance or existing plans.</p><ul class="record-list">${groups.map(g=>`<li><div><strong>${escape(g.name)}</strong><span>${g.archived?'Archived':'Active'} · ${g.student_ids.map(id=>escape(studentName(id))).join(', ')}</span></div><button class="quiet" data-group-id="${g.id}">Edit / restore</button></li>`).join('')}</ul>`:'No saved groups yet. Use Create a student group to add one.';
    loading.querySelectorAll('[data-group-id]').forEach(button=>button.onclick=()=>{const group=groups.find(g=>g.id===button.dataset.groupId);groupForm(group.student_ids,false,group);});
  }catch{if(loading.isConnected)loading.textContent='Groups could not load. Please retry; this does not mean your groups are missing.';}
}
function groupForm(initial=[],afterLesson=false,group=null) {
  const id=group?.id||crypto.randomUUID();let frozen=null;
  const assigned=new Set(assignments.filter(a=>a.tutor_id===person.id).map(a=>a.student_id));
  dialog(afterLesson?'Lesson saved · Save these students as a group?':group?'Edit student group':'Create a student group',`<p>${afterLesson?'Your lesson is already saved. This optional step only saves a shortcut.':'A group selects students together; it never records attendance automatically.'}</p><form id="group-form"><label for="group-name">Group name</label><input id="group-name" maxlength="80" value="${escape(group?.name||'')}" required><fieldset><legend>Students</legend>${students.filter(s=>assigned.has(s.id)).map(s=>`<label class="check"><input type="checkbox" name="member" value="${s.id}" ${initial.includes(s.id)?'checked':''}>${escape(s.display_name)}</label>`).join('')}</fieldset>${group?`<label class="check"><input id="group-archived" type="checkbox" ${group.archived?'checked':''}>Archive this group</label><p class="small">Archived groups are hidden from session shortcuts. Restore by unchecking. Changes never alter saved lessons or plans.</p>`:""}<p id="group-status" role="alert"></p><button class="primary">Save group</button> <button type="button" class="quiet" id="skip-group">${afterLesson?'Skip':'Cancel'}</button></form>`);
  document.querySelector('#skip-group').onclick=()=>document.querySelector('#form-dialog').close();
  document.querySelector('#group-form').onsubmit=async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');
    if(button.disabled)return;
    const members=[...form.querySelectorAll('[name=member]:checked')].map(input=>input.value);
    if(!members.length){document.querySelector('#group-status').textContent='Select at least one student.';return;}
    const payload=frozen||{p_id:id,p_name:document.querySelector('#group-name').value,p_students:members,p_archived:form.querySelector('#group-archived')?.checked||false,p_version:group?.version||0};
    button.disabled=true;
    try {
      await checked(client.rpc('save_tutor_group',payload));
      document.querySelector('#form-dialog').close();
    } catch(error) {
      if(!error.code){frozen=payload;form.querySelectorAll('input').forEach(input=>input.disabled=true);}
      document.querySelector('#group-status').textContent=afterLesson?'Your lesson is saved. The group could not be saved; retry or skip.':'The group could not be saved. The database update may be pending, or the connection failed. Retry when available.';
      button.disabled=false;
    }
  };
}
function studentForm(student=null) {
  const id=student?.id||crypto.randomUUID();let frozen=null;
  dialog(student?'Edit student':'Add student',`<form id="student-form"><label for="student-name">Student name</label><input id="student-name" maxlength="120" value="${escape(student?.display_name||'')}" required><p class="small muted">Use fictional information. Matching names remain separate people.</p>${student?`<label class="check"><input id="student-archived" type="checkbox" ${student.archived?'checked':''}>Archive this student</label><p class="small">Archiving preserves lessons and existing assignments, and prevents new assignments. Uncheck to restore the student. Ending a tutor’s assignment is a separate action.</p>`:''}<p id="form-status" role="alert"></p><button class="primary">Save student</button></form>`);
  const form=document.querySelector('#student-form');
  form.onsubmit=async event=>{
    event.preventDefault();const button=form.querySelector('button'),status=form.querySelector('#form-status');if(button.disabled)return;
    const payload=frozen||{p_id:id,p_name:form.querySelector('#student-name').value.trim(),p_archived:form.querySelector('#student-archived')?.checked||false,p_version:student?.version||0};
    if(!payload.p_name){status.textContent='Enter a student name.';return;}
    button.disabled=true;status.textContent='Saving…';
    try{
      await checked(client.rpc('save_student',payload));
      status.textContent='Student saved.';button.textContent='Saved';form.querySelectorAll('input').forEach(input=>input.disabled=true);
      try{await reloadData();home();}catch{status.textContent='Student saved. Reload to refresh the roster.';}
    }catch(error){
      if(!error.code){frozen=payload;form.querySelectorAll('input').forEach(input=>input.disabled=true);status.textContent='Save not confirmed. Retry checks the same change.';button.textContent='Retry save';}
      else status.textContent=error.message||'Could not save the student.';
      button.disabled=error.code==='40001';if(button.disabled)status.textContent+=' Close and refresh before editing again.';
    }
  };
}
async function historyForm() {
  dialog('Change history','<p>A timeline of saved changes. Open an entry to see what changed.</p><div id="history-records"></div><p id="history-status" role="status"></p><button class="secondary" id="history-more">Load changes</button>');
  const container=document.querySelector('#history-records'),status=document.querySelector('#history-status'),button=document.querySelector('#history-more');let offset=0;
  const labels={actor_id:'Changed by',tutor_id:'Tutor',student_id:'Student',lesson_id:'Lesson reference',request_id:'Request reference',minutes:'Minutes',lesson_date:'Lesson date',display_name:'Name',starts_on:'Start date',ends_on:'End date',archived:'Archived',voided:'Voided',confirmed_at:'Confirmed at',reviewed_snapshot:'Reviewed records',before_value:'Original values',after_value:'New values'};
  function valueHtml(value,key=''){
    if(value===null||value===undefined)return '<span class="muted">None</span>';
    if(Array.isArray(value))return value.length?`<ul>${value.map(v=>`<li>${valueHtml(v,key)}</li>`).join('')}</ul>`:'None';
    if(typeof value==='object')return `<dl class="history-values">${Object.entries(value).map(([k,v])=>`<dt>${escape(labels[k]||k.replaceAll('_',' '))}</dt><dd>${valueHtml(v,k)}</dd>`).join('')}</dl>`;
    const name=['actor_id','tutor_id'].includes(key)?people.find(p=>p.id===value)?.display_name:key==='student_id'?students.find(s=>s.id===value)?.display_name:null;
    return escape(name||value);
  }
  button.onclick=async()=>{
    button.disabled=true;status.textContent='Loading changes…';
    try{
      const rows=await checked(client.from('audit_events').select('*').order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+49));
      if(!container.isConnected)return;
      for(const row of rows){
        const entry=document.createElement('details');
        const before=row.before_value||{},after=row.after_value||{};
        const keys=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!['id','version','created_at','actor_id','tutor_id','student_id','reviewed_snapshot'].includes(k)&&JSON.stringify(before[k])!==JSON.stringify(after[k]));
        const changes=keys.map(k=>`<li><strong>${escape(labels[k]||k.replaceAll('_',' '))}</strong>: ${valueHtml(before[k],k)} → ${valueHtml(after[k],k)}</li>`).join('');
        entry.innerHTML=`<summary>${escape(row.entity.replaceAll('_',' '))} · ${escape(row.action.replaceAll('_',' '))}<small class="report-row-meta">${escape(new Date(row.created_at).toLocaleString())} · ${escape(people.find(p=>p.id===row.actor_id)?.display_name||'System / unavailable actor')}</small></summary><ul class="change-summary">${changes||'<li>Record saved. Open full details for the retained record.</li>'}</ul><details><summary>Full record details</summary><p class="small">Record reference: ${escape(row.entity_id)}</p><h3>Before</h3>${valueHtml(row.before_value)}<h3>After</h3>${valueHtml(row.after_value)}</details>`;
        container.append(entry);
      }
      offset+=rows.length;status.textContent=offset?`${offset} changes loaded.`:'No changes recorded.';button.hidden=rows.length<50;button.textContent='Load older changes';button.disabled=false;
    }catch{if(container.isConnected){status.textContent='History could not load. This does not mean there are no changes. Try again.';button.disabled=false;}}
  };
  await button.onclick();
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

const achievementLabel=code=>achievementTypes.find(type=>type.code===code)?.label||'Achievement';
function achievementDetails(items) {
  if(!items.length)return '';
  return `<details class="achievement-details"><summary>${items.length} achievement update${items.length===1?'':'s'}</summary><ul class="record-list">${items.map(a=>`<li><div><strong>${escape(studentName(a.student_id))} · ${escape(achievementLabel(a.code))}</strong><span>${escape(a.achieved_on||a.date)}</span>${a.notes?`<p>${escape(a.notes)}</p>`:''}</div></li>`).join('')}</ul></details>`;
}
function studentProfiles() {
  dialog('My students',`${students.length?`<ul class="record-list">${students.map(s=>`<li><strong>${escape(s.display_name)}</strong><button class="secondary profile-choice" data-id="${s.id}">Open profile</button></li>`).join('')}</ul>`:'<p>No assigned students.</p>'}`);
  document.querySelectorAll('.profile-choice').forEach(button=>button.onclick=()=>studentProfile(button.dataset.id));
}
function studentProfile(studentId) {
  const items=achievements.filter(a=>a.student_id===studentId).sort((a,b)=>b.achieved_on.localeCompare(a.achieved_on));
  dialog('Student profile',`<h3>${escape(studentName(studentId))}</h3><h4>Tutoring assignments</h4>${assignmentDetails(studentId)}${absenceDetails(absences.filter(a=>a.student_id===studentId))}${programSettings&&(isStaff()||programSettings.tutor_absence_entry)?'<button class="secondary" id="add-absence">Record absence / holiday</button>':''}<h4>Achievements</h4><p>Record achievements when they happen. They are optional and do not add attendance time.</p>${achievementsReady?`<button class="primary" id="add-achievement">Add achievement</button>${items.length?`<ul class="record-list">${items.map(a=>`<li><div><strong>${escape(achievementLabel(a.code))}</strong><span>${escape(a.achieved_on)}${a.voided?' · Removed':''}${isStaff()?` · ${escape(people.find(p=>p.id===a.tutor_id)?.display_name||'Tutor')}`:''}</span>${a.notes?`<p>${escape(a.notes)}</p>`:''}</div><button class="quiet edit-achievement" data-id="${a.id}">${a.voided?'View / restore':'Edit'}</button></li>`).join('')}</ul>`:'<p>No achievements recorded yet.</p>'}`:'<p role="status">Achievement setup is being installed. No achievements can be saved yet.</p>'}`);
  document.querySelectorAll('[data-tutoring-details]').forEach(button=>button.onclick=()=>tutoringDetailsForm(assignments.find(a=>a.id===button.dataset.tutoringDetails)));
  document.querySelectorAll('[data-stop-assignment]').forEach(button=>button.onclick=()=>endAssignmentForm(assignments.find(a=>a.id===button.dataset.stopAssignment)));
  document.querySelector('#add-absence')?.addEventListener('click',()=>absenceForm(studentId));
  document.querySelectorAll('[data-edit-absence]').forEach(button=>button.onclick=()=>absenceForm(studentId,absences.find(a=>a.id===button.dataset.editAbsence)));
  document.querySelector('#add-achievement')?.addEventListener('click',()=>achievementForm(studentId));
  document.querySelectorAll('.edit-achievement').forEach(button=>button.onclick=()=>achievementForm(studentId,achievements.find(a=>a.id===button.dataset.id)));
}
function achievementForm(studentId,existing=null) {
  const id=existing?.id||crypto.randomUUID();
  const assignedTutors=[...new Set(assignments.filter(a=>a.student_id===studentId).map(a=>a.tutor_id))];
  const categories=[...new Set(achievementTypes.map(a=>a.category))];
  dialog(existing?'Edit achievement':'Add achievement',`<p><strong>${escape(studentName(studentId))}</strong></p><form id="achievement-form">${isStaff()&&!existing?`<label for="achievement-tutor">Tutor</label><select id="achievement-tutor" required><option value="">Choose assigned tutor</option>${assignedTutors.map(id=>`<option value="${id}">${escape(people.find(p=>p.id===id)?.display_name||'Tutor')}</option>`).join('')}</select>`:''}<label for="achievement-type">Achievement</label><select id="achievement-type" required><option value="">Choose an achievement</option>${categories.map(category=>`<optgroup label="${escape(category)}">${achievementTypes.filter(a=>a.category===category).map(a=>`<option value="${a.code}" ${existing?.code===a.code?'selected':''}>${escape(a.label)}</option>`).join('')}</optgroup>`).join('')}</select><label for="achievement-date">Achieved date</label><input type="date" id="achievement-date" value="${existing?.achieved_on||nyToday()}" required><label for="achievement-notes">Brief details (required for Other)</label><textarea id="achievement-notes" maxlength="1000">${escape(existing?.notes||'')}</textarea><p class="small">Use fictional details for this demonstration. The achieved date must fall within this tutor’s assignment.</p>${existing?`<label class="check"><input type="checkbox" id="achievement-removed" ${existing.voided?'checked':''}>Remove from reports (history is kept)</label>`:''}<div id="achievement-duplicate"></div><p id="achievement-status" role="status"></p><button class="primary">Save achievement</button></form>`);
  const form=document.querySelector('#achievement-form'),button=form.querySelector('button'),status=document.querySelector('#achievement-status');let frozen=null;
  form.onsubmit=async event=>{
    event.preventDefault();if(button.disabled)return;
    const payload=frozen||{p_id:id,p_tutor:existing?.tutor_id||(isStaff()?form.querySelector('#achievement-tutor').value:person.id),p_student:studentId,p_code:form.querySelector('#achievement-type').value,p_date:form.querySelector('#achievement-date').value,p_notes:form.querySelector('#achievement-notes').value.trim(),p_voided:form.querySelector('#achievement-removed')?.checked||false,p_version:existing?.version||0,p_allow_duplicate:form.querySelector('#achievement-additional')?.checked||false};
    if(payload.p_code==='other_1'&&!payload.p_notes){status.textContent='Describe the Other achievement.';return;}
    button.disabled=true;status.textContent='Saving…';
    try{
      const result=await checked(client.rpc('save_achievement',payload));
      if(result?.status==='duplicate_warning'){
        form.querySelector('#achievement-duplicate').innerHTML='<div class="notice"><p>This tutor already recorded this achievement for this student on this date.</p><label class="check"><input type="checkbox" id="achievement-additional">This is a separate achievement. Save another entry.</label></div>';
        status.textContent='Check the existing achievement before adding another.';button.disabled=false;return;
      }
      if(result?.status!=='saved'||!result.achievement?.id)throw Error('Unconfirmed');
      achievements=[...achievements.filter(a=>a.id!==result.achievement.id),result.achievement];
      status.textContent='Achievement saved. Changes are included in the achieved month’s review.';button.textContent='Saved';
      form.querySelectorAll('input,select,textarea').forEach(input=>input.disabled=true);
      if(isStaff())report();
    }catch(error){
      if(!error.code){frozen=payload;form.querySelectorAll('input,select,textarea').forEach(input=>input.disabled=true);status.textContent='Save not confirmed. Retry checks the same achievement.';button.textContent='Retry save';}
      else status.textContent=error.message||'Achievement could not be saved.';
      button.disabled=error.code==='40001';
    }
  };
}

function assignmentDetails(studentId) {
 return `<ul class="record-list">${assignments.filter(a=>a.student_id===studentId).map(a=>`<li><div><strong>${escape(people.find(p=>p.id===a.tutor_id)?.display_name||'Tutor')}</strong><span>${escape(a.starts_on)} — ${escape(a.ends_on||'ongoing')}${a.stopped?' · Stopped':''}</span>${a.tutoring_site?`<p>Site: ${escape(a.tutoring_site)}</p>`:''}${a.regular_schedule?`<p>Usual schedule: ${escape(a.regular_schedule)}</p>`:''}${a.stop_reason?`<p>${escape(a.stop_reason)}</p>`:''}</div>${'tutoring_site' in a?`<button class="quiet" data-tutoring-details="${a.id}">Edit site / schedule</button>`:''}${'stopped' in a&&(!a.stopped||isStaff())?`<button class="quiet" data-stop-assignment="${a.id}">${a.stopped?'Restore assignment':"End this assignment"}</button>`:''}</li>`).join('')}</ul>`;
}
function endAssignmentForm(assignment) {
 const restore=assignment.stopped;
 dialog(restore?'Restore assignment':'End tutoring assignment',`<p><strong>${escape(studentName(assignment.student_id))}</strong></p><p>${restore?'Staff can restore the original assignment dates. Canceled plans and removed plan members are not restored automatically; review the schedule afterward.':'Only this tutor/student assignment ends. Past records and other tutors’ assignments stay intact. Later plans lose this student; plans with no remaining students are canceled.'}</p><form id="end-assignment-form">${restore?'':`<label for="last-tutoring-date">Last tutoring date (included)</label><input id="last-tutoring-date" type="date" min="${assignment.starts_on}" value="${assignment.ends_on||nyToday()}" required>`}<label for="assignment-reason">Reason</label><textarea id="assignment-reason" maxlength="1000" required></textarea><label class="check"><input id="assignment-confirm" type="checkbox" required>I confirm this ${restore?'restoration':'assignment ending'}.</label><p id="assignment-status" role="status"></p><button class="primary">${restore?'Restore assignment':'End assignment'}</button></form>`);
 const form=document.querySelector('#end-assignment-form'),button=form.querySelector('button'),status=document.querySelector('#assignment-status');let frozen=null;
 form.onsubmit=async event=>{
  event.preventDefault();if(button.disabled||!form.querySelector('#assignment-confirm').checked)return;
  const payload=frozen||{p_id:assignment.id,p_version:assignment.version,p_end:restore?null:form.querySelector('#last-tutoring-date').value,p_reason:form.querySelector('#assignment-reason').value.trim(),p_restore:restore};
  if(!payload.p_reason){status.textContent='Enter a reason.';return;}
  button.disabled=true;status.textContent='Saving…';
  try{
   const saved=await checked(client.rpc('change_assignment_status',payload));if(!saved?.id)throw Error('Unconfirmed');
   assignments=assignments.map(a=>a.id===saved.id?saved:a);
   status.textContent=restore?'Assignment restored. Review future plans before using them.':'Assignment ended. Past records are preserved. Staff can see the update in this student’s profile and change history.';
   form.querySelectorAll('input,textarea').forEach(input=>input.disabled=true);button.textContent='Saved';
   try{await reloadData();document.querySelector('#close-dialog').onclick=()=>home();}catch{status.textContent+=' Reload the page to refresh the schedule.';}
  }catch(error){
   if(!error.code){frozen=payload;form.querySelectorAll('input,textarea').forEach(input=>input.disabled=true);status.textContent='Save not confirmed. Retry checks the same assignment change.';button.textContent='Retry change';}
   else status.textContent=error.message||'Assignment could not be changed.';
   button.disabled=error.code==='40001';
  }
 };
}

async function importRosterForm() {
 dialog('Import roster','<p id="import-loading" role="status">Loading staff references…</p>');
 const loading=document.querySelector('#import-loading');let references;
 try{references=await allRows(()=>client.from('roster_references').select('*').order('kind').order('reference'));}
 catch{if(loading.isConnected)loading.textContent='Import is unavailable. Check the connection or finish the database update. Nothing was imported.';return;}
 if(!loading.isConnected)return;
 dialog('Import roster',`<p>Import students and assignments from CSV. Existing tutor accounts must already be set up. Importing does not send invitations or record attendance.</p><p>Use the same student reference every time. Never reuse it for another person. Matching names do not merge records. To use an existing student, copy their reference below.</p><button id="import-template" class="secondary">Download CSV template</button><details><summary>Staff reference list</summary><ul class="record-list">${references.map(r=>`<li><strong>${escape(r.kind==='student'?studentName(r.student_id):people.find(p=>p.id===r.person_id)?.display_name||'Tutor')}</strong><code>${escape(r.reference)}</code></li>`).join('')}</ul></details><p class="small">Columns: student_ref, student_name, tutor_ref, starts_on. Date: YYYY-MM-DD. Leave tutor_ref and starts_on blank to add a student without an assignment. Maximum 500 rows / 500 KB. This import does not rename, archive or end existing records.</p><label for="roster-file">Choose CSV</label><input id="roster-file" type="file" accept=".csv,text/csv"><label for="roster-csv">Or paste CSV</label><textarea id="roster-csv" rows="6" placeholder="student_ref,student_name,tutor_ref,starts_on"></textarea><button id="preview-import" class="primary">Preview import</button><p id="import-status" role="status"></p><div id="import-preview"></div>`);
 const input=document.querySelector('#roster-csv'),file=document.querySelector('#roster-file'),previewButton=document.querySelector('#preview-import'),status=document.querySelector('#import-status'),area=document.querySelector('#import-preview');let preview=null;
 document.querySelector('#import-template').onclick=()=>{
  const url=URL.createObjectURL(new Blob(['student_ref,student_name,tutor_ref,starts_on\r\nIMPORT-DEMO-001,Taylor Chen (Import Demo),,\r\n'],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='lvaep-roster-template.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 };
 const invalidate=()=>{preview=null;area.innerHTML='';status.textContent='Preview again after changing the file.';};input.oninput=invalidate;
 file.onchange=async()=>{invalidate();const chosen=file.files[0];if(!chosen)return;if(chosen.size>500000){status.textContent='Choose a CSV smaller than 500 KB.';return;}previewButton.disabled=true;input.disabled=true;try{input.value=await chosen.text();}catch{status.textContent='Could not read this file. Try exporting it as CSV again.';}finally{previewButton.disabled=false;input.disabled=false;}};
 previewButton.onclick=async()=>{
  let rows;try{rows=rosterRows(input.value);}catch(error){status.textContent=error.message;return;}
  previewButton.disabled=true;input.disabled=true;file.disabled=true;area.innerHTML='';status.textContent='Checking all rows. Nothing is being saved…';
  try{
   const id=crypto.randomUUID(),result=await checked(client.rpc('import_roster',{p_id:id,p_rows:rows,p_commit:false,p_expected:null}));
   if(result?.status!=='preview'||!Array.isArray(result.actions))throw Error('Preview unavailable');preview={id,rows,actions:result.actions};
   area.innerHTML=`<h3>Preview: ${rows.length} rows</h3><ul class="record-list">${result.actions.map(a=>`<li><div><strong>${escape(a.student_name)}</strong><span>${escape(a.student_ref)} · ${escape(a.student_action)} · ${escape(a.assignment_action)}</span>${a.tutor_id?`<span>${escape(people.find(p=>p.id===a.tutor_id)?.display_name||'Tutor')} · ${escape(a.starts_on)}</span>`:''}${a.same_name_warning?'<p><strong>Same-name warning:</strong> another reference has this name. This will create a separate person; verify that is intended.</p>':''}</div></li>`).join('')}</ul><label class="check"><input type="checkbox" id="confirm-import">I checked identities, references, dates and any same-name warnings.</label><button class="primary" id="commit-import">Import these rows</button>`;
   status.textContent='Preview ready. No changes saved.';
   document.querySelector('#commit-import').onclick=async()=>{
    const button=document.querySelector('#commit-import');if(button.disabled||!document.querySelector('#confirm-import').checked){status.textContent='Confirm that you checked the preview first.';return;}
    button.disabled=true;previewButton.disabled=true;input.disabled=true;file.disabled=true;document.querySelector('#confirm-import').disabled=true;status.textContent='Importing…';
    try{
     const result=await checked(client.rpc('import_roster',{p_id:preview.id,p_rows:preview.rows,p_commit:true,p_expected:preview.actions}));if(result?.status!=='imported')throw Error('Unconfirmed');
     status.textContent=`Imported ${result.row_count} rows. No invitations or attendance were sent or created.`;button.textContent='Imported';
     try{await reloadData();document.querySelector('#close-dialog').onclick=()=>home();}catch{status.textContent+=' Reload the page to refresh the roster.';}
    }catch(error){
     if(!error.code){status.textContent='Import not confirmed. Retry checks the same import without creating duplicates.';button.disabled=false;button.textContent='Retry import';}
     else{status.textContent=error.message||'Import could not finish. Nothing from this attempt was saved.';previewButton.disabled=false;input.disabled=false;file.disabled=false;button.disabled=true;}
    }
   };
  }catch(error){status.textContent=error.message||'Preview failed. Nothing imported.';}
  finally{previewButton.disabled=false;input.disabled=false;file.disabled=false;}
 };
}

function tutoringDetailsForm(assignment) {
 dialog('Tutoring site and schedule',`<p><strong>${escape(studentName(assignment.student_id))}</strong></p><p>Save these details once and update them when needed. They describe the usual arrangement; they do not create planned lessons or attendance.</p><form id="tutoring-details-form"><label for="tutoring-site">Tutoring site or remote format</label><input id="tutoring-site" maxlength="200" value="${escape(assignment.tutoring_site)}" placeholder="For example, library or video call"><label for="regular-schedule">Regular days and times</label><input id="regular-schedule" maxlength="300" value="${escape(assignment.regular_schedule)}" placeholder="For example, Mondays 4–5 p.m., New York time"><p id="tutoring-details-status" role="status"></p><button class="primary">Save details</button></form>`);
 const form=document.querySelector('#tutoring-details-form'),button=form.querySelector('button'),status=document.querySelector('#tutoring-details-status');let frozen=null;
 form.onsubmit=async event=>{
  event.preventDefault();if(button.disabled)return;
  const payload=frozen||{p_id:assignment.id,p_version:assignment.version,p_site:form.querySelector('#tutoring-site').value.trim(),p_schedule:form.querySelector('#regular-schedule').value.trim()};
  button.disabled=true;status.textContent='Saving…';
  try{
   const saved=await checked(client.rpc('save_tutoring_details',payload));if(!saved?.id)throw Error('Unconfirmed');
   assignments=assignments.map(a=>a.id===saved.id?saved:a);status.textContent='Details saved. Planned lessons and attendance are unchanged.';button.textContent='Saved';form.querySelectorAll('input').forEach(input=>input.disabled=true);
  }catch(error){
   if(!error.code){frozen=payload;form.querySelectorAll('input').forEach(input=>input.disabled=true);status.textContent='Save not confirmed. Retry checks the same details.';button.textContent='Retry save';}
   else status.textContent=error.message||'Details could not be saved.';
   button.disabled=error.code==='40001';
  }
 };
}

const absenceLabel=code=>({TA:'Tutor absent',SA:'Student absent',H:'Holiday'}[code]||code);
function absenceDetails(items,editable=true) {
 if(!items.length)return '';
 return `<details><summary>Absence / holiday records (${items.length})</summary><p>These records add zero hours. They do not change attendance or scheduled lessons.</p><ul class="record-list">${items.map(a=>`<li><div><strong>${escape(studentName(a.student_id))} · ${escape(absenceLabel(a.code))}</strong><span>${escape(a.absence_date||a.date)}${a.voided?' · Removed':''}</span></div>${editable&&(isStaff()||programSettings?.tutor_absence_entry)?`<button class="quiet" data-edit-absence="${a.id}">Edit / restore</button>`:''}</li>`).join('')}</ul></details>`;
}
function absenceForm(studentId,existing=null) {
 const id=existing?.id||crypto.randomUUID(),tutors=[...new Set(assignments.filter(a=>a.student_id===studentId).map(a=>a.tutor_id))];
 dialog(existing?'Edit absence / holiday':'Record absence / holiday',`<p><strong>${escape(studentName(studentId))}</strong></p><p>This records a missed lesson or holiday, with zero hours. It does not cancel a plan or remove saved attendance. Check any same-day lessons separately.</p><form id="absence-form">${isStaff()&&!existing?`<label for="absence-tutor">Tutor</label><select id="absence-tutor" required><option value="">Choose tutor</option>${tutors.map(id=>`<option value="${id}">${escape(people.find(p=>p.id===id)?.display_name||'Tutor')}</option>`).join('')}</select>`:''}<label for="absence-date">Date</label><input id="absence-date" type="date" value="${existing?.absence_date||nyToday()}" required><label for="absence-code">Code</label><select id="absence-code">${['TA','SA','H'].map(code=>`<option value="${code}" ${existing?.code===code?'selected':''}>${code} — ${absenceLabel(code)}</option>`).join('')}</select>${existing?`<label class="check"><input id="absence-voided" type="checkbox" ${existing.voided?'checked':''}>Remove from reports (history is kept)</label>`:''}<p id="absence-status" role="status"></p><button class="primary">Save zero-hour record</button></form>`);
 const form=document.querySelector('#absence-form'),button=form.querySelector('button'),status=document.querySelector('#absence-status');let frozen=null;
 form.onsubmit=async event=>{
  event.preventDefault();if(button.disabled)return;
  const payload=frozen||{p_id:id,p_tutor:existing?.tutor_id||(isStaff()?form.querySelector('#absence-tutor').value:person.id),p_student:studentId,p_date:form.querySelector('#absence-date').value,p_code:form.querySelector('#absence-code').value,p_voided:form.querySelector('#absence-voided')?.checked||false,p_version:existing?.version||0};
  button.disabled=true;status.textContent='Saving…';
  try{const saved=await checked(client.rpc('save_absence',payload));if(!saved?.id)throw Error('Unconfirmed');absences=[...absences.filter(a=>a.id!==saved.id),saved];status.textContent='Saved. No teaching or attendance hours added.';button.textContent='Saved';form.querySelectorAll('input,select').forEach(input=>input.disabled=true);if(isStaff())report();}
  catch(error){if(!error.code){frozen=payload;form.querySelectorAll('input,select').forEach(input=>input.disabled=true);status.textContent='Save not confirmed. Retry checks the same record.';button.textContent='Retry save';}else status.textContent=error.message||'Could not save.';button.disabled=error.code==='40001';}
 };
}
function programSettingsForm() {
 if(!programSettings){dialog('Program settings','<p>Settings could not be loaded. Please refresh and try again.</p>');return;}
 const version=programSettings.version;
 dialog('Program settings',`<p>Only administrators can change program settings.</p><form id="settings-form"><label class="check"><input id="tutor-absence-entry" type="checkbox" ${programSettings.tutor_absence_entry?'checked':''}>Allow tutors to record TA, SA and H codes for their own students</label><p>Off by default: staff can enter codes. Changing this does not rewrite existing records. Codes never add hours or get created automatically.</p><p id="settings-status" role="status"></p><button class="primary">Save setting</button></form>`);
 const form=document.querySelector('#settings-form'),button=form.querySelector('button'),status=document.querySelector('#settings-status');let frozen=null;
 form.onsubmit=async event=>{event.preventDefault();if(button.disabled)return;const payload=frozen||{p_enabled:form.querySelector('input').checked,p_version:version};button.disabled=true;
  try{const saved=await checked(client.rpc('set_absence_permission',payload));if(!saved?.version)throw Error('Unconfirmed');programSettings=saved;status.textContent='Setting saved.';button.textContent='Saved';form.querySelector('input').disabled=true;}
  catch(error){if(!error.code){frozen=payload;form.querySelector('input').disabled=true;status.textContent='Save not confirmed. Retry checks the same setting.';button.textContent='Retry save';}else status.textContent=error.message||'Could not save setting.';button.disabled=error.code==='40001';}
 };
}

function accessList() {
 if(!person?.roles.includes('admin'))return;
 dialog('Account access',`<p>Manage existing accounts. Disabling access preserves their records and blocks further workspace access.</p><ul class="record-list">${people.map(p=>`<li><div><strong>${escape(p.display_name)}</strong><span>${p.active?'Active':'Access disabled'} · ${p.roles.map(escape).join(', ')||'No roles'}</span></div><button class="secondary" data-access-person="${p.id}">Edit access</button></li>`).join('')}</ul>`);
 document.querySelectorAll('[data-access-person]').forEach(button=>button.onclick=()=>accessForm(people.find(p=>p.id===button.dataset.accessPerson)));
}
function accessForm(target) {
 if(!person?.roles.includes('admin')||!target)return;
 dialog('Edit account access',`<p><strong>${escape(target.display_name)}</strong></p><form id="access-form"><fieldset><legend>Allowed roles</legend>${['tutor','staff','admin'].map(role=>`<label class="check"><input type="checkbox" name="access-role" value="${role}" ${target.roles.includes(role)?'checked':''}>${role==='admin'?'Administrator':role==='staff'?'Staff':'Tutor'}</label>`).join('')}</fieldset><label class="check"><input id="access-active" type="checkbox" ${target.active?'checked':''}>Account access enabled</label><p class="small">Staff can see program records. Administrators can also manage access and settings. Tutors see their own assigned records. The last administrator cannot be removed.</p><label class="check"><input id="access-confirm" type="checkbox" required>I checked this person's roles and want to save these permissions.</label><p id="access-save-status" role="alert"></p><button class="primary">Save access</button></form>`);
 const form=document.querySelector('#access-form'),button=form.querySelector('button'),status=document.querySelector('#access-save-status');
 form.onsubmit=async event=>{
  event.preventDefault();if(button.disabled||!document.querySelector('#access-confirm').checked)return;
  const roles=[...form.querySelectorAll('[name=access-role]:checked')].map(i=>i.value),active=document.querySelector('#access-active').checked;
  if(active&&!roles.length){status.textContent='Choose at least one role for an enabled account.';return;}
  button.disabled=true;status.textContent='Saving access…';
  try{
   const saved=await checked(client.rpc('set_person_access',{p_person:target.id,p_roles:roles,p_active:active,p_version:target.version}));
   people=people.map(p=>p.id===saved.id?saved:p);status.textContent='Access saved.';form.querySelectorAll('input').forEach(i=>i.disabled=true);button.textContent='Saved';
   if(saved.id===person.id){await loadHome();}
  }catch(error){
   if(!error.code||error.code==='40001'){form.querySelectorAll('input').forEach(i=>i.disabled=true);status.textContent='The result needs checking. Close this window and refresh saved records before changing access again.';}
   else{status.textContent=error.message||'Access was not changed.';button.disabled=false;}
  }
 };
}
