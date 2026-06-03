# SQL Haversine Distance Query

```sql
select
  id,
  shop_name,
  descriptive_address,
  latitude,
  longitude,
  (
    6371 * acos(
      cos(radians(:doctor_lat)) *
      cos(radians(latitude)) *
      cos(radians(longitude) - radians(:doctor_lng)) +
      sin(radians(:doctor_lat)) *
      sin(radians(latitude))
    )
  ) as distance_km
from public.chemist_shops
where latitude is not null
  and longitude is not null
  and (
    6371 * acos(
      cos(radians(:doctor_lat)) *
      cos(radians(latitude)) *
      cos(radians(longitude) - radians(:doctor_lng)) +
      sin(radians(:doctor_lat)) *
      sin(radians(latitude))
    )
  ) <= 5
order by distance_km asc
limit 20;
```
