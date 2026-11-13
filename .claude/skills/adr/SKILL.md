---
name: adr
description: Write or update an architecture decision record in docs/decisions/ — numbering, front matter, superseding rules and the index. Use whenever a change makes or changes a decision (architecture, public API, infrastructure, security model), and when asked to record, supersede or amend an ADR.
---

# Architecture decision records

ADRs live in `docs/decisions/NNNN-short-slug.md` and are published on the website. They record
decisions, not the story of how we got there.

## Numbering

Take the next free number after the highest one in `docs/decisions/` **and** in open branches:
check `git branch -a` and open PRs (`gh pr list --state open`) for ADRs not merged yet.
**0020 is reserved** by the unmerged `claude/guest-bot-protection` branch. Never reuse a number.

## Front matter

```yaml
---
title: <the decision as a short sentence>
number: 22
status: accepted          # proposed | accepted | superseded
implementation: planned   # planned | skeleton | done
date: 2026-11-13
supersedes: []            # numbers this one replaces, fully or in part
superseded_by: []
notes: "<one line: what's built, what isn't>"
---
```

## Body

`# <title>`, then `## Context` (the problem and constraints, now), `## Decision` (what we do,
specific enough to check the code against), `## Consequences` (what follows, good and bad).
Plain, short sentences. No "we considered X" history beyond what explains the decision.

## Changing a decision

Old records are never rewritten; only their front matter changes.

- **Fully replaced:** the new ADR lists the old number in `supersedes`. The old one gets
  `status: superseded` and the new number in `superseded_by`.
- **Partly replaced** (one rule of a larger decision): the new ADR lists the old number in
  `supersedes` and says which part in its Context. The old one keeps `status: accepted` and gets
  the new number in `superseded_by`.
- Update `implementation` and `notes` on the new ADR as the work lands.

## Index

Add a row to the table in `docs/decisions/README.md`, keeping the column alignment. The Status
column says `accepted`, `superseded by NNNN`, or `accepted, partly superseded by NNNN`.

## Also

- The website builds the ADR into `/docs/decisions/<NNNN-slug>`; links between ADRs are relative
  (`[ADR 0019](0019-one-version-with-npm.md)`).
- Mention the ADR in the CHANGELOG entry it belongs to, when the change is user-facing.
- Tooling choices (lint, CI details) don't get an ADR unless they're architectural.
