# CRITIQUE 006 — D-008: Retention / soft-delete + PII erasure exception

**Verdict: Endorse with changes; design-before-build — Significant. One-way door.**

## 1. The decision, restated
The **data model of deletion**: financial records immutable/soft-delete for 72
months+, while customer PII is erasable on request — and how a hard-deleted
customer coexists with the sales/invoice records that referenced them. Core-entity
model + legal posture.

## 2. Goal alignment
**O4 (Trust it)** — auditable history, compliance that survives scrutiny.

## 3. Strongest case for
CGST §36 (72 months from the annual-return due date, +1 year after final disposal
of an appeal) is a real statutory floor; soft-delete + retention-policy field +
branch tombstoning is the correct shape.

## 4. Strongest case against — the hard problem
India's DPDP right-to-erasure is **not absolute** — it yields to other legal
retention duties. A GST invoice **must** contain the recipient's name/GSTIN/
address (B2B) and must be retained 72 months. So "hard-delete customer PII on
request" collides head-on with "invoices referencing them must survive."

## 5. Resolvable design (bring back for sign-off)
Split **customer-master PII (erasable)** from **transaction-embedded PII (the
name/address as it appeared on a legally-required invoice — a frozen snapshot, not
a live FK)**. Erasure removes/pseudonymizes the master and de-links future use;
invoices keep their statutory snapshot.

## 6. The cost nobody mentioned
"Hard-delete PII" is not a `DELETE` — it's a **crypto-shredding or
pseudonymization pipeline** that must reach every copy: search indexes, caches,
logs, and the 6 years of Postgres backups (D-006). Erasure from backups is
famously hard → choose crypto-shredding (encrypt PII per subject, delete the key)
*or* a documented backup-expiry policy. A subsystem, not a field.

## 7. Reversibility
**One-way door** — core entity model + legal posture.

## 8. Required (design before any customer-PII schema — P1-13)
1. Master-PII vs invoice-snapshot-PII split.
2. Backup-erasure mechanism (crypto-shredding vs backup-expiry), coupled to the
   D-006 DR design.
3. Document, in the erasure UX, that financial-record retention lawfully overrides
   DPDP erasure.

The user explicitly asked for the design, not a pick — correct.
