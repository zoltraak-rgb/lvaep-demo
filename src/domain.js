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
