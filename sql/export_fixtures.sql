-- One JSON object with the ids the k6 scenarios need.
-- Run with: psql "$TEST_DB_URL" -At -f sql/export_fixtures.sql > fixtures.json
select json_build_object(
  'hot_event_id',       (select id from event where name = 'STRESS HOT 1'),
  'hot_event_ids',      (select coalesce(json_agg(id order by name), '[]'::json) from event where name like 'STRESS HOT %'),
  'control_event_ids',  (select coalesce(json_agg(id order by name), '[]'::json) from event where name like 'STRESS CONTROL %'),
  'race_event_ids',     (select coalesce(json_agg(id order by name), '[]'::json) from event where name like 'STRESS RACE %'),
  'open_event_id',      (select id from event where name = 'STRESS OPEN 1'),
  'fill_event_ids',     (select coalesce(json_agg(id), '[]'::json) from (select id from event where name like 'STRESS EVENT %' order by name limit 200) f),
  'pass_host_id',       (select id from "user" where name = 'STRESS PASSHOST'),
  'user_ids_without_username', (select coalesce(json_agg(id), '[]'::json) from (select id from "user" where created_by = 'stress' and username is null limit 50) x),
  'user_ids',           (select coalesce(json_agg(id), '[]'::json) from (select id from "user" where created_by = 'stress' and username is not null order by name limit 200) x)
);
