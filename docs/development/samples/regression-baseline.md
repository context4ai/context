---
title: Recorded order regression
type: Rule
description: manual.md records fixture-2 in sandbox-a with record fixture-run-2.
timestamp: 2026-09-10T00:13:23.825Z
---

<a id="section-q04--context"></a>

# Recorded order regression

## 适用范围与版本

manual.md records fixture-2 in sandbox-a with record fixture-run-2.

<a id="section-q04--smoke"></a>

## 冒烟场景集

The documented smoke baseline selects ORD-01 for draft submission in sandbox-a.

<a id="section-q04--selection"></a>

## 变更影响与回归选择

For rename changes add ORD-02 and the filter preservation check. No execution result is provided for filter preservation.

<a id="section-q04--prerequisites"></a>

## 执行前提

Prepare disposable orders and an editor role before running the selected scenarios.

<a id="section-q04--records"></a>

## 结果记录入口

Consult fixture-run-2 for actual outcomes, separately from the chosen baseline.

<a id="section-q04--results"></a>

## 实际结果

ORD-01 passed; ORD-02 failed with validation-state-retained. Concurrent submission was not executed. These are the supplied historical results, not a current run.

<a id="section-q04--conclusion"></a>

## 结论与限制

The record does not approve release. Fix and rerun ORD-02 before evaluating the release criterion.
