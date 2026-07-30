-- Review-only report. This file never creates master records.
with legacy_values as (
  select btrim(hotel_slug) hotel_slug,
         btrim(table_number) original_value,
         lower(btrim(table_number)) exact_value,
         count(*) order_count,
         min(created_at) first_seen_at,
         max(created_at) last_seen_at
    from public.orders
   where btrim(coalesce(hotel_slug, '')) <> ''
     and btrim(coalesce(table_number, '')) <> ''
   group by btrim(hotel_slug), btrim(table_number), lower(btrim(table_number))
), candidates as (
  select hotel_slug,
         regexp_replace(exact_value, '^(table[[:space:]]*)', '', 'i') review_key,
         array_agg(original_value order by original_value) observed_values,
         sum(order_count) order_count,
         min(first_seen_at) first_seen_at,
         max(last_seen_at) last_seen_at
    from legacy_values
   group by hotel_slug, regexp_replace(exact_value, '^(table[[:space:]]*)', '', 'i')
)
select *, case
  when cardinality(observed_values) > 1 then 'REVIEW_NORMALIZATION_CONFLICT'
  when review_key !~ '^[a-z0-9][a-z0-9._ /-]{0,39}$' then 'REVIEW_INVALID_FORMAT'
  else 'READY_FOR_REVIEW'
end review_status
from candidates
order by hotel_slug, review_status desc, review_key;
