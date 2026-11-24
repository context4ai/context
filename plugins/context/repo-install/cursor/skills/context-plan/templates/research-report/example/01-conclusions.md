# Conclusions and recommendation

> **Conclusion**: both collections can be integrated, with different approaches.

## At a glance

| Collection | Kind | Approach |
| --- | --- | --- |
| Wiki A | Mirror plus summary | Register original upstream |
| Wiki B | Code-curated wiki | Standard production |

```chart
{"title": "Code check results", "legend": ["consistent", "partial", "inconsistent", "unverifiable"],
 "rows": [{"label": "Wiki A", "values": [7, 0, 2, 1]}, {"label": "Wiki B", "values": [11, 0, 0, 1]}]}
```

## Impact on navigation

```tree
Knowledge base
├── Business
│   └── Billing rules        [mod]
└── Operations
    └── Incident handbook    [dir]
        └── Escalation       [add]
```

Evidence lives in `docs/runbooks/billing/escalation-and-on-call-handbook.md`.
