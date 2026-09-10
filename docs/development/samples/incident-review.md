---
title: Retry exhaustion incident
type: Guide
description: Repeated input validation failures exhausted the isolated worker queue.
timestamp: 2026-09-10T00:13:28.023Z
---

<a id="section-q07--triggers"></a>

# Retry exhaustion incident

## 触发条件

Repeated input validation failures exhausted the isolated worker queue.

<a id="section-q07--cause"></a>

## 根因与证据

The retained trace identifies an unlimited retry branch for invalid input; this is not inferred from queue depth alone.

<a id="section-q07--repair"></a>

## 修复和验证

A patch capped attempts at three. The recorded test observed three attempts and one retained item after four failures; production deployment was not verified.

<a id="section-q07--prevention"></a>

## 防复发检查

Keep the exhaustion test in the retry policy suite and inspect the retained-item counter after retry changes.

<a id="section-q07--references"></a>

## 来源与相关知识

Read manual.md and obtain the retained trace and test receipt before applying this incident conclusion to another environment.
