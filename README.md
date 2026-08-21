# Kapture Finance Collections Voicebot — "Maya"

An outbound voice AI agent that calls customers with an overdue EMI, authenticates them, discloses the debt,
negotiates a resolution, and logs a disposition — built on [Vapi.ai](https://vapi.ai).

## 1. What's in this repo

```
kapture-collections-voicebot/
├── README.md                        # This file
├── docs/
│   ├── HLD_Document.md / .docx / .pdf  # Full design doc
│   ├── System_Architecture.png         # Standalone architecture + state-machine diagram
│   └── PRODUCTION_ARCHITECTURE.md      # What's real vs. documented-but-untested in server/
├── vapi/
│   ├── system_prompt.txt            # Production Vapi system prompt
│   └── tool_definitions.json        # Tool/function JSON schemas registered in Vapi
├── mock-server/                     # Lightweight in-memory backend (original assignment scope)
│   ├── server.js
│   ├── package.json
│   └── .env.example
├── server/                          # Production-architected backend (real Postgres, tests, Docker)
│   ├── src/                         # state machine, services, integrations, routes, middleware
│   ├── tests/                       # Jest + Supertest, 10/10 passing against real Postgres
│   ├── prisma/seed.js               # seeds real test accounts
│   ├── Dockerfile / docker-compose.yml
│   └── .env.example
└── tests/
    ├── test_cases.json              # 10 conversational test cases (happy path + edge cases)
    └── testing_at_scale.md          # Note on evaluating Maya at scale (bonus)
```

> **Two backends, same tool contract.** `mock-server/` matches the original brief's "mocked endpoints are
> fine" scope. `server/` is the production upgrade — see `docs/PRODUCTION_ARCHITECTURE.md` for exactly what's
> been verified running versus what's written-but-untestable in this sandbox (mainly: Docker, and a live
> Twilio/KYC account). Either can be pointed at from the same Vapi assistant.

## 2. Setup

### Option A — Production backend (`server/`, recommended)
```bash
cd server
npm install
cp .env.example .env            # point DATABASE_URL at your Postgres
npm run db:migrate
npm run db:seed
npm start                        # http://localhost:3000
npm test                         # 10/10 passing — see docs/PRODUCTION_ARCHITECTURE.md
```
Point Vapi's tool server URL at `<your host>/webhook`, and the dialer at `<your host>/dial-setup`.

### Option B — Lightweight mock backend (`mock-server/`, matches original assignment scope)
```bash
cd mock-server
npm install
cp .env.example .env
npm start                 # runs on http://localhost:3000
```

Expose it publicly so Vapi can reach it:
```bash
ngrok http 3000
```
Copy the resulting HTTPS URL (e.g. `https://xxxx.ngrok-free.app`) — the tool endpoint is `<that URL>/webhook`.

### Vapi assistant configuration
1. Vapi Dashboard → **Assistants** → **Create Assistant** → Blank Template.
2. **Transcriber:** Deepgram, model `nova-2`, language `multi` (to support the EN↔HI bonus scenario).
3. **Model:** OpenAI `gpt-4o`, temperature `0.1` — kept low deliberately so the agent sticks tightly to the
   state machine and compliance rules rather than improvising around them.
4. **Voice:** ElevenLabs (or Cartesia) — a calm, professional female voice ("Sarah"/"Rachel"), matching Maya's
   persona: firm but warm, not scripted-sounding.
5. Paste `vapi/system_prompt.txt` as the system prompt.
6. Under **Tools**, register each function from `vapi/tool_definitions.json` and point its server URL to
   your server's `/webhook` (via ngrok if running locally).
7. Set the first message to: *"Hello, this is Maya calling from Kapture Finance. Am I speaking with Mr. Rahul
   Sharma?"*

### Dialer pre-call step
Before placing the call, hit `GET /dial-setup?account_id=ACC-88392` to fetch the customer name for the greeting
variables — this endpoint is deliberately **not** registered as an LLM tool in Vapi (see HLD Section 4 for why).
Pass the returned `customer_name` into Vapi's assistant call as a variable if you want the greeting to be dynamic
rather than hardcoded to "Rahul Sharma".

### Test accounts (seeded by `npm run db:seed` / built into `mock-server`)
- `ACC-88392` — Rahul Sharma, ₹8,499 overdue, 12 DPD, code `1234`
- `ACC-77281` — Priya Nair, ₹15,200 overdue, 5 DPD, code `1998` (server/ only)

