# Stress tests for the KUYY backend. Read README.md first, and never point this at dev, beta or prod.
#
#   make help
#
# Two ways to prepare a run:
#   API mode (default)  accounts.csv -> make login / setup. Everything goes through the API, nothing needs database access.
#   Database mode      make db-prepare. Needs the stress database and the AUTH_SECRET of the stress API; tokens last 24 hours.
#
# Settings come from .env (copy .env.example). Variables on the command line win: make run S=a1 PROFILE=load

-include .env
export

BASE_URL    ?= http://localhost:3333
WEB_URL     ?= http://localhost:3000
TARGET_RPS  ?= 1000
PROFILE     ?= load
TOKEN_TTL   ?= 24h
SPREAD_IP   ?= true
SCALE       ?= 1
MAX_VUS     ?=
PRE_ALLOCATED_VUS ?=
S           ?=
DATA_DIR    ?=

# One id per make invocation. It is sent to the API as X-Stress-Run and names the result files and the line in results/runs.csv.
ifndef RUN_ID
RUN_ID := $(shell date +%Y%m%d-%H%M%S)
endif

# psql through a connection URL (database mode only). With Postgres in Docker use, for example:
#   PSQL='docker exec -i mypg psql -U postgres -d kuyy_stress -v ON_ERROR_STOP=1 -q -P pager=off'
# The SQL files are always sent on standard input, so both forms work.
PSQL ?= psql "$$TEST_DB_URL" -v ON_ERROR_STOP=1 -q -P pager=off

# k6 installed locally, or K6_DOCKER=1 to run grafana/k6 in Docker (then use host.docker.internal in BASE_URL).
ifdef K6_DOCKER
K6   := docker run --rm -i --add-host=host.docker.internal:host-gateway -v "$(CURDIR)":/work -w /work grafana/k6
DATA := /work
else
K6   ?= k6
DATA := $(CURDIR)
endif

K6_ENV = -e BASE_URL=$(BASE_URL) -e WEB_URL=$(WEB_URL) -e TARGET_RPS=$(TARGET_RPS) -e PROFILE=$(PROFILE) -e RUN_ID=$(RUN_ID) \
         -e SPREAD_IP=$(SPREAD_IP) -e DURATION_SCALE=$(SCALE) -e MAX_VUS=$(MAX_VUS) -e PRE_ALLOCATED_VUS=$(PRE_ALLOCATED_VUS) \
         -e TOKENS_FILE=$(DATA)/$(if $(DATA_DIR),$(DATA_DIR)/)tokens.json -e FIXTURES_FILE=$(DATA)/$(if $(DATA_DIR),$(DATA_DIR)/)fixtures.json

.DEFAULT_GOAL := help
.PHONY: help preflight login tokens setup verify teardown db-seed db-tokens db-fixtures db-prepare db-cleanup db-reseed churn \
        smoke run invariants monitor explain report test mock dry api-dry

help: ## Show this list
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /\t/' | awk -F'\t' '{printf "  %-12s %s\n", $$1, $$2}'

preflight: ## Refuse to continue unless every target is the stress environment
	@bash tools/preflight.sh

# ---- API mode -----------------------------------------------------------------------------------

login: preflight ## Get a refresh token for each account in accounts.csv that has none (asks for the e-mail codes)
	node tools/login.mjs

tokens: preflight ## Refresh the access tokens of accounts.csv into tokens.json (they last 30 minutes: run it before each run)
	node tools/setup.mjs --tokens-only

setup: preflight ## tokens + events + guests, all through the API -> tokens.json, fixtures.json, state/created.json
	node tools/setup.mjs

verify: preflight ## No event may hold more guests than its limit (through the API)
	node tools/verify.mjs

teardown: preflight ## Cancel the events that setup created (state/created.json), as their hosts
	node tools/teardown.mjs

# ---- Database mode (optional) -------------------------------------------------------------------

db-seed: ## Seed the test database (refuses a database name without "stress" or "loadtest")
	$(PSQL) $(SEED_VARS) < sql/seed.sql

db-tokens: ## Sign tokens for the seeded users into tokens.json, valid TOKEN_TTL (needs AUTH_SECRET of the stress API)
	@test -n "$$AUTH_SECRET" || { echo "AUTH_SECRET is not set (use the secret of the stress environment)"; exit 2; }
	$(PSQL) -At -F, < sql/export_users.sql > users.csv
	go run ./tools/mint -in users.csv -out tokens.json -ttl $(TOKEN_TTL)

db-fixtures: ## Write the ids the scenarios need into fixtures.json from the database
	$(PSQL) -At < sql/export_fixtures.sql > fixtures.json

