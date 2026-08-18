# Process — How "Maya" Was Designed and Built

This document walks through the complete process behind this repository, in the order it actually happened:
understanding the problem, designing the system, building a working version, then hardening it toward
production. If `README.md` is the "how to run this," this is the "how and why it came to look like this."

---

## 1. Understanding the problem statement

The brief asked for two things, in this order, for a reason: **design before build**.

- A lending client ("Kapture Finance") needs an outbound voicebot that calls customers with an overdue EMI,
  and handles the conversation well enough that most calls don't need a human agent.
- The single hardest constraint, stated explicitly: **authentication must be state-enforced, not
  prompt-discretionary.** Everything downstream of that sentence — the state machine, the tool contracts, the
  later production upgrade — exists to satisfy it in a way that can be demonstrated, not just asserted.

Before writing anything, the actual collections lifecycle was mapped out by hand: greet → confirm identity →
verify → disclose → negotiate → resolve → log outcome. That lifecycle is the spine of every artifact that
followed.

## 2. Task 1 — High-Level Design first

Design was written *before* any code, deliberately, so the build had a spec to be checked against rather than
improvised. In order:

1. **Architecture & pipeline** — chose the pieces (Deepgram → GPT-4o → ElevenLabs/Cartesia, Vapi as the
   orchestrator) and budgeted latency per hop against the brief's implicit real-time constraint.
2. **State machine** — `INIT → AUTH_PENDING → AUTHENTICATED → NEGOTIATION → {PTP_COLLECTED | ESCALATED |
   DISPOSED} → CALL_ENDED`, with an explicit rule about what locks each transition. This came before the tool
   list, on purpose — the tools exist to serve the states, not the other way around.
3. **Intents & entities**, **tool/API specs**, **auth & data-safety rules**, **compliance guardrails**, the
   **edge-case matrix**, **escalation/disposition rules**, and **observability metrics** followed in that
   order — each section assumes the ones before it.
4. Output: `docs/HLD_Document.md`, rendered to `.docx`/`.pdf`, plus a standalone `docs/System_Architecture.png`
   diagram (built by hand once Mermaid-via-headless-Chromium turned out to be blocked in the build sandbox).

## 3. Task 2 — Build it (mock-server)

With the design fixed, the build followed the same order the HLD specified:

1. **System prompt** (`vapi/system_prompt.txt`) — translated the state machine and guardrails into the
   persona, states, and branches Maya follows on a call.
2. **Tool schemas** (`vapi/tool_definitions.json`) — one JSON Schema per tool in the HLD's API spec table.
3. **Mock webhook server** (`mock-server/server.js`) — the simplest thing that could implement those five
   tool contracts, in-memory, matching the brief's explicit "mocked endpoints are fine."
4. **Test cases** (`tests/test_cases.json`) — one per edge case in the HLD's matrix, written against the
   contracts rather than against any particular implementation.
5. **README** — setup steps, model/voice/transcriber rationale, and a placeholder for the one thing this
   process couldn't do end-to-end: an actual live Vapi call and recording.

## 4. Closing the gaps — checking the build against the brief line by line

Before treating Task 1/2 as done, the deliverables were re-checked against the brief itself rather than
against memory of it:

- Found `docs/System_Architecture.png` was referenced but never generated as a real image — fixed.
- Found the HLD was Markdown only, but the brief asked for "PDF or Doc" — added both via Pandoc/LibreOffice,
  with the diagram embedded, and visually verified the render.
- Found `get_account_details` was named in the brief's tool examples and in the HLD's own table, but never
  implemented — resolved by making it a **dialer-side, non-LLM-callable** endpoint instead of a sixth tool,
  since exposing it to the model would have reopened the exact leak the auth design was built to close. This
  is documented as a deliberate decision, not an omission.
- Found the bonus section's "note on testing at scale" had no corresponding artifact — added
  `tests/testing_at_scale.md` covering synthetic conversation generation, LLM-as-judge scoring, and
  adversarial testing.

This pass mattered as much as the original build: a spec is only as good as the check that nothing quietly
drifted from it.

## 5. Production hardening — making the core claim testable, not just written

The brief's central requirement — "auth must be state-enforced, not prompt-discretionary" — is easy to *write*
and hard to *prove*. The mock server proved it only insofar as you trusted the code reading it. So a second,
production-architected backend (`server/`) was built specifically to make that claim testable:

1. **Real Postgres**, not in-memory — installed, migrated, and queried directly to confirm the schema.
2. **Server-side state machine** (`server/src/state-machine/callStateMachine.js`) — every tool handler checks
   the call's state *as stored in the database* before doing anything, independent of what the model believes
   the state is.
3. **The actual test**: called `log_promise_to_pay` on a freshly-created, unverified call. It was rejected,
   and the rejection was written to an audit table with the exact reason. Then the full happy path was run and
   confirmed to persist correctly. This is the moment the brief's central requirement stopped being a design
   decision and became a demonstrated fact.
4. **Real integration adapters** — Twilio (real SDK, dry-run without credentials) and a KYC adapter (documented
   seam for a real provider, working mock in the meantime) — because "mocked endpoints are fine" for a
   take-home shouldn't mean "unable to become real later."
5. **Automated test suite** (`server/tests/enforcement.test.js`) — the manual verification above, turned into
   10 tests that run against a real test database and pass, so the guarantee is regression-tested, not just
   demonstrated once.
6. **Docker** — written for deployability, though unbuilt: no Docker daemon was available in the build
   sandbox to actually run it. Documented as untested rather than left to look verified.

## 6. Where the process stopped short, on purpose

Two things in the brief cannot be completed by this process, and are flagged rather than faked:

- **A live Vapi call and demo recording** — requires an actual Vapi account, phone number, and a human
  placing/receiving a call.
- **Real third-party integrations** — actual KYC verification (needs a licensed provider agreement) and actual
  SMS/WhatsApp delivery (needs live Twilio credentials). The code for both is written and tested up to the
  point where credentials would be dropped in.

Everything else in the brief — design, build, edge cases, compliance guardrails, tests, and now a production
path — is complete and independently checkable in this repository.

## 7. Reading order for a reviewer

If you're evaluating this end to end, the intended order is:

1. `docs/HLD_Document.pdf` — the design, read first, matching Section 2 above.
2. `vapi/system_prompt.txt` + `vapi/tool_definitions.json` — the design translated into a build.
3. `mock-server/` — the minimal working version.
4. `docs/PRODUCTION_ARCHITECTURE.md` + `server/` — the hardened version, with `server/tests/enforcement.test.js`
   as the concrete evidence for the brief's central compliance requirement.
5. `README.md` — setup instructions for either backend.
6. `tests/test_cases.json` + `tests/testing_at_scale.md` — how correctness was checked, and how it would be
   checked at scale.
