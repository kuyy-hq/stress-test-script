-- CSV of the seeded users and their role access levels, the input of tools/mint.
-- Run with: psql "$TEST_DB_URL" -At -F, -f sql/export_users.sql > users.csv
select u.id, r.c_access, r.r_access, r.u_access, r.d_access
from "user" u
join role r on r.code = u.role
where u.created_by = 'stress'
order by u.name;
