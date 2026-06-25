---
name: engineering-grill
description: "Use when an engineering or product request is underspecified and should be turned into a crisp implementation brief, domain vocabulary, risks, and acceptance checks before coding."
mode: agent
disable-model-invocation: true
license: Inspired by Matt Pocock's engineering skill workflows.
---

# Engineering Grill

Use this when the user explicitly asks to be grilled, scoped, interviewed, or turned into implementation-ready work. Do not auto-run this for small fixes.

Goal: convert a fuzzy request into a buildable brief without stealing control from the user.

Process:
1. State the current interpretation in one sentence.
2. Ask the fewest high-leverage questions needed. Prefer one question at a time when answers could change direction.
3. Build a shared vocabulary. Capture domain terms the code should use consistently.
4. Identify the vertical slice: user-visible behavior, data touched, state changes, and failure cases.
5. Name risks: persistence, migrations, permissions, performance, design-system drift, test gaps.
6. End with acceptance checks the implementation can verify.

Output format:

## Brief
<one paragraph>

## Vocabulary
- `<term>`: <meaning>

## Scope
- In:
- Out:

## Risks
- <risk and mitigation>

## Acceptance Checks
- <testable behavior>

If the user already provided enough detail, skip the interview and produce the brief directly.
