---
name: Café Verün site and catalog boundaries
description: Separate role-specific sites and the branch-scoped product, recipe, and inventory policy.
---

Keep customer, kitchen, cashier, admin, and branch-manager workflows on separate sites, not as role tabs in a shared interface.

**Why:** the user expects distinct roles and says a combined interface would make order access unsafe and the cashier workflow ineffective.

**How to apply:** preserve separate role-specific sites and do not add role-switching navigation. Treat API authorization as a separate concern; distinct paths do not secure shared API mutations.

Firebase Authentication is the identity provider for all five sites. Require verified email for API access; PostgreSQL remains authoritative for application roles, branch assignment, orders, catalog, and inventory. Link returning local profiles to Firebase UIDs by normalized verified email, preserving their existing roles and branch assignments. Keep legacy Clerk IDs unused rather than deleting historical values. Admin staff creation makes a pending local profile; it does not send an email, so staff must sign up with the same email and verify it.

**Why:** the user requires Firebase instead of Clerk while preserving the existing Café Verün system and its data, and confirmed Email/Password is enabled in Firebase Console.

**How to apply:** do not migrate business data to Firebase or trust Firebase client claims for roles. Keep server-side role and branch checks. For any added OAuth provider, configure its authorized domains; before production rollout, apply the additive Firebase UID schema change to the production database.

The user also wants Google sign-in available on every portal that supports email login. Keep email/password available as an alternative; Google sign-in must resolve to the same verified-email profile and existing PostgreSQL role/branch checks.

**Why:** the user chose Google login everywhere email login is available.

**How to apply:** expose the Google provider on the customer, kitchen, cashier, admin, and branch-manager sign-in/sign-up screens. Enable Google in Firebase Console and authorize the relevant domains before testing or publishing.

Admin authors shared master products and recipes, including separate customer-facing ingredient/allergen information and kitchen-only preparation instructions. Branch menus may differ: branch managers control their branch's assortment, local categories, and stock; they do not edit master recipes or other branches. Archive master products instead of deleting them so order history remains intact.

**Why:** the user approved a shared admin-owned catalog with branch-specific menus, and branch managers need local control without changing master recipes or another branch's data.

**How to apply:** enforce these boundaries in API authorization and data scope as well as in each site's interface.
