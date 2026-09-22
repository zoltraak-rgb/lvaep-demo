begin;
alter table public.assignments add column stop_reason text;
alter table public.assignments add column previous_ends_on date;
alter table public.assignments add column stopped boolean not null default false;
create function public.change_assignment_status(p_id uuid,p_version integer,p_end date,p_reason text,p_restore boolean default false) returns public.assignments
language plpgsql security definer set search_path='' as $$
declare old_row public.assignments; saved public.assignments; occurrence public.planned_occurrences; target_end date; before_plans jsonb;
begin
 select * into old_row from public.assignments where id=p_id;
 if not found or not(app_private.is_staff() or (old_row.tutor_id=auth.uid() and app_private.has_role('tutor'))) then raise exception 'Assignment access denied' using errcode='42501'; end if;
 if p_restore and not app_private.is_staff() then raise exception 'Staff must restore assignments' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(old_row.tutor_id::text,0));
 select * into old_row from public.assignments where id=p_id for update;
 if p_version is null or p_reason is null or length(trim(p_reason)) not between 1 and 1000 or p_restore is null then raise exception 'Enter a brief reason'; end if;
 if old_row.version=p_version+1 and old_row.stopped=not p_restore and old_row.stop_reason=trim(p_reason) and (p_restore or old_row.ends_on=p_end) then return old_row; end if;
 if old_row.version<>p_version then raise exception 'Assignment changed. Reopen before editing.' using errcode='40001'; end if;
 if p_restore then
  if not old_row.stopped then raise exception 'Assignment is not stopped'; end if;
  target_end=old_row.previous_ends_on;
  if exists(select 1 from public.assignments a where a.id<>p_id and a.tutor_id=old_row.tutor_id and a.student_id=old_row.student_id and (target_end is null or a.starts_on<=target_end) and (a.ends_on is null or a.ends_on>=old_row.starts_on)) then raise exception 'Another assignment overlaps. Staff must resolve it before restoring.'; end if;
  update public.assignments set ends_on=target_end,stopped=false,previous_ends_on=null,stop_reason=trim(p_reason),version=version+1 where id=p_id returning * into saved;
 else
  if old_row.stopped then raise exception 'Assignment already stopped'; end if;
  if p_end is null or not isfinite(p_end) or p_end<old_row.starts_on or (old_row.ends_on is not null and p_end>old_row.ends_on) then raise exception 'Choose a last tutoring date within this assignment'; end if;
  -- Do not silently strand existing attendance or achievements outside their assignment.
  if exists(select 1 from public.lessons l join public.attendance a on a.lesson_id=l.id where l.tutor_id=old_row.tutor_id and a.student_id=old_row.student_id and not l.voided and l.lesson_date>p_end and (old_row.ends_on is null or l.lesson_date<=old_row.ends_on)) or exists(select 1 from public.achievements a where a.tutor_id=old_row.tutor_id and a.student_id=old_row.student_id and not a.voided and a.achieved_on>p_end and (old_row.ends_on is null or a.achieved_on<=old_row.ends_on)) then raise exception 'Later saved records exist. Check their dates before ending this assignment.'; end if;
  select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) into before_plans from public.planned_occurrences o join public.lesson_plans p on p.id=o.plan_id where p.tutor_id=old_row.tutor_id and old_row.student_id=any(o.student_ids) and o.lesson_date>p_end and not o.canceled and o.lesson_id is null and not exists(select 1 from public.assignments a where a.id<>p_id and a.tutor_id=old_row.tutor_id and a.student_id=old_row.student_id and a.starts_on<=o.lesson_date and (a.ends_on is null or a.ends_on>=o.lesson_date));
  update public.assignments set previous_ends_on=ends_on,ends_on=p_end,stopped=true,stop_reason=trim(p_reason),version=version+1 where id=p_id returning * into saved;
  for occurrence in select * from jsonb_populate_recordset(null::public.planned_occurrences,before_plans) loop
   if cardinality(occurrence.student_ids)=1 then
    update public.planned_occurrences set canceled=true where id=occurrence.id;
   else
    update public.planned_occurrences set student_ids=array_remove(student_ids,old_row.student_id) where id=occurrence.id;
   end if;
  end loop;
  update public.lesson_plans set version=version+1 where id in (select (v->>'plan_id')::uuid from jsonb_array_elements(before_plans) v);
 end if;
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value) values(auth.uid(),'assignment',p_id,case when p_restore then 'restored' else 'stopped' end,jsonb_build_object('assignment',to_jsonb(old_row),'plans',coalesce(before_plans,'[]'::jsonb)),to_jsonb(saved));
 return saved;
end;
$$;
revoke all on function public.change_assignment_status(uuid,integer,date,text,boolean) from public,anon,authenticated;
grant execute on function public.change_assignment_status(uuid,integer,date,text,boolean) to authenticated;
commit;
