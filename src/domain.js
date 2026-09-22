export function nyToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value = type => parts.find(p=>p.type===type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function previousMonth(date = nyToday()) {
  const [year,month] = date.split('-').map(Number);
  return `${month===1?year-1:year}-${String(month===1?12:month-1).padStart(2,'0')}`;
}
export function minutesLabel(minutes) {
  const hours=Math.floor(minutes/60), rest=minutes%60;
  return [hours ? `${hours} hr` : '',rest ? `${rest} min` : ''].filter(Boolean).join(' ') || '0 min';
}
export function monthLabel(month) {
  return new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T12:00:00Z`));
}
export function summarize(lessons,month) {
  const included=lessons.filter(l=>!l.voided && l.lesson_date.startsWith(`${month}-`));
  const students=new Set(); let studentMinutes=0;
  for(const lesson of included) for(const participant of lesson.attendance||[]) {
    students.add(participant.student_id); studentMinutes+=participant.minutes;
  }
  return {lessons:included,teachingMinutes:included.reduce((n,l)=>n+l.minutes,0),studentMinutes,studentCount:students.size};
}
export function monthlyReportMembers(assignments,lessons,month) {
  const first=`${month}-01`;
  const [year,number]=month.split('-').map(Number);
  const last=`${month}-${new Date(Date.UTC(year,number,0)).getUTCDate()}`;
  const members=new Map();
  const add=(tutor,student)=>{if(!members.has(tutor))members.set(tutor,new Set());if(student)members.get(tutor).add(student);};
  for(const a of assignments) if(a.starts_on<=last&&(!a.ends_on||a.ends_on>=first))add(a.tutor_id,a.student_id);
  for(const l of summarize(lessons,month).lessons){add(l.tutor_id);for(const a of l.attendance||[])add(l.tutor_id,a.student_id);}
  return members;
}
export function calendarDays(month) {
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return [];
  const first=new Date(`${month}-01T12:00:00Z`);
  const year=first.getUTCFullYear(),number=first.getUTCMonth();
  const days=new Date(Date.UTC(year,number+1,0)).getUTCDate();
  return [...Array(first.getUTCDay()).fill(null),...Array.from({length:days},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`)];
}

// Separate row types keep shared teaching time from being repeated for each student.
export function reportCsv({month,lessons,assignments,people,students,requests=[],achievements=[],reviewStates={},retrievedAt,exportedAt}) {
  const columns=['Record type','Month','Records retrieved UTC','Exported UTC','Tutor','Student','Record date','Teaching minutes','Official attendance minutes','Pending attendance minutes','Review status','Achievement','Achievement details'];
  const rows=[columns];
  const name=(items,id,fallback)=>items.find(item=>item.id===id)?.display_name||fallback;
  const add=(type,tutor,student='',date='',teaching='',official='',pending='',achievement='',notes='')=>rows.push([type,month,retrievedAt,exportedAt,name(people,tutor,'Tutor'),student,date,teaching,official,pending,reviewStates[tutor]||'Unavailable',achievement,notes]);
  const members=monthlyReportMembers(assignments,lessons,month);
  for(const [tutor,studentIds] of members){
    add('Tutor review',tutor);
    const recorded=summarize(lessons.filter(l=>l.tutor_id===tutor),month).lessons;
    for(const student of studentIds)if(!recorded.some(l=>l.attendance.some(a=>a.student_id===student)))add('No recorded attendance',tutor,name(students,student,'Student'));
    for(const lesson of recorded){
      add('Lesson',tutor,'',lesson.lesson_date,lesson.minutes);
      for(const a of lesson.attendance||[])add('Official attendance',tutor,name(students,a.student_id,'Student'),lesson.lesson_date,'',a.minutes);
      for(const a of lesson.pending_attendance||[])add(requests.find(r=>r.id===a.request_id)?.status==='rejected'?'Rejected attendance (not official)':'Pending attendance',tutor,name(requests,a.request_id,'Student awaiting connection'),lesson.lesson_date,'','',a.minutes);
    }
  }
  for(const a of achievements.filter(a=>!a.voided&&a.achieved_on.startsWith(month)))add('Achievement',a.tutor_id,name(students,a.student_id,'Student'),a.achieved_on,'','','',achievementTypes.find(t=>t.code===a.code)?.label||a.code,a.notes);
  const cell=value=>{let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';};
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}

export const achievementTypes=[{"code": "economic_1", "category": "Economic", "label": "Enter employment"}, {"code": "economic_2", "category": "Economic", "label": "Retain employment"}, {"code": "economic_3", "category": "Economic", "label": "Leave public assistance"}, {"code": "educational_1", "category": "Educational", "label": "Achieve work-based project learner goal"}, {"code": "educational_2", "category": "Educational", "label": "Enter occupational skills training"}, {"code": "educational_3", "category": "Educational", "label": "Enter postsecondary education"}, {"code": "educational_4", "category": "Educational", "label": "Obtain high school diploma"}, {"code": "family_1", "category": "Family", "label": "Help more frequently with school"}, {"code": "family_2", "category": "Family", "label": "Increase contact with children’s teachers"}, {"code": "family_3", "category": "Family", "label": "Involvement in school activities"}, {"code": "family_4", "category": "Family", "label": "Purchase books/magazines"}, {"code": "family_5", "category": "Family", "label": "Read to children"}, {"code": "family_6", "category": "Family", "label": "Visit library with/for children"}, {"code": "societal_1", "category": "Societal/Community", "label": "Obtain citizenship"}, {"code": "societal_2", "category": "Societal/Community", "label": "Achieve civics skills"}, {"code": "societal_3", "category": "Societal/Community", "label": "Community involvement"}, {"code": "societal_4", "category": "Societal/Community", "label": "Vote/register to vote"}, {"code": "other_1", "category": "Other", "label": "Other"}];