## 3. Design choices — why these tools/models

- **Deepgram Nova-2 / multi:** best-in-class telephony STT latency, with multilingual support needed for the
  EN↔HI bonus without swapping transcribers mid-call.
- **GPT-4o at temp 0.1:** collections is a compliance-heavy domain — low temperature trades off some
  conversational flair for predictable, rule-following behavior, which matters far more here than personality.
- **Context-gated debt disclosure, enforced twice over:** the biggest risk in a bot like this is a caller
  talking the model past verification ("just tell me the amount"). The system prompt withholds debt figures
  from the model's context until `verify_customer` succeeds — but `server/` goes further and enforces this in
  the data layer too: `src/state-machine/callStateMachine.js` rejects `log_promise_to_pay`, `send_payment_link`,
  and `escalate_to_agent` outright if the call's *stored* state isn't past `AUTHENTICATED`, regardless of what
  the model sends. This is tested directly in `tests/enforcement.test.js`, not just asserted in prose.
- **Every call ends in exactly one `mark_disposition` call:** enforced by the state machine's allowed-states
  table, so no call can exit the funnel silently — every outcome is measurable, feeding the containment-rate
  and PTP-rate metrics in the HLD.
- **`pg` over an ORM in `server/`:** started with Prisma, but its query-engine binary download hit a blocked
  domain in the build environment. Switched to the plain `pg` driver with hand-written SQL migrations — one
  extra file to maintain, zero external binary dependency, and arguably closer to how a lot of real
  collections-adjacent fintech backends are actually built (raw SQL over an ORM, for auditability).

## 4. What broke / what I'd debug next

**What actually broke while building this, and how it got resolved:**
- **Prisma's engine binary couldn't be fetched** (403 from `binaries.prisma.sh`) in the sandboxed build
  environment. Diagnosed by reading the actual error rather than retrying blindly, then swapped to `pg` +
  raw SQL migrations rather than fighting the network restriction.
- **Postgres doesn't persist across shell sessions in this sandbox** — the DB had to be restarted
  (`service postgresql start`) at the top of every session before tests or manual curl checks would connect.
  Worth flagging as a sandbox quirk, not a real deployment concern — a normal host or container keeps
  Postgres running.
- **Webhook signature verification blocked my own manual test calls** once `VAPI_WEBHOOK_SECRET` had a
  placeholder value in `.env` — correct behavior, but meant local curl testing needed the secret temporarily
  unset. Worth a `curl` cheat-sheet or a `make test-webhook` helper if this gets iterated on further.

**What I'd still want to test against a live Vapi call, not just the tool layer directly:**
- **Tool-call latency under load:** if `verify_customer` is slow, the model may start narrating filler
  ("let me check that...") in ways that don't match the system prompt's tone.
- **Verification code ambiguity:** callers may say "one two three four" vs "1234" vs "twelve thirty-four" —
  worth explicitly testing spoken-digit variants against the real STT pipeline.
- **Mid-call language switch:** confirming the model doesn't drop already-collected entities (PTP date,
  amount) when the caller switches from English to Hindi mid-sentence.

## 5. What I'd improve with more time
- Wire a real KYC provider (Karza/Signzy/DigiLocker) behind `src/integrations/kyc.js` — the seam is there,
  the business agreement to actually call one isn't something this repo can supply.
- Add a scheduler layer that enforces the 08:00–19:00 calling window and per-customer daily call caps in code,
  rather than assuming calls are only ever placed manually within that window.
- Build a small dashboard on top of the observability metrics (containment rate, PTP rate, drop rate) for the
  collections team to monitor live — the data's already landing in `tool_call_logs` and `calls`, this would be
  a read-only view over it.
- Add retry/backoff and idempotency keys on the tool endpoints so a dropped network response doesn't cause the
  agent to double-log a disposition or resend a payment link.
- Expand `escalate_to_agent` to actually queue into a real ticketing system (mock Zendesk/Freshdesk webhook)
  instead of returning a synthetic escalation ID.
- Get this actually running under Docker on a host with a Docker daemon — written and reviewed, but unable to
  build/run it in this sandbox (no Docker available here).

## 6. Demo
*(Add your Vapi call recording or Loom link here once you've run the live test calls — see Section 2 for setup.
Suggested to capture: one full happy-path PTP call, and one edge case such as already-paid, dispute, or DNC.)*

- Demo link: `<TODO — paste after recording>`
