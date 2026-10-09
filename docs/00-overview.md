# LIMS Brain — Overview

> Phase 1 foundation. The Social Media Engine and other downstream applications are **not** built in this phase.

## What this is

LIMS Brain is a persistent, evolving **product knowledge system** for Sampleify (our LIMS product). Its job is to understand Sampleify at roughly the depth of a senior product manager who has worked on it for years — capabilities, workflows, personas, customer problems, implementation detail, positioning, terminology, evidence, metrics, limitations, and the history of decisions.

It is explicitly **not** a "chat with my documents" app. Documents are raw input. The product of the system is a **structured, de-duplicated, relationship-aware knowledge model** that grows and self-corrects as new material arrives.

## The one-sentence contract

> Ingest messy sources → extract atomic knowledge → organize it into a typed, linked model with provenance and confidence → let a human curate it (including by **teaching it through chat**) → answer questions grounded only in what the Brain actually knows, with citations, while retaining the full history of what it believed and why it changed.

## Two knowledge sources

The Brain answers from **two** sources, always clearly distinguished: **internal** (ingested Sampleify knowledge, evidence, and human corrections) and **external** (live web research — search + page extraction via a `WebResearchProvider`). It uses internal knowledge when sufficient and researches the web when a question needs outside, current, or missing information; the user can also force research. Answers separate what internal sources establish, what external sources establish, what the Brain infers, and what remains unknown — with clickable citations (title, URL, excerpt, date). External findings never auto-become confirmed product knowledge; the user explicitly promotes useful findings, preserving provenance. Research sessions, queries, URLs, and findings are persisted and inspectable. See `02-design.md` §9.

## The V1 primary surface: a chat you can teach

In V1 the main way to use and test the Brain is a **full in-app chat experience** — not a Kiro conversation. You ask questions and get grounded, cited answers; when an answer is wrong or incomplete you correct it right there, and that correction becomes a **persistent, versioned knowledge change** that future answers reflect. A correction is a first-class knowledge update with provenance and history, not just another document. Every conversation, message, grounding set, correction, and resulting knowledge change is persisted and traceable, so you can reconstruct how the Brain arrived at its current understanding.

## Why this matters architecturally

LIMS Brain is the **reusable intelligence layer**. Future applications (Social Media Engine, Sales/Marketing assistant, Product-docs assistant, Demo assistant) are **consumers** of the Brain, not forks of it. They talk to the Brain through a stable internal API that returns **grounded** knowledge with evidence. That constraint drives most of the design decisions here.

## The nine system obligations (from the brief)

1. Ingest knowledge from heterogeneous sources (PDF, docs/text, URLs, notes, images).
2. Store the original source and exactly where each fact came from.
3. Extract and organize knowledge into a structured internal model.
4. Classify every claim: **confirmed fact / interpretation / outdated / conflicting / unknown**.
5. Let a human correct, edit, add, merge, archive, or invalidate knowledge.
6. Keep evolving as new information arrives.
7. Answer questions from accumulated knowledge.
8. Trace important answers back to underlying sources.
9. **Never invent** capabilities, metrics, customer results, or other factual claims.

Obligation 9 is the hard constraint that shapes retrieval and generation: the system must prefer "I don't know / the Brain has no supported evidence" over fabrication.

## Document map

| Doc | Purpose |
|-----|---------|
| `01-requirements.md` | What the system must do (EARS-style acceptance criteria) |
| `02-design.md` | Architecture, knowledge model, schema, pipelines, retrieval, UI |
| `03-tasks.md` | Ordered, checkable implementation plan |
| `04-risks-and-gaps.md` | Open questions, risks, and decisions needing input |

Steering lives in `.kiro/steering/` and encodes the durable conventions so future Kiro sessions stay aligned.
