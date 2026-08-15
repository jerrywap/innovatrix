# 16 — AI Foundation & Conversation Engine

**Bucket:** §10.1–10.6 · **Depends on:** 03 · **Blocks:** 17, 18 · **Size:** L
**Spec:** §71 (AI architecture), §72 (persistence), §73 (safety boundaries), §17 (assistant principles), §104

## Why
§104 is the governing constraint: **AI is a layer, not the platform.** The system must stay functional when the
provider is down, when output is wrong, and when staff need to override it. This ticket builds the shared engine
both assistants (17, 18) sit on, so the guardrails exist in exactly one place.

## Provider

**OpenRouter**, an OpenAI-compatible gateway. Use the **OpenAI SDK** pointed at OpenRouter's base URL — *not*
`@anthropic-ai/sdk`, and not raw fetch.

```bash
npm install openai zod
```

```ts
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: serverEnv().OPENROUTER_API_KEY,
  baseURL: serverEnv().OPENROUTER_BASE_URL,       // https://openrouter.ai/api/v1
  defaultHeaders: {
    // OpenRouter attribution — shows the app on their dashboard/leaderboards
    "HTTP-Referer": serverEnv().OPENROUTER_SITE_URL ?? "",
    "X-Title": serverEnv().OPENROUTER_APP_NAME,
  },
});
```

- Model comes from `OPENROUTER_MODEL` (`vendor/model`, e.g. `anthropic/claude-opus-4.1`) so it changes without a
  deploy. Claude is still reachable — we simply don't call Anthropic directly.
- **What the gateway buys us:** one key and one bill across vendors, per-model cost visibility, and a
  `models` array for automatic failover when a provider is down — which is exactly the §104 requirement that
  the platform keep working when one AI provider misbehaves.
- **What it costs us:** vendor-specific features do not pass through uniformly. Anthropic extended thinking,
  prompt caching and the `parse()` structured-output helper are Anthropic-SDK conveniences that either behave
  differently or are unavailable through an OpenAI-compatible surface. Plan around the common denominator:
  chat completions, streaming, tool calling, and JSON-schema response format.
- **Structured output:** use `response_format: { type: "json_schema", json_schema: { ..., strict: true } }`
  and validate the result with Zod anyway. Support varies by underlying model, so the Zod parse is the real
  guarantee, not the gateway's promise. **Verify the exact request shape against OpenRouter's current docs
  before writing the client** — do not assume it matches OpenAI's verbatim.
- Cost/usage: OpenRouter returns usage on the response and exposes a generation endpoint for exact spend.
  Record model, tokens and cost per conversation (§10.1).

## Scope

### AI service (`src/services/ai/`)
- `client.ts` — singleton OpenAI-SDK client bound to OpenRouter, typed error mapping, bounded retries with
  backoff, request timeout, and an optional `models` fallback list.
- `chat.ts` — `streamAssistantTurn({ conversation, userMessage })` using
  `client.chat.completions.create({ stream: true })`, accumulating deltas to persist the complete turn.
  Stream to the browser over an SSE route handler (`app/api/ai/[conversationId]/route.ts`).
- `extract.ts` — **structured extraction** via `response_format: { type: "json_schema", strict: true }`,
  then `schema.parse()` on the result. Never regex a model's prose; never trust the gateway's schema
  enforcement without the Zod parse behind it.
- `prompts/` — versioned system prompts as plain modules. Record `promptVersion` on every conversation so a
  behaviour change is traceable.
- **Prompt shape**: keep the stable system prompt and product context first and volatile content last. Some
  providers cache a stable prefix automatically behind the gateway; none of the behaviour here may *depend*
  on that happening.
- `usage.ts` — log model, tokens in/out, cache hits, latency and estimated cost per conversation. Cost per
  request is a product metric here, not an afterthought.

### Conversation persistence (§72)
`aiConversations` (ticket 02): user, organization, `contextType`, product + version context, messages,
`structuredAnswers`, `suggestedFeatures`, `confirmedRequirements`, `summary`, `status`, `submittedRequestId`.
- Resumable: leaving and returning continues the same conversation.
- The **full transcript is retained** and readable by authorized staff (§19) — it is evidence of what was agreed.
- Org-scoped; a conversation is never readable across organizations.

### Chat UI (`src/features/requirements/components/`)
- Streaming message list, typing indicator, markdown rendering (sanitised).
- **One logical question at a time** (§17) — the prompt enforces it and the UI reinforces it.
- Suggested-answer chips when the assistant offers options, alongside free text (§17).
- "Save and continue later", "start over", and a visible **"switch to a form instead"** escape hatch.
- Mobile-first: this conversation will often happen on a phone.

### Guardrails (§73) — enforced in the system prompt **and** in code
The assistant must never: set or confirm final pricing · promise delivery dates · approve contracts or refunds ·
confirm technical feasibility · expose internal staff notes · reference another customer's data.
- Encode these as explicit prompt rules **and** as a post-generation check that flags responses containing
  currency amounts or date commitments for review before display.
- Distinguish `confirmedRequirements` (customer said yes) from `assumptions` (AI inferred) in the data model —
  §17 requires they stay distinguishable, and staff must see which is which.

### Degradation (§104, §6 acceptance)
If the provider errors, rate-limits or refuses: show a plain apology, keep everything captured so far, and offer
a **structured manual form** that produces the same requirements object. A customer must never be unable to
submit a request because the AI is down.

## Acceptance criteria
- [ ] A conversation streams token-by-token and survives a page refresh mid-interview.
- [ ] Structured extraction returns a schema-valid object; a malformed model response is retried, then falls
      back to the manual form rather than saving garbage.
- [ ] With `OPENROUTER_API_KEY` unset, or the gateway returning 5xx, the assistant degrades to the manual form
      and the customer can still submit.
- [ ] The assistant refuses to quote a price or promise a date when pushed three different ways.
- [ ] Confirmed requirements and AI assumptions are separate fields end-to-end.
- [ ] A conversation belonging to Org A is unreadable by Org B, including via the SSE route.
- [ ] A `finish_reason` of `length` or `content_filter` is handled without a crash or a silently truncated
      requirements summary.
- [ ] Token usage and estimated cost are recorded per conversation.
- [ ] No prompt or key appears in the client bundle (grep the build output).
- [ ] Swapping `OPENROUTER_MODEL` to a different vendor's model runs the same conversation end to end —
      proving nothing in the app depends on a single vendor's response shape.
