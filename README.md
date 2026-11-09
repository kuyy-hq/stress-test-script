# stress-test-backend

Load and stress tests for the KUYY backend (`kuyy_backend`) and web (`kuyy-web`). They implement the
[KUYY Stress Test Plan](https://claude.ai/artifact/JSnUYnbKV82aSh4tjTwQ1t): the scenario ids below (A1, B1, ...) and the
hypotheses (H1 to H10) are the ones in that plan.

> **Never run normal load profiles against dev, beta, or prod.** Beta uses the production database, Redis, and Pub/Sub. Dev uses the
> production Postgres host and Redis server, runs cron, and sends real email and WhatsApp. A load test there is a
> load test on production. `make run` and the API tools first run `tools/preflight.sh`, which refuses any host that is not
> `localhost` or in `ALLOWED_HOSTS`, and always refuses `kuyy.id` and `kuyy.app`.

The production read-only scenarios are public event detail, public list (`a1`), anonymous activity search (`a4`), their parallel mix (`prod_read`), and web pages (`f1`). Smoke runs at 1 RPS for 30 seconds:

```sh
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=event_detail PROFILE=smoke TARGET_RPS=1
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=a1 PROFILE=smoke TARGET_RPS=1
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=a4 PROFILE=smoke TARGET_RPS=1
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=f1 PROFILE=smoke TARGET_RPS=1 WEB_URL=https://kuyy.app
```

The unlocked production load tiers each run for about one minute (15 seconds ramp, 45 seconds hold):

```sh
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=event_detail PROFILE=load TARGET_RPS=10 SCALE=0.05
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=event_detail PROFILE=load TARGET_RPS=100 SCALE=0.05
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=event_detail PROFILE=load TARGET_RPS=500 SCALE=0.05
```

Use the same load commands with `S=a1` to test `GET /public/events`, or `S=a4` for anonymous activity search. A4 respects
the production per-IP rate limiter, so 429 responses are expected above its limit and are counted separately.

Run all three read-only endpoints in parallel with `S=prod_read`. `TARGET_RPS` is the total rate, split almost equally:

```sh
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=prod_read PROFILE=load TARGET_RPS=10 SCALE=0.05
```

Test production web pages with `S=f1`; leave `TARGET_WEB_RPS` unset so preflight can enforce the rate:

```sh
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=f1 PROFILE=load TARGET_RPS=10 SCALE=0.05 WEB_URL=https://kuyy.app
```

For a 10-minute run (2.5 minutes ramp, 7.5 minutes hold), use `S=event_detail`, `S=a1`, `S=a4`, or `S=f1`:

```sh
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=a1 PROFILE=load TARGET_RPS=10 SCALE=0.5
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=a1 PROFILE=load TARGET_RPS=100 SCALE=0.5
ALLOW_PRODUCTION_READ_ONLY=true SPREAD_IP=false make run S=a1 PROFILE=load TARGET_RPS=500 SCALE=0.5
```

Run them in order and stop after any failed threshold, 5xx, or dropped iteration. Preflight refuses every other scenario,
profile, rate, duration, and KUYY database or web target.

## Two ways to prepare a run

| | API mode (default) | Database mode (optional) |
|---|---|---|
| Needs | the API and the accounts you chose | the stress database and the `AUTH_SECRET` of the stress API |
| Users | the accounts in `accounts.csv` | rows written by `sql/seed.sql` |
| Events and guests | created through the API (`POST /events`, `/join`) | written by SQL, so any size |
| Tokens | refresh tokens, 30-minute access tokens | signed by `tools/mint`, 24 hours |
| Tracking | every step is an API call with a run id | SQL, no run id on the server side |
| Targets | `login tokens setup verify teardown` | `db-prepare db-reseed db-cleanup invariants monitor explain churn` |

Use API mode to see what happens, and database mode when you need more guests than you have accounts, a soak longer than
30 minutes, or the database-side checks.

## What you need

| Item | Why |
|---|---|
| A **separate** stress environment: its own API, Postgres (13, like prod), Redis, and web | The target of every scenario |
| Accounts you chose, in `accounts.csv` | The users the scenarios act as |
| `k6` (`brew install k6`), or Docker with `K6_DOCKER=1` | The load generator |
| Node 20+ and Go 1.22+ | The tools (`tools/*.mjs`) and the token tool |

## First run (API mode)

```sh
cp .env.example .env                  # fill in BASE_URL; read the comments
cp accounts.example.csv accounts.csv  # replace the rows with your accounts
make login                            # a refresh token for each account that has none; asks for the e-mail codes
make setup                            # tokens + events + guests, all through the API
make smoke                            # one pass over every read: fix anything it reports first
make run S=a1 PROFILE=baseline        # baseline is 15% of TARGET_RPS (1000)
make run S=b1                         # the join race; then:
make verify                           # no event may hold more guests than its limit
make report                           # the latest result
make teardown                         # cancels the events that setup created
```

`make help` lists every target. Variables on the command line win over `.env`.

### The accounts you choose

`accounts.csv` has the columns `email,role,refresh_token`:

| role | What it does |
|---|---|
| `host` | creates the events |
| `passhost` | a host whose pass holders D1 pages; also creates events (the first `host` if none) |
| `user` | joins the events, and is the account that the read scenarios act as |

Use at least one `host` and one `user`. The `refresh_token` can stay empty: `make login` requests the e-mail code of each
such account (`GET /auth/emailotp`), asks for it on the terminal (or reads `--otp-file otps.csv` with `email,otp`), signs in, and
writes the token back. An e-mail address that does not exist yet is registered by the API on its first sign-in. Only use an
environment whose mailer does not send to real people. No commas inside a value.

### Tracking a run

- Every request, from k6 and from the tools, carries `X-Stress-Run: <RUN_ID>`. Search the server's logs for it.
  `RUN_ID` is the start time (`20261107-153000`) unless you set it: `make run S=i1 RUN_ID=before-index-fix`.
- `results/runs.csv` lists every run: run id, scenario, profile, target rate, target URL, start time.
- `results/<RUN_ID>-<scenario>-<profile>.json` is the k6 summary of that run. `make report` prints the latest.
- `state/created.json` lists every event that `make setup` created, with its host and run id. `make teardown` cancels
  exactly those, also from earlier runs.

## Scenarios

`make run S=<id> PROFILE=<profile> TARGET_RPS=<n>`. A profile is `smoke`, `baseline`, `load`, `stress`, `spike`, or
`soak` (shapes in `k6/lib/profiles.js`). Add `SCALE=0.1` to shorten every duration for a dry run.

| S | Plan id | What it sends | Notes |
|---|---|---|---|
| `smoke` | | every read once | run it first |
| `prod_read` | | public list, event detail, and anonymous search in parallel | total `TARGET_RPS` split three ways |
| `event_detail` | | `GET /public/events/{hot_event_id}` | one public event from `fixtures.json` |
| `a1` | A1 | `GET /public/events` | |
| `a2` | A2 | hot event detail and guests, plus a control event | `make report` checks hot p95 ≤ 2 x control |
| `a3` | A3 | `/events`, `/timeline`, `/v2/search/for-you`, `/v2/search/trending` | signed in |
| `a4` | A4 | `/v2/search/activities` | random `X-Forwarded-For`; 429 is counted, not failed |
| `b1` | B1 | `RACE_USERS` (500) users join one small event at once | never more users than accounts; reset first (below) |
| `d1` | D1 | pass holder list, 20 pages | the KUYY-70 regression needs a holder without username |
| `f1` | F1, F2 | kuyy-web pages | `PROFILE=spike` for F1, `PROFILE=soak` for F2 |
| `i1` | I1 | mixed traffic (70% browse, 20% feed and search, 4% join, 6% dashboard) | weights are proposals |
| `i2` | I2 | booking opens: `VISITORS` (2000) read, then join once | the open event has 200 seats |

**Resetting the write scenarios.** B1, I1 and I2 fill events, and a second run finds them full. In API mode:
`make teardown && make setup` (creates new events). In database mode: `make db-reseed`.

**Not implemented yet:** B2 (paid join and payment webhook: the signature of the payment stub is not decided),
B3 to B5, C1 to C3 (check-in), D2 to D4, E1 to E4 (Excel import), F3, G1, G2, and R1 to R5 (resilience: they need fault
injection such as Toxiproxy or stopping Redis). The plan describes them.

## The request rate: 1,000 per second

`TARGET_RPS` defaults to 1000: 100% of the initial target, in requests per second. The profiles scale
from it: baseline 150, load 1,000, soak 600, and stress and spike up to 3,000 (300%). Replace it with the measured
production peak when you have it.

- A1 to A4, B1 and F1 send one request per iteration, so their rate is exactly `TARGET_RPS`. I1 splits it over all its
  requests (the shares add up to 100%; a dashboard iteration is 6 requests, so its arrival rate is divided by 6). D1 counts
  dashboard visits of 21 requests each (`TARGET_VISITS`). I2 is set by visitors (`VISITORS=2000` is about 1,000 requests per second).
- The run is only a 1,000 rps test if it was delivered. `dropped_iterations` is a hard threshold: it fails the run when the
  target, or the machine running k6, could not keep up. `make report` prints the average rate. Ramp-up lowers the average.
- On one machine, k6, the API, and Postgres share the CPU, and `make run` prints a warning for that. Use it to find bugs and
  compare before and after, and use a separate environment for capacity. k6 caps its virtual users at 6,000 (`MAX_VUS`).
- **Access tokens last 30 minutes.** Run `make tokens` before every run. A run that outlasts the tokens refuses to start
  ("the tokens expire in 29 minutes, but this run needs 125 minutes"). For a longer soak use database mode (`make db-tokens`).

## Checks

| Command | Mode | What it answers |
|---|---|---|
| `make verify` | API | no event holds more guests than its limit (reads `members_count` and `limit` of each event) |
| `make invariants` | database | oversold events and `event_seat_count` drift |
| `make monitor` | database | connections by state, sessions waiting on an advisory lock, dead tuples, top statements |
| `make explain` | database | `EXPLAIN (ANALYZE, BUFFERS)` of "first three guests" and the seat sum on the hot event |
| `make churn ROUNDS=10` | database | leaves dead tuples in `user_event`, for the soak scenarios |

Run `make monitor` in a second terminal while a scenario runs. A pool of 10 connections per replica (prod's
`DB_MAX_OPEN_CONN`) shows as a ceiling in the connection count; joins queued behind one hot event show as
`waiting_on_advisory_lock`.

## What API mode cannot do

- **Size.** The API cannot write rows directly, so the hot event holds one guest per `user` account. 2,500 guests need 2,500
  accounts. For the H2 hypothesis (the "first three guests" query on an event with thousands of rows) use database mode.
- **KUYY-70.** A pass holder without a username needs a pass purchase by an account without one. The API cannot create that
  without a payment, so D1 only proves the paging and the rate in API mode.
- **The seat counter.** `make verify` sees `members_count`, not the `event_seat_count` table. Use `make invariants` for drift.
- **Cleanup is a cancel.** `make teardown` cancels events through the API; the rows stay in the database as cancelled.
  Use a stress environment that you can reset.

## Facts about the backend that the scripts rely on

Checked against `kuyy_backend` on `main` (7 November 2026):

- **The `Authorization` header is the raw token.** There is no `Bearer ` prefix (`authorize` and `parseToken` in `cmd/http/main.go`).
  A `Bearer` prefix makes the API read the request as anonymous or answer 403.
- **The API is mounted under `/api`.** `BASE_URL` is the host only.
- **Authorization is stateless.** A token is checked against `AUTH_SECRET` and its `c/r/u/d` access claims.
- **A title or description with 8 or more digits in a row is refused** (read as a phone or bank number). Event names from
  `make setup` use letters and short numbers only.
- **Seat reads come from `event_seat_count`** (migration 244), which the application keeps after each write to `user_event`.
  Migration 243 added `ix_user_event_event_seats` and `ix_user_event_event_created`. `sql/seed.sql` runs the backfill of
  migration 244. If you write seed data another way, run that backfill too.
- **A business refusal must not be a 403.** `kuyy-web` refreshes the token and resends the request on any 401 or 403, so a 403
  on a refusal is a bug. The `status_403` counter must stay at 0; a full event answers 422.
- **The join body** needs the answers to the three mandatory questions (`name`, `form_email`, `phone`), as `e2e/tests/activity_test.go` sends.
- **Rate limiters** (tollbooth, per replica): search activities 10 req/s per IP, search click 5, face check-in 3 per station,
  `/checkin/not-me` 1, `/auth/switch-studio` 5. The keyed ones read the second hop from the end of `X-Forwarded-For`,
  which the scripts randomize (`SPREAD_IP=false` turns it off). Whether the unkeyed limiters read that header is not checked.

## Things to know before trusting a result

- **Baseline "before the fix".** `main` already has migrations 243 and 244 (the fixes after the 4 November incident). To
  measure the situation before them, migrate the stress database only up to 242.
- **`TARGET_RPS`, the weights of I1, and the thresholds in `k6/lib/thresholds.js` are proposals** until you have production numbers.
- **The pass holder response shape** is not pinned: `passHolderPages` accepts a bare array or `data` / `items` /
  `participants`. `make smoke` fails with a clear check if none matches.
- **Run k6 on a different machine** from the one under test, and watch that the generator itself is not the bottleneck.

## Dry run without an environment

`make mock` starts a stand-in API on `:3399` (`tools/mock-api.mjs`) and writes fake accounts, tokens, and fixtures to `.mock/`.
In a second terminal: `make api-dry` runs setup, verify, and teardown against it, and `make dry` runs the k6 scenarios
(add `K6_DOCKER=1 MOCK_URL=http://host.docker.internal:3399` to use k6 in Docker). It proves that the scripts run and count
correctly. It measures nothing.

## Layout

```
accounts.csv   your accounts (ignored by git; copy accounts.example.csv)
k6/lib/        config, auth (tokens), http (raw Authorization, run id, counters), thresholds, profiles, actions
k6/scenarios/  one file per scenario
tools/         login, setup, verify, teardown (API mode); mint (database mode); preflight.sh, report.mjs, mock-api.mjs
sql/           database mode and checks: seed, cleanup, export_users, export_fixtures, invariants, monitor, explain_hot, churn
results/       k6 summaries and runs.csv (ignored by git)
state/         the events that setup created (ignored by git)
```

`accounts.csv` and `tokens.json` hold working credentials for the stress environment. They are written with mode 0600 and
ignored by git.