db-prepare: db-seed db-tokens db-fixtures ## db-seed + db-tokens + db-fixtures

db-cleanup: ## Delete exactly the rows db-seed wrote
	$(PSQL) < sql/cleanup.sql

db-reseed: db-cleanup db-seed db-fixtures ## Reset the data between runs of the write scenarios (B1, I1, I2)

churn: ## Leave dead tuples behind in user_event: make churn ROUNDS=10
	@for i in $$(seq 1 $${ROUNDS:-5}); do $(PSQL) < sql/churn.sql > /dev/null; done; echo "churned $${ROUNDS:-5} rounds"

invariants: ## Database checks after a write scenario: oversold events, seat counter drift
	$(PSQL) < sql/invariants.sql

monitor: ## Connections, advisory lock waits, dead tuples, top statements (run it during a scenario)
	$(PSQL) < sql/monitor.sql

explain: ## Query plans of the suspected slow reads, on the hot event
	$(PSQL) < sql/explain_hot.sql

# ---- Running ------------------------------------------------------------------------------------

smoke: preflight ## One pass over every read: run it first
	@mkdir -p results
	$(K6) run $(K6_ENV) $(K6_ARGS) k6/scenarios/smoke.js

run: preflight ## Run one scenario: make run S=a1 PROFILE=load (TARGET_RPS defaults to 1000)
	@test -n "$(S)" || { echo "S is not set. Scenarios: smoke prod_read event_detail a1 a2 a3 a4 b1 d1 f1 i1 i2"; exit 2; }
	@mkdir -p results
	@file=$$(ls k6/scenarios/$(S).js k6/scenarios/$(S)_*.js 2>/dev/null | head -1); \
	  test -n "$$file" || { echo "no scenario named $(S)"; exit 2; }; \
	  test -f results/runs.csv || echo "run_id,scenario,profile,target_rps,base_url,started_at" > results/runs.csv; \
	  echo "$(RUN_ID),$(S),$(PROFILE),$(TARGET_RPS),$(BASE_URL),$$(date -u +%FT%TZ)" >> results/runs.csv; \
	  echo "run $(RUN_ID): $$file with PROFILE=$(PROFILE) TARGET_RPS=$(TARGET_RPS)"; \
	  $(K6) run $(K6_ENV) $(K6_ARGS) --tag run=$(RUN_ID) --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
	    --summary-export results/$(RUN_ID)-$(S)-$(PROFILE).json $$file

