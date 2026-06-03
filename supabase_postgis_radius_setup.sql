create extension if not exists postgis;

alter table public.chemist_shops
add column if not exists geog geography(Point, 4326)
generated always as (
  case
    when latitude is not null and longitude is not null
    then st_setsrid(st_makepoint(longitude, latitude), 4326)::geography
    else null
  end
) stored;

create index if not exists idx_chemist_shops_geog
on public.chemist_shops
using gist (geog);

create index if not exists idx_chemist_shops_rse_ase_territory
on public.chemist_shops (rse, ase, territory);

alter table public.doctor_location_points
add column if not exists geog geography(Point, 4326)
generated always as (
  case
    when latitude is not null and longitude is not null
    then st_setsrid(st_makepoint(longitude, latitude), 4326)::geography
    else null
  end
) stored;

create index if not exists idx_doctor_location_points_geog
on public.doctor_location_points
using gist (geog);

create or replace function public.find_nearby_chemist_shops(
  p_doctor_location_point_id bigint,
  p_radius_km numeric default 2,
  p_limit integer default 20
)
returns table (
  id bigint,
  shop_name text,
  descriptive_address text,
  latitude numeric,
  longitude numeric,
  confidence text,
  status text,
  rse text,
  ase text,
  territory text,
  distance_km double precision
)
language sql
stable
as $$
  select
    c.id,
    c.shop_name,
    c.descriptive_address,
    c.latitude,
    c.longitude,
    c.confidence,
    c.status,
    c.rse,
    c.ase,
    c.territory,
    st_distance(c.geog, d.geog) / 1000.0 as distance_km
  from public.doctor_location_points d
  join public.centina ct
    on ct."Doc_ID"::text = d.doc_id
  join public.chemist_shops c
    on c.rse = trim(ct."RSE")
   and c.ase = trim(ct."ASE")
   and c.territory = trim(ct."Territory")
  where d.id = p_doctor_location_point_id
    and d.geog is not null
    and c.geog is not null
    and st_dwithin(c.geog, d.geog, p_radius_km * 1000)
  order by distance_km asc
  limit least(greatest(p_limit, 1), 20);
$$;
