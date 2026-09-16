# `docs/`

Design notes about **what the data can and cannot answer**, written for the
phase that will act on it rather than for the phase that built it.

## What belongs here, and what does not

There are three places documentation already lives, and this is a fourth with a
narrow remit. Putting a file in the wrong one is how two documents end up
disagreeing.

| Where | What | Who maintains it |
|---|---|---|
| `AGENTS.md` | the conventions a change must follow | edited by hand, read before writing code |
| `ai-contexts/` | the specification, the tickets, security, operations | the project record — what was asked for and what shipped |
| `src/lib/db/*.md` | `ERD`, `STATES`, `INTEGRITY` | **generated** — `npm run db:docs`; never edit by hand |
| `docs/` | how existing data maps to work not yet built | edited by hand |

So: a ticket describing work to do belongs in `ai-contexts/tickets/`. A rule a
feature must obey belongs in `AGENTS.md`. A diagram of the schema is generated
and belongs nowhere else. What belongs **here** is the thing none of those
covers — an honest account of which questions the data we already store can
answer, which it cannot, and what each gap would cost to close.

These are hand-written and will go stale. Every claim cites the file and the line
it came from so the next reader can check rather than trust.

## Contents

| | |
|---|---|
| [`marketing-data.md`](./marketing-data.md) | download, save and search behaviour: what is captured, what is not, and the queries each follow-up campaign would need |
