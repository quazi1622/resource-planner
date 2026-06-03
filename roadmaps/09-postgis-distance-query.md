# PostGIS Distance Query

```sql
select
  id,
  shop_name,
  descriptive_address,
  latitude,
  longitude,
  st_distance(
    geography(st_makepoint(longitude, latitude)),
    geography(st_makepoint(:doctor_lng, :doctor_lat))
  ) / 1000 as distance_km
from public.chemist_shops
where latitude is not null
  and longitude is not null
  and st_dwithin(
    geography(st_makepoint(longitude, latitude)),
    geography(st_makepoint(:doctor_lng, :doctor_lat)),
    5000
  )
order by distance_km asc
limit 20;
```