FILE ?= $(shell ls -t results/*.json 2>/dev/null | head -1)
report: ## Table of a k6 summary: make report [FILE=results/<run>-a2-load.json] (default: the latest)
	@test -n "$(FILE)" || { echo "no result file yet"; exit 2; }
	node tools/report.mjs $(FILE)

# ---- Development of the scripts -------------------------------------------------------------------

test: ## Unit tests of the token tool and a syntax check of every script
	go vet ./... && go test ./...
	@mkdir -p .tmp-check && for f in k6/lib/*.js k6/scenarios/*.js; do cp $$f .tmp-check/$$(echo $$f | tr '/' '_').mjs; done; \
	  for f in .tmp-check/*.mjs tools/*.mjs tools/lib/*.mjs; do node --check $$f || exit 1; done; rm -rf .tmp-check; echo "scripts parse"
	bash -n tools/preflight.sh
	@! env BASE_URL=https://kuyy.app WEB_URL=http://localhost ALLOWED_HOSTS= TEST_DB_URL= bash tools/preflight.sh >/dev/null 2>&1
	@for scenario in event_detail a1 a4; do env BASE_URL=https://kuyy.app WEB_URL=http://localhost ALLOWED_HOSTS= TEST_DB_URL= ALLOW_PRODUCTION_READ_ONLY=true S=$$scenario PROFILE=smoke TARGET_RPS=1 SPREAD_IP=false bash tools/preflight.sh >/dev/null || exit 1; done
	@for scenario in event_detail a1 a4 prod_read f1; do for rps in 10 100 500; do for scale in 0.05 0.5; do env BASE_URL=https://kuyy.app WEB_URL=http://localhost ALLOWED_HOSTS= TEST_DB_URL= TARGET_WEB_RPS= ALLOW_PRODUCTION_READ_ONLY=true S=$$scenario PROFILE=load TARGET_RPS=$$rps SCALE=$$scale SPREAD_IP=false bash tools/preflight.sh >/dev/null || exit 1; done; done; done
	@for rps in 10 100 500; do for scale in 0.05 0.5; do env BASE_URL=http://localhost WEB_URL=https://kuyy.app ALLOWED_HOSTS= TEST_DB_URL= TARGET_WEB_RPS= ALLOW_PRODUCTION_READ_ONLY=true S=f1 PROFILE=load TARGET_RPS=$$rps SCALE=$$scale SPREAD_IP=false bash tools/preflight.sh >/dev/null || exit 1; done; done
	@for rps in 1000 2500 5000 10000; do env BASE_URL=http://localhost WEB_URL=https://kuyy.app ALLOWED_HOSTS= TEST_DB_URL= TARGET_WEB_RPS= ALLOW_PRODUCTION_READ_ONLY=true S=f1 PROFILE=load TARGET_RPS=$$rps SCALE=0.05 SPREAD_IP=false bash tools/preflight.sh >/dev/null || exit 1; done
	@! env BASE_URL=https://kuyy.app WEB_URL=http://localhost ALLOWED_HOSTS= TEST_DB_URL= ALLOW_PRODUCTION_READ_ONLY=true S=a2 PROFILE=smoke TARGET_RPS=1 SPREAD_IP=false bash tools/preflight.sh >/dev/null 2>&1
	@! env BASE_URL=https://kuyy.app WEB_URL=http://localhost ALLOWED_HOSTS= TEST_DB_URL= ALLOW_PRODUCTION_READ_ONLY=true S=prod_read PROFILE=smoke TARGET_RPS=1 SPREAD_IP=false bash tools/preflight.sh >/dev/null 2>&1
	@! env BASE_URL=http://localhost WEB_URL=https://kuyy.app ALLOWED_HOSTS= TEST_DB_URL= TARGET_WEB_RPS=1000 ALLOW_PRODUCTION_READ_ONLY=true S=f1 PROFILE=load TARGET_RPS=10 SCALE=0.05 SPREAD_IP=false bash tools/preflight.sh >/dev/null 2>&1
	@! env BASE_URL=http://localhost WEB_URL=https://kuyy.app ALLOWED_HOSTS= TEST_DB_URL= ALLOW_PRODUCTION_READ_ONLY=true S=a1 PROFILE=load TARGET_RPS=10 SCALE=0.05 SPREAD_IP=false bash tools/preflight.sh >/dev/null 2>&1
	@! env BASE_URL=https://kuyy.app WEB_URL=http://localhost ALLOWED_HOSTS= TEST_DB_URL= ALLOW_PRODUCTION_READ_ONLY=true S=a1 PROFILE=load TARGET_RPS=10000 SCALE=0.05 SPREAD_IP=false bash tools/preflight.sh >/dev/null 2>&1
	@! env BASE_URL=https://kuyy.app WEB_URL=http://localhost ALLOWED_HOSTS= TEST_DB_URL= ALLOW_PRODUCTION_READ_ONLY=true S=event_detail PROFILE=load TARGET_RPS=50 SCALE=0.05 SPREAD_IP=false bash tools/preflight.sh >/dev/null 2>&1
	@! env BASE_URL=https://kuyy.app WEB_URL=http://localhost ALLOWED_HOSTS= TEST_DB_URL= ALLOW_PRODUCTION_READ_ONLY=true S=event_detail PROFILE=load TARGET_RPS=10 SCALE=1 SPREAD_IP=false bash tools/preflight.sh >/dev/null 2>&1
	@echo "preflight safety checks pass"

mock: ## Start the mock API on :3399 and write fake accounts, tokens and fixtures to .mock/ (it measures nothing)
	node tools/mock-api.mjs --fixtures .mock

api-dry: ## API mode against the running mock: setup, verify, teardown (make mock first)
	DATA_DIR=.mock BASE_URL=$${MOCK_URL:-http://localhost:3399} node tools/setup.mjs
	DATA_DIR=.mock BASE_URL=$${MOCK_URL:-http://localhost:3399} node tools/verify.mjs
	DATA_DIR=.mock BASE_URL=$${MOCK_URL:-http://localhost:3399} node tools/teardown.mjs

dry: ## Run smoke and short A1, A2, B1, D1, F1 and I1 runs against the running mock
	@for s in smoke a1 a2 b1 d1 f1 i1; do \
	  echo "== $$s"; \
	  $(MAKE) --no-print-directory run S=$$s PROFILE=smoke SCALE=0.2 TARGET_RPS=5 \
	    BASE_URL=$${MOCK_URL:-http://localhost:3399} WEB_URL=$${MOCK_URL:-http://localhost:3399} \
	    DATA_DIR=.mock K6_ARGS="-e RACE_USERS=100 -q" || exit 1; \
	done
