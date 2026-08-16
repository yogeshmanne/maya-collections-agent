# Kapture Finance Collections Voicebot — "Maya"

An outbound voice AI agent that calls customers with an overdue EMI, authenticates them, discloses the debt,
negotiates a resolution, and logs a disposition — built on [Vapi.ai](https://vapi.ai).

## 1. What's in this repo

```
kapture-collections-voicebot/
├── README.md                   # This file
├── docs/
│   └── HLD_Document.md         # Full design doc (architecture, state machine, compliance, edge cases, metrics)
├── vapi/
│   ├── system_prompt.txt       # Production system prompt for the Vapi assistant
│   └── tool_definitions.json   # Tool/function JSON schemas registered in Vapi
├── mock-server/
│   ├── server.js               # Express webhook implementing all 5 tool endpoints
│   ├── package.json
│   └── .env.example
└── tests/
    ├── test_cases.json         # 10 test cases covering the happy path + edge cases
    └── testing_at_scale.md     # Note on evaluating Maya at scale (bonus)
```

## 2. Setup

### 2.1 Mock webhook server
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

### 2.2 Vapi assistant configuration
1. Vapi Dashboard → **Assistants** → **Create Assistant** → Blank Template.
2. **Transcriber:** Deepgram, model `nova-2`, language `multi` (to support the EN↔HI bonus scenario).
3. **Model:** OpenAI `gpt-4o`, temperature `0.1` — kept low deliberately so the agent sticks tightly to the
   state machine and compliance rules rather than improvising around them.
4. **Voice:** ElevenLabs (or Cartesia) — a calm, professional female voice ("Sarah"/"Rachel"), matching Maya's
   persona: firm but warm, not scripted-sounding.
5. Paste `vapi/system_prompt.txt` as the system prompt.
6. Under **Tools**, register each function from `vapi/tool_definitions.json` and point its server URL to
   `<ngrok URL>/webhook`.
7. Set the first message to: *"Hello, this is Maya calling from Kapture Finance. Am I speaking with Mr. Rahul
   Sharma?"*

### 2.3 Dialer pre-call step
Before placing the call, hit `GET /dial-setup?account_id=ACC-88392` to fetch the customer name for the greeting
variables — this endpoint is deliberately **not** registered as an LLM tool in Vapi (see HLD Section 4 for why).
Pass the returned `customer_name` into Vapi's assistant call as a variable if you want the greeting to be dynamic
rather than hardcoded to "Rahul Sharma".

### 2.4 Test accounts (mock data)
- Account `ACC-88392` (Rahul Sharma) accepts verification code `1234` or `1995`.

## 3. Design choices — why these tools/models

- **Deepgram Nova-2 / multi:** best-in-class telephony STT latency, with multilingual support needed for the
  EN↔HI bonus without swapping transcribers mid-call.
- **GPT-4o at temp 0.1:** collections is a compliance-heavy domain — low temperature trades off some
  conversational flair for predictable, rule-following behavior, which matters far more here than personality.
- **Context-gated debt disclosure over prompt-only instruction:** the biggest single risk in a bot like this is
  a user talking the model past verification ("just tell me the amount"). Rather than relying purely on the
  system prompt telling the model not to disclose, the *actual debt figures are withheld from the model's
  context* until `verify_customer` returns `verified: true`. This turns a "the model should behave" guardrail
  into a "the model literally doesn't have the data" guardrail — much harder to talk past.
- **Every call ends in exactly one `mark_disposition` call:** this was a deliberate design constraint so that
  no call can exit the funnel silently — every outcome is measurable, which matters for the containment-rate
  and PTP-rate metrics in the HLD.

## 4. What broke / what I'd debug next
*(Fill this in from your actual test calls — a few things to watch for based on the design:)*
- **Tool-call latency under load:** if `verify_customer` or `log_promise_to_pay` are slow, the model can start
  narrating filler ("let me check that...") in ways that don't match the system prompt's tone — worth testing
  with artificial latency injected into the mock server.
- **Verification code ambiguity:** callers may say "one two three four" vs "1234" vs "twelve thirty-four" —
  Deepgram/GPT-4o generally normalize this well, but it's worth explicitly testing spoken-digit variants.
- **Mid-call language switch:** worth confirming the model doesn't reset or forget already-collected entities
  (PTP date, amount) when the caller switches from English to Hindi mid-sentence.

## 5. What I'd improve with more time
- Move the mock in-memory datastore to a real DB (Postgres) with a proper `accounts`/`ptp`/`dispositions` schema.
- Add a scheduler layer that enforces the 08:00–19:00 calling window and per-customer daily call caps, rather
  than assuming calls are only ever placed manually within that window.
- Build a small dashboard on top of the observability metrics (containment rate, PTP rate, drop rate) for the
  collections team to monitor live.
- Add retry/backoff and idempotency keys on the tool endpoints so a dropped network response doesn't cause the
  agent to double-log a disposition or resend a payment link.
- Expand `escalate_to_agent` to actually queue into a real ticketing system (e.g. a mock Zendesk/Freshdesk
  webhook) instead of just returning an escalation ID.

## 6. Demo
*(Add your Vapi call recording or Loom link here once you've run the live test calls — see Section 2 for setup.
Suggested to capture: one full happy-path PTP call, and one edge case such as already-paid, dispute, or DNC.)*

- Demo link: `<TODO — paste after recording>`
