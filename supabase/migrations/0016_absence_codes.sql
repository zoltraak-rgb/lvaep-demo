begin;
create table public.program_settings(id boolean primary key default true check(id),tutor_absence_entry boolean not null default false,version integer not null default 1);
insert into public.program_settings default values;
alter table public.program_settings enable row level security;
revoke all on public.program_settings from public,anon,authenticated;
grant select on public.program_settings to authenticated;
create policy active_settings_read on public.program_settings for select to authenticated using(app_private.is_active());
create function public.set_absence_permission(p_enabled boolean,p_version integer) returns public.program_settings
language plpgsql security definer set search_path='' as $$
declare original public.program_settings; saved public.program_settings;
begin
 if not app_private.has_role('admin') then raise exception 'Administrator access required' using errcode='42501'; end if;
 select * into original from public.program_settings where id for update;
 if p_enabled is null or p_version is null then raise exception 'Invalid setting'; end if;
 if original.version=p_version+1 and original.tutor_absence_entry=p_enabled then return original; end if;
 if original.version<>p_version then raise exception 'Settings changed. Reopen settings.' using errcode='40001'; end if;
 update public.program_settings set tutor_absence_entry=p_enabled,version=version+1 where id returning * into saved;
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value) values(auth.uid(),'program_settings',auth.uid(),'absence_permission',to_jsonb(original),to_jsonb(saved));
 return saved;
end;
$$;
create table public.absence_records(id uuid primary key,tutor_id uuid not null references public.people(id),student_id uuid not null references public.students(id),absence_date date not null check(isfinite(absence_date)),code text not null check(code in ('TA','SA','H')),voided boolean not null default false,version integer not null default 1);
create unique index active_absence_identity on public.absence_records(tutor_id,student_id,absence_date,code) where not voided;
alter table public.absence_records enable row level security;
revoke all on public.absence_records from public,anon,authenticated;
grant select on public.absence_records to authenticated;
create policy absence_read on public.absence_records for select to authenticated using(app_private.is_staff() or(tutor_id=auth.uid() and app_private.has_role('tutor')));
create function public.save_absence(p_id uuid,p_tutor uuid,p_student uuid,p_date date,p_code text,p_voided boolean,p_version integer) returns public.absence_records
language plpgsql security definer set search_path='' as $$
declare original public.absence_records; saved public.absence_records; enabled boolean;
begin
 select tutor_absence_entry into enabled from public.program_settings where id for share;
 if not(app_private.is_staff() or(p_tutor=auth.uid() and app_private.has_role('tutor') and enabled)) then raise exception 'Absence entry is restricted to staff' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_tutor::text,0));
 if p_id is null or p_tutor is null or p_student is null or p_date is null or not isfinite(p_date) or p_code is null or p_code not in ('TA','SA','H') or p_voided is null or p_version is null or p_version<0 then raise exception 'Check absence date and code'; end if;
 select * into original from public.absence_records where id=p_id;
 if found then
  if original.tutor_id<>p_tutor or original.student_id<>p_student then raise exception 'Absence identity cannot change'; end if;
  if original.version=p_version+1 and original.absence_date=p_date and original.code=p_code and original.voided=p_voided then return original; end if;
  if original.version<>p_version then raise exception 'Absence changed. Reopen before editing.' using errcode='40001'; end if;
 elsif p_version<>0 or p_voided then raise exception 'Absence not found'; end if;
 if not p_voided and not exists(select 1 from public.assignments a where a.tutor_id=p_tutor and a.student_id=p_student and a.starts_on<=p_date and(a.ends_on is null or a.ends_on>=p_date)) then raise exception 'Student must be assigned on this date'; end if;
 if not p_voided and exists(select 1 from public.absence_records a where a.tutor_id=p_tutor and a.student_id=p_student and a.absence_date=p_date and a.code=p_code and not a.voided and a.id<>p_id) then raise exception 'This absence code is already recorded for this date'; end if;
 if original.id is null then insert into public.absence_records(id,tutor_id,student_id,absence_date,code) values(p_id,p_tutor,p_student,p_date,p_code) returning * into saved;
 else update public.absence_records set absence_date=p_date,code=p_code,voided=p_voided,version=version+1 where id=p_id returning * into saved;end if;
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value) values(auth.uid(),'absence',p_id,case when p_voided then 'removed' when original.id is null then 'recorded' else 'corrected' end,case when original.id is null then null else to_jsonb(original) end,to_jsonb(saved));
 return saved;
end;
$$;
revoke all on function public.set_absence_permission(boolean,integer),public.save_absence(uuid,uuid,uuid,date,text,boolean,integer) from public,anon,authenticated;
grant execute on function public.set_absence_permission(boolean,integer),public.save_absence(uuid,uuid,uuid,date,text,boolean,integer) to authenticated;
alter function app_private.review_snapshot(uuid,date) rename to achievement_review_snapshot;
create function app_private.review_snapshot(p_tutor uuid,p_month date) returns jsonb
language sql stable security definer set search_path='' as $$
 select app_private.achievement_review_snapshot(p_tutor,p_month)||jsonb_build_object('absences',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'student_id',a.student_id,'date',a.absence_date,'code',a.code,'version',a.version) order by a.absence_date,a.id) from public.absence_records a where a.tutor_id=p_tutor and not a.voided and a.absence_date>=p_month and a.absence_date<p_month+interval '1 month'),'[]'::jsonb));
$$;
revoke all on function app_private.review_snapshot(uuid,date) from public,anon,authenticated;
update public.monthly_reviews set reviewed_snapshot=reviewed_snapshot||jsonb_build_object('absences','[]'::jsonb);
commit;
