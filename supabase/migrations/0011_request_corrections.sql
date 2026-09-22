begin;
alter table public.student_requests add column staff_note text not null default '' check(length(staff_note)<=1000);
create function public.change_student_request(p_id uuid,p_version integer,p_action text,p_reason text)
returns public.student_requests language plpgsql security definer set search_path='' as $$
declare original public.student_requests; saved public.student_requests; target text; linked jsonb;
begin
 if not app_private.is_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
 if p_action is null or p_action not in ('reject','reopen','disconnect') or p_reason is null or length(trim(p_reason)) not between 1 and 1000 or p_version is null then raise exception 'Choose an action and give a brief reason'; end if;
 select * into original from public.student_requests where id=p_id;
 if not found then raise exception 'Request unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(original.tutor_id::text,0));
 select * into original from public.student_requests where id=p_id for update;
 target=case when p_action='reject' then 'rejected' else 'pending' end;
 if original.version=p_version+1 and original.status=target and original.staff_note=trim(p_reason) and exists(select 1 from public.audit_events where entity='student_request' and entity_id=p_id and action=p_action and (after_value->>'version')::integer=original.version) then return original; end if;
 if original.version<>p_version then raise exception 'Request changed. Reload before editing' using errcode='40001'; end if;
 if (p_action='reject' and original.status<>'pending') or (p_action='reopen' and original.status<>'rejected') or (p_action='disconnect' and original.status<>'resolved') then raise exception 'This action is not available for the current request'; end if;
 if p_action='disconnect' then
  -- Provenance survives duration corrections. Only attendance created by this connection moves back.
  select jsonb_agg(to_jsonb(a)) into linked from public.attendance a where source_request_id=p_id;
  if exists(select 1 from public.attendance a join public.pending_attendance pa on pa.lesson_id=a.lesson_id and pa.request_id=p_id where a.source_request_id=p_id) then raise exception 'Pending attendance already exists. Inspect the lesson before undoing'; end if;
  insert into public.pending_attendance(lesson_id,request_id,minutes) select lesson_id,p_id,minutes from public.attendance where source_request_id=p_id;
  update public.lessons set version=version+1 where id in(select lesson_id from public.attendance where source_request_id=p_id);
  delete from public.attendance where source_request_id=p_id;
  -- A mistaken match is a correction: existing confirmations remain history, and changed records require review.
 end if;
 update public.student_requests set status=target,student_id=null,staff_note=trim(p_reason),version=version+1 where id=p_id returning * into saved;
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value) values(auth.uid(),'student_request',p_id,p_action,jsonb_build_object('request',to_jsonb(original),'connected_attendance',linked),to_jsonb(saved));
 return saved;
end;
$$;
revoke all on function public.change_student_request(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.change_student_request(uuid,integer,text,text) to authenticated;
commit;
