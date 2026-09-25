# Domain documentation

Use a single glossary at CONTEXT.md and project decisions in docs/adr/. The planned monorepo does not by itself require multiple domain glossaries.

Before investigating or implementing behavior, read the glossary and ADRs relevant to that area. Use Organization, Knowledge Base, Document, Membership and Knowledge Base Grant consistently. Core owns reusable platform capabilities; the Knowledge reference application owns its replaceable business behavior.

When a design conflicts with an accepted ADR, identify the decision and resolve the conflict before silently changing it. Add terms when their meaning is resolved, and reserve ADRs for significant choices with real alternatives and meaningful reversal cost.

CONTEXT.md contains domain definitions, not implementation details, task state or raw meeting notes. The architecture spec and GitHub tickets carry implementation and acceptance contracts.
