---
title: "Curious, or Just Coached? The Interview Has Been Reverse Engineered."
description: "Why modern technical interviews probe beyond rehearsed answers, and how to prepare for retrieval instead of recitation."
pubDate: "2026-09-09"
tags:
  - Interviews
  - Software Engineering
  - Career
featured: false
---

Structured interviews are among the strongest validated predictors of job performance, with operational validity around r = .42.

The newest variant turns that structure against rehearsal.

## The Mechanism

The mechanism is simple.

Recalled experience produces verifiable detail under recursive probing. Fabricated experience thins out.

Ask why three layers down and a script collapses, because a script has no layer three.

So prepare retrieval, not recitation.

## Reconstruct Your Experiences

Before you interview, reconstruct three artefacts.

### 1. One system you built

Know its actual failure mode.

For example:

- Pool exhaustion
- Offsets committed before processing
- A full table scan under lock

Don't just remember what the system did.

Remember what actually went wrong.

### 2. One decision

Remember a decision where you knowingly accepted a tradeoff.

Be able to explain:

- What alternatives existed
- Why you rejected them
- What tradeoff you accepted
- What happened afterward

### 3. One anomaly

Remember an unexpected production or system behaviour.

Most importantly, remember the hypothesis you falsified first.

That detail is difficult to reproduce from a memorised script because it comes from actually having investigated something.

## Retain the Primitives

Keep the small technical details.

Latency percentiles.

Exact exception.

Configuration value.

Version number.

These are the markers that distinguish experience from rehearsed language.

A candidate can memorise an explanation of Kafka, Redis or transactions.

It is much harder to convincingly invent the exact failure, configuration and debugging path behind something they never actually worked on.

## Rehearse Your Boundary

There is another important skill.

Know exactly how far your mental model goes.

If someone keeps probing deeper, descend as far as your understanding genuinely holds.

Then say where it stops.

For example:

> "I understand the application-level behaviour, but I haven't worked directly with the internals of that component. I'd need to read the implementation or documentation to answer that accurately."

That is better than producing a fluent explanation of something you don't actually understand.

A clean epistemic edge signals real understanding.

Fluent slogans signal none.

## Report Asymmetry

Don't make every part of your experience sound equally exciting.

Name the work that energises you.

Also name the work you find tedious.

Real experience has asymmetry.

Some problems are interesting.

Some are repetitive.

Some systems are elegant.

Some are painful to maintain.

Uniform enthusiasm can sound like a memorised answer.

## The Real Preparation Strategy

The goal isn't to memorise better answers.

The goal is to reconstruct your actual experiences well enough that you can navigate them from multiple directions.

Think about:

```text
What happened?
      ↓
Why did it happen?
      ↓
What did I try?
      ↓
Why didn't that work?
      ↓
What changed?
      ↓
What tradeoff did I accept?
      ↓
What would I do differently now?