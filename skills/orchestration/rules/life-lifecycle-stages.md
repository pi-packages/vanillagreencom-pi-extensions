---
title: Lifecycle Stages
impact: HIGH
impactDescription: Agent lifecycle confusion causes missed or duplicated work
tags: life
---

## Lifecycle Stages

**Impact: HIGH (Agent lifecycle confusion causes missed or duplicated work)**

```
1. LAUNCH       Create agent with delegation prompt
2. WORK         Agent executes workflow, processes assigned work
3. RETURN       Agent sends completion results to orchestrator
4. IDLE/REDEL   Agent available for re-delegation (fix cycles, pending children)
5. SHUTDOWN     Orchestrator terminates agent when all work complete
```
