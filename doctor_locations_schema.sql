create table if not exists public.doctor_locations (
  id bigserial primary key,

  doc_id text not null unique,
  doctor_name text,
  designation text,
  team text,
  rse text,
  ase text,
  territory text,

  hospital_name text,
  hospital_address text,
  hospital_latitude numeric(10, 7),
  hospital_longitude numeric(10, 7),
  hospital_confidence text not null default 'pending'
    check (hospital_confidence in ('pending', 'high', 'medium', 'low', 'reject')),
  hospital_source text
    check (hospital_source in ('places_text_search', 'geocoding', 'none', 'error')),
  hospital_matched_name text,
  hospital_matched_address text,
  hospital_place_id text,
  hospital_location_type text,
  hospital_partial_match boolean not null default false,
  hospital_status text not null default 'pending'
    check (hospital_status in ('pending', 'processing', 'resolved', 'low_confidence', 'failed', 'needs_review')),
  hospital_retry_count integer not null default 0,
  hospital_last_attempted_at timestamptz,
  hospital_resolved_at timestamptz,
  hospital_error_message text,
  hospital_reasons text[],

  chamber_name text,
  chamber_address text,
  chamber_latitude numeric(10, 7),
  chamber_longitude numeric(10, 7),
  chamber_confidence text not null default 'pending'
    check (chamber_confidence in ('pending', 'high', 'medium', 'low', 'reject')),
  chamber_source text
    check (chamber_source in ('places_text_search', 'geocoding', 'none', 'error')),
  chamber_matched_name text,
  chamber_matched_address text,
  chamber_place_id text,
  chamber_location_type text,
  chamber_partial_match boolean not null default false,
  chamber_status text not null default 'pending'
    check (chamber_status in ('pending', 'processing', 'resolved', 'low_confidence', 'failed', 'needs_review')),
  chamber_retry_count integer not null default 0,
  chamber_last_attempted_at timestamptz,
  chamber_resolved_at timestamptz,
  chamber_error_message text,
  chamber_reasons text[],

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_doctor_locations_doc_id
on public.doctor_locations (doc_id);

create index if not exists idx_doctor_locations_territory
on public.doctor_locations (team, rse, ase, territory);

create index if not exists idx_doctor_locations_hospital_status
on public.doctor_locations (hospital_status, hospital_retry_count);

create index if not exists idx_doctor_locations_chamber_status
on public.doctor_locations (chamber_status, chamber_retry_count);

create index if not exists idx_doctor_locations_missing_hospital_coordinates
on public.doctor_locations (hospital_status, hospital_retry_count)
where hospital_address is not null
  and (hospital_latitude is null or hospital_longitude is null);

create index if not exists idx_doctor_locations_missing_chamber_coordinates
on public.doctor_locations (chamber_status, chamber_retry_count)
where chamber_address is not null
  and (chamber_latitude is null or chamber_longitude is null);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_doctor_locations_updated_at on public.doctor_locations;

create trigger trg_doctor_locations_updated_at
before update on public.doctor_locations
for each row
execute function public.set_updated_at();
