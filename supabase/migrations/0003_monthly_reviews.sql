begin;
create table public.monthly_reviews (
  tutor_id uuid not null references public.people(id),
  month date not null check(isfinite(month) and extract(day from month)=1),
  reviewed_snapshot jsonb not null,
  confirmed_at timestamptz not null default now(),
  primary key(tutor_id,month)
);
alter table public.monthly_reviews enable row level security;
revoke all on public.monthly_reviews from public,anon,authenticated;
grant select on public.monthly_reviews to authenticated;
create policy monthly_reviews_read on public.monthly_reviews for select to authenticated using (
  app_private.is_staff() or (tutor_id=auth.uid() and app_private.has_role('tutor'))
);
create function app_private.review_snapshot(p_tutor uuid,p_month date) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'students',coalesce((select jsonb_agg(s.student_id order by s.student_id) from (
      select a.student_id from public.assignments a where a.tutor_id=p_tutor and a.starts_on < p_month+interval '1 month' and (a.ends_on is null or a.ends_on>=p_month)
      union select a.student_id from public.attendance a join public.lessons l on l.id=a.lesson_id where l.tutor_id=p_tutor and not l.voided and l.lesson_date>=p_month and l.lesson_date<p_month+interval '1 month'
    ) s),'[]'::jsonb),
    'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'date',l.lesson_date,'minutes',l.minutes,'version',l.version,
      'attendance',coalesce((select jsonb_agg(jsonb_build_object('student_id',a.student_id,'minutes',a.minutes) order by a.student_id) from public.attendance a where a.lesson_id=l.id),'[]'::jsonb)) order by l.lesson_date,l.id)
      from public.lessons l where l.tutor_id=p_tutor and not l.voided and l.lesson_date>=p_month and l.lesson_date<p_month+interval '1 month'),'[]'::jsonb)
  );
$$;
revoke all on function app_private.review_snapshot(uuid,date) from public,anon,authenticated;
create function public.get_month_review(p_tutor uuid,p_month date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare snapshot jsonb; previous public.monthly_reviews; open_month date;
begin
  if not (app_private.is_staff() or (p_tutor=auth.uid() and app_private.has_role('tutor'))) then raise exception 'Review access denied'; end if;
  if p_month is null or not isfinite(p_month) or extract(day from p_month)<>1 then raise exception 'Invalid review month'; end if;
  open_month=date_trunc('month',now() at time zone 'America/New_York')::date;
  snapshot=app_private.review_snapshot(p_tutor,p_month);
  select * into previous from public.monthly_reviews where tutor_id=p_tutor and month=p_month;
  return jsonb_build_object('snapshot',snapshot,'confirmed_at',previous.confirmed_at,'can_confirm',p_month<open_month,
    'status',case when previous.tutor_id is null then 'not_reviewed' when previous.reviewed_snapshot=snapshot then 'reviewed' else 'updated' end);
end;
$$;
create function public.confirm_month_review(p_month date,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_review jsonb; old_review public.monthly_reviews; new_review public.monthly_reviews;
begin
  if not app_private.has_role('tutor') then raise exception 'Tutor access required'; end if;
  -- Same tutor lock as record_lesson and assign_student, including zero-session months.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  current_review=public.get_month_review(auth.uid(),p_month);
  if not (current_review->>'can_confirm')::boolean then raise exception 'Review opens next month'; end if;
  if p_snapshot is null or p_snapshot is distinct from current_review->'snapshot' then raise exception 'Records changed. Reload and review again'; end if;
  if jsonb_array_length(p_snapshot->'students')=0 and jsonb_array_length(p_snapshot->'lessons')=0 then raise exception 'No assignments or lessons for this month'; end if;
  select * into old_review from public.monthly_reviews where tutor_id=auth.uid() and month=p_month;
  if old_review.reviewed_snapshot=p_snapshot then return current_review; end if;
  insert into public.monthly_reviews(tutor_id,month,reviewed_snapshot) values(auth.uid(),p_month,p_snapshot)
  on conflict(tutor_id,month) do update set reviewed_snapshot=excluded.reviewed_snapshot,confirmed_at=now()
  returning * into new_review;
  insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value)
  values(auth.uid(),'monthly_review',auth.uid(),'confirmed',to_jsonb(old_review),to_jsonb(new_review));
  return public.get_month_review(auth.uid(),p_month);
end;
$$;
revoke all on function public.get_month_review(uuid,date),public.confirm_month_review(date,jsonb) from public,anon,authenticated;
grant execute on function public.get_month_review(uuid,date),public.confirm_month_review(date,jsonb) to authenticated;
commit;
