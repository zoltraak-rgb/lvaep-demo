begin;
do $$
declare t uuid; s uuid; a uuid='da000000-0000-4000-8000-000000000001'; b uuid='da000000-0000-4000-8000-000000000002'; c uuid='da000000-0000-4000-8000-000000000003'; r uuid='da000000-0000-4000-8000-000000000004'; m date=date_trunc('month',now() at time zone 'America/New_York')::date; prev date; d date; i int;
begin
 select id into t from auth.users where email='tutor@lvaep-demo.example';
 select id into s from auth.users where email='staff@lvaep-demo.example';
 if t is null or s is null then raise exception 'Create both demo authentication accounts first'; end if;
 if exists(select 1 from public.students where id=a) then raise exception 'Sample data already installed; no changes made'; end if;
 insert into public.people(id,display_name,roles) values(t,'Alex Morgan',array['tutor']),(s,'Casey Bennett',array['staff']);
 perform set_config('request.jwt.claim.sub',s::text,true);
 perform public.save_student(a,'Sofia Martinez',false,0);
 perform public.save_student(b,'Daniel Park',false,0);
 perform public.save_student(c,'Amara Okafor',false,0);
 prev=(m-interval '1 month')::date;
 perform public.assign_student(gen_random_uuid(),t,a,prev);
 perform public.assign_student(gen_random_uuid(),t,b,prev);
 perform public.assign_student(gen_random_uuid(),t,c,prev);
 update public.assignments set tutoring_site='Community Learning Center',regular_schedule='Tuesdays and Thursdays, 6:00–7:00 pm' where tutor_id=t;
 perform set_config('request.jwt.claim.sub',t::text,true);
 for i in 0..7 loop
   d=prev+3+i*3;
   perform public.record_lesson(gen_random_uuid(),d,60,jsonb_build_array(jsonb_build_object('student_id',a,'minutes',60),jsonb_build_object('student_id',b,'minutes',case when i=3 then 45 else 60 end)),false);
 end loop;
 perform public.record_lesson(gen_random_uuid(),prev+12,90,jsonb_build_array(jsonb_build_object('student_id',c,'minutes',90)),false);
 perform public.confirm_month_review(prev,app_private.review_snapshot(t,prev));
 for i in 0..4 loop
   d=m+2+i*3;
   if d<=(now() at time zone 'America/New_York')::date then
    perform public.record_lesson(gen_random_uuid(),d,60,jsonb_build_array(jsonb_build_object('student_id',a,'minutes',60),jsonb_build_object('student_id',c,'minutes',50)),false);
   end if;
 end loop;
 perform public.request_missing_student(r,'Lucas Reed','Joined the conversation group this month. Please connect to the roster.');
 perform public.record_mixed_lesson(gen_random_uuid(),m+17,60,jsonb_build_array(jsonb_build_object('student_id',b,'minutes',60)),jsonb_build_array(jsonb_build_object('request_id',r,'minutes',45)),false);
 perform public.request_missing_student('da000000-0000-4000-8000-000000000005','Mei Chen','New learner referred by the library. Waiting for an official assignment.');
 perform public.save_achievement(gen_random_uuid(),t,a,'family_6',m+8,'Visited the library and chose books to read at home.',false,0,false);
 perform public.save_achievement(gen_random_uuid(),t,c,'other_1',m+11,'Completed a five-minute conversation confidently.',false,0,false);
 perform public.create_weekly_plan(gen_random_uuid(),m+23,(m+interval '2 months'-interval '1 day')::date,60,array[a,b]);
end $$;
commit;
