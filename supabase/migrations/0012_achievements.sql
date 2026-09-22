begin;
create table public.achievements (
 id uuid primary key,
 tutor_id uuid not null references public.people(id),
 student_id uuid not null references public.students(id),
 code text not null check(code in ('economic_1','economic_2','economic_3','educational_1','educational_2','educational_3','educational_4','family_1','family_2','family_3','family_4','family_5','family_6','societal_1','societal_2','societal_3','societal_4','other_1')),
 achieved_on date not null check(isfinite(achieved_on)),
 notes text not null default '' check(length(notes)<=1000),
 voided boolean not null default false,
 version integer not null default 1,
 created_at timestamptz not null default now(),
 check(code<>'other_1' or length(trim(notes))>0)
);
create index on public.achievements(tutor_id,achieved_on);
alter table public.achievements enable row level security;
revoke all on public.achievements from public,anon,authenticated;
grant select on public.achievements to authenticated;
create policy achievements_read on public.achievements for select to authenticated using(app_private.is_staff() or (tutor_id=auth.uid() and app_private.has_role('tutor')));
create function public.save_achievement(p_id uuid,p_tutor uuid,p_student uuid,p_code text,p_date date,p_notes text,p_voided boolean,p_version integer,p_allow_duplicate boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare original public.achievements; saved public.achievements;
begin
 if not(app_private.is_staff() or (p_tutor=auth.uid() and app_private.has_role('tutor'))) then raise exception 'Achievement access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tutor::text,0));
 if p_id is null or p_tutor is null or p_student is null or p_code is null or p_date is null or not isfinite(p_date) or p_notes is null or length(p_notes)>1000 or p_voided is null or p_version is null or p_version<0 or p_allow_duplicate is null then raise exception 'Check achievement fields'; end if;
 if p_code not in ('economic_1','economic_2','economic_3','educational_1','educational_2','educational_3','educational_4','family_1','family_2','family_3','family_4','family_5','family_6','societal_1','societal_2','societal_3','societal_4','other_1') or (p_code='other_1' and length(trim(p_notes))=0) then raise exception 'Choose an achievement; describe Other'; end if;
 select * into original from public.achievements where id=p_id;
 if found then
  if original.tutor_id<>p_tutor or original.student_id<>p_student then raise exception 'Achievement identity cannot change'; end if;
  if original.version=p_version+1 and original.code=p_code and original.achieved_on=p_date and original.notes=trim(p_notes) and original.voided=p_voided then return jsonb_build_object('status','saved','achievement',to_jsonb(original)); end if;
  if original.version<>p_version then raise exception 'Achievement changed. Reopen it before editing.' using errcode='40001'; end if;
 else
  if p_version<>0 or p_voided then raise exception 'Achievement not found'; end if;
 end if;
 if not p_voided and not exists(select 1 from public.assignments a where a.tutor_id=p_tutor and a.student_id=p_student and a.starts_on<=p_date and (a.ends_on is null or a.ends_on>=p_date)) then raise exception 'Student must be assigned to this tutor on the achieved date'; end if;
 if not p_voided and not p_allow_duplicate and exists(select 1 from public.achievements a where a.tutor_id=p_tutor and a.student_id=p_student and a.code=p_code and a.achieved_on=p_date and not a.voided and a.id<>p_id) then return jsonb_build_object('status','duplicate_warning'); end if;
 if original.id is null then
  insert into public.achievements(id,tutor_id,student_id,code,achieved_on,notes) values(p_id,p_tutor,p_student,p_code,p_date,trim(p_notes)) returning * into saved;
 else
  update public.achievements set code=p_code,achieved_on=p_date,notes=trim(p_notes),voided=p_voided,version=version+1 where id=p_id returning * into saved;
 end if;
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value) values(auth.uid(),'achievement',p_id,case when original.id is null then 'recorded' when p_voided then 'removed' when original.voided then 'restored' else 'corrected' end,case when original.id is null then null else to_jsonb(original) end,to_jsonb(saved));
 return jsonb_build_object('status','saved','achievement',to_jsonb(saved));
end;
$$;
revoke all on function public.save_achievement(uuid,uuid,uuid,text,date,text,boolean,integer,boolean) from public,anon,authenticated;
grant execute on function public.save_achievement(uuid,uuid,uuid,text,date,text,boolean,integer,boolean) to authenticated;
-- Extend, rather than rebuild, the previously installed attendance snapshot.
alter function app_private.review_snapshot(uuid,date) rename to attendance_review_snapshot;
create function app_private.review_snapshot(p_tutor uuid,p_month date) returns jsonb
language sql stable security definer set search_path='' as $$
 select app_private.attendance_review_snapshot(p_tutor,p_month)||jsonb_build_object('achievements',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'student_id',a.student_id,'code',a.code,'date',a.achieved_on,'notes',a.notes,'version',a.version) order by a.achieved_on,a.id) from public.achievements a where a.tutor_id=p_tutor and not a.voided and a.achieved_on>=p_month and a.achieved_on<p_month+interval '1 month'),'[]'::jsonb));
$$;
revoke all on function app_private.review_snapshot(uuid,date) from public,anon,authenticated;
-- Empty format extension must not invalidate existing confirmations or change their timestamp.
update public.monthly_reviews set reviewed_snapshot=reviewed_snapshot||jsonb_build_object('achievements','[]'::jsonb);
commit;
