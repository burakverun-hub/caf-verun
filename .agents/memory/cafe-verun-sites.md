---
name: Café Verün site and catalog boundaries
description: Separate role-specific sites and the branch-scoped product, recipe, and inventory policy.
---

Keep customer, kitchen, cashier, admin, and branch-manager workflows on separate sites, not as role tabs in a shared interface.

**Why:** the user expects distinct roles and says a combined interface would make order access unsafe and the cashier workflow ineffective.

**How to apply:** preserve separate role-specific sites and do not add role-switching navigation. Treat API authorization as a separate concern; distinct paths do not secure shared API mutations.

Admin authors shared master products and recipes, including separate customer-facing ingredient/allergen information and kitchen-only preparation instructions. Branch menus may differ: branch managers control their branch's assortment, local categories, and stock; they do not edit master recipes or other branches. Archive master products instead of deleting them so order history remains intact.

**Why:** the user approved a shared admin-owned catalog with branch-specific menus, and branch managers need local control without changing master recipes or another branch's data.

**How to apply:** enforce these boundaries in API authorization and data scope as well as in each site's interface.
