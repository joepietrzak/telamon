---
type: Metric
title: Related concept
description: Exercises the non-standard `relationships` frontmatter.
relationships:
  - type: depends_on
    target: /loose/thing.md
    description: Reads the loose thing.
  - type: derived_from
    target: ./deprecated.md
  - type: depends_on
    target: collide/inner.md
  - type: documented_by
    target: https://example.com/handbook
  - type: depends_on
    target: /nowhere-at-all.md
  - target: /loose/thing.md
---

A concept that declares typed relationships in frontmatter.
