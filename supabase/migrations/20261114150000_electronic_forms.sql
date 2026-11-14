begin;
create table public.site_settings (
 id boolean primary key default true check(id), logo_url text, company_name_ar text, company_name_en text,
 company_subtitle_ar text, company_subtitle_en text, forms_header_line_ar text, forms_header_line_en text,
 brand_primary_color text not null default '#548235' check(brand_primary_color ~ '^#[0-9a-fA-F]{6}$')
);
insert into public.site_settings(id) values(true);
create table public.form_templates (
 id uuid primary key default gen_random_uuid(), code text not null unique, title_ar text not null, description text,
 schema jsonb not null, is_active boolean not null default true, version int not null default 1,
 created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.form_template_versions (
 template_id uuid references public.form_templates on delete restrict, version int, schema jsonb not null, title_ar text not null,code text not null,primary key(template_id,version)
);
create function public.record_form_version() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_when='BEFORE' then new.version:=old.version+1;new.updated_at:=now();return new;end if;
 insert into public.form_template_versions values(new.id,new.version,new.schema,new.title_ar,new.code);return new;
end $$;
revoke all on function public.record_form_version() from public;
create trigger bump_version before update on public.form_templates for each row execute function public.record_form_version();
create trigger store_version after insert or update on public.form_templates for each row execute function public.record_form_version();
create table public.form_links(
 id uuid primary key default gen_random_uuid(),template_id uuid not null references public.form_templates,
 token text unique not null default replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''), label text,
 prefill jsonb not null default '{}', locked_fields text[] not null default '{}', max_submissions int check(max_submissions>0),
 expires_at timestamptz, allow_print boolean not null default false,is_active boolean not null default true,
 created_by uuid default auth.uid(),created_at timestamptz not null default now(), submissions_count int not null default 0
);
create sequence public.form_reference_seq;
create table public.form_submissions(
 id uuid primary key default gen_random_uuid(), reference_code text unique not null default ('TL-'||to_char(now(),'YYYY')||'-'||to_char(nextval('public.form_reference_seq'),'FM000000000')),
 template_id uuid not null, template_version integer not null,foreign key(template_id,template_version) references public.form_template_versions,
 link_id uuid references public.form_links, data jsonb not null,status text not null default 'pending_review' check(status in ('pending_review','approved','rejected','draft')),
 source text not null default 'internal' check(source in ('public_link','internal')), submitter_ip_hash text,request_id uuid,unique(link_id,request_id),
 reviewed_by uuid,reviewed_at timestamptz,review_note text,created_by uuid default auth.uid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index form_ip_rate on public.form_submissions(submitter_ip_hash,created_at) where submitter_ip_hash is not null;
do $$declare t text;begin
 foreach t in array array['form_templates','form_template_versions','form_links','form_submissions','site_settings'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 if t <> 'form_template_versions' then
 execute format('grant insert,update on public.%I to authenticated',t);
 execute format('create policy forms_admin on public.%I for all to authenticated using(public.is_admin(auth.uid())) with check(public.is_admin(auth.uid()))',t);
 end if;
 end loop;end $$;
create policy template_read on public.form_templates for select to authenticated using(is_active);
create policy version_read on public.form_template_versions for select to authenticated using(public.is_admin(auth.uid()) or exists(select from public.form_templates t where t.id=template_id and t.is_active));
create policy branding_read on public.site_settings for select to authenticated using(auth.uid() is not null);
create policy own_read on public.form_submissions for select to authenticated using(created_by=auth.uid());
create policy own_fill on public.form_submissions for insert to authenticated with check(created_by=auth.uid() and source='internal' and status='pending_review' and reviewed_by is null and link_id is null and submitter_ip_hash is null and exists(select from public.form_templates t where t.id=template_id and t.version=template_version and t.is_active));
grant usage on sequence public.form_reference_seq to authenticated,service_role;
create function public.get_public_form(token text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title_ar',t.title_ar,'code',t.code,'version',t.version,'schema',t.schema,'branding',to_jsonb(b)-'id','prefill',l.prefill,'locked_fields',l.locked_fields,'allow_print',l.allow_print)
 from public.form_links l join public.form_templates t on t.id=l.template_id cross join public.site_settings b
 where l.token=$1 and l.is_active and t.is_active and (l.expires_at is null or l.expires_at>now()) and (l.max_submissions is null or l.submissions_count<l.max_submissions)
$$;
revoke all on function public.get_public_form(text) from public;
grant execute on function public.get_public_form(text) to anon,authenticated,service_role;
create function public.public_form_receipt(p_token text,p_request uuid,p_hash text) returns text language sql stable set search_path='' as $$
 select s.reference_code from public.form_submissions s join public.form_links l on l.id=s.link_id
 where l.token=p_token and s.request_id=p_request and s.submitter_ip_hash=p_hash
$$;
revoke all on function public.public_form_receipt(text,uuid,text) from public,anon,authenticated;
grant execute on function public.public_form_receipt(text,uuid,text) to service_role;
create function public.commit_public_form(p_token text,p_version int,p_data jsonb,p_hash text,p_request uuid,p_locked jsonb,p_locks text[]) returns text language plpgsql security definer set search_path='' as $$
declare l public.form_links; ref text;begin
 select * into l from public.form_links where token=p_token for update;
 if not found then raise exception 'link unavailable';end if;
 select reference_code into ref from public.form_submissions where link_id=l.id and request_id=p_request and submitter_ip_hash=p_hash;
 if found then return ref;end if;
 if l.prefill is distinct from p_locked or l.locked_fields is distinct from p_locks or not l.is_active or l.expires_at<=now() or l.submissions_count>=l.max_submissions or not exists(select from public.form_templates where id=l.template_id and is_active and version=p_version for share) then raise exception 'link unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_hash,0));
 if (select count(*) from public.form_submissions where submitter_ip_hash=p_hash and created_at>now()-interval '1 hour')>=10 then raise exception 'rate limit';end if;
 insert into public.form_submissions(template_id,template_version,link_id,data,source,submitter_ip_hash,request_id,created_by) values(l.template_id,p_version,l.id,p_data,'public_link',p_hash,p_request,null) returning reference_code into ref;
 update public.form_links set submissions_count=submissions_count+1 where id=l.id;return ref;
end $$;
revoke all on function public.commit_public_form(text,int,jsonb,text,uuid,jsonb,text[]) from public,anon,authenticated;
grant execute on function public.commit_public_form(text,int,jsonb,text,uuid,jsonb,text[]) to service_role;
insert into public.form_templates(code,title_ar,schema) values('transport-line-inventory','استمارة جرد خطوط النقل','{"sections":[{"type":"info_grid","columns":2,"fields":[{"key":"driver_name","label_ar":"اسم السائق","input":"text","required":true},{"key":"plate","label_ar":"رقم ونوع السيارة","input":"text","required":true},{"key":"line","label_ar":"عنوان الخط","input":"text","required":true},{"key":"phone","label_ar":"رقم الهاتف","input":"phone","required":true}]},{"type":"repeating_table","key":"crew","title_ar":"أسماء الكادر المتواجد في المركبة","min_rows":15,"max_rows":30,"show_row_number":true,"columns":[{"key":"full_name","label_ar":"الاسم الكامل","input":"text","width":3900,"required":true},{"key":"position","label_ar":"الوظيفة","input":"text","width":2900},{"key":"phone","label_ar":"رقم الهاتف","input":"phone","width":2966}]}]}');
do $$begin if exists(select from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.form_submissions;end if;end $$;
commit;
