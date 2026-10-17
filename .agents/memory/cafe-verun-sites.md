---
name: Café Verün role separation
description: Product requirement that customer, kitchen, and cashier workflows remain separate.
---

Keep the customer, kitchen, and cashier workflows on separate sites, not as role tabs in a shared interface.

**Why:** the user expects distinct roles and says a combined interface would make order access unsafe and the cashier workflow ineffective.

**How to apply:** preserve separate role-specific sites and do not add role-switching navigation. Treat API authorization as a separate concern; distinct paths do not secure shared API mutations.
