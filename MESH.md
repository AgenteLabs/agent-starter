# On the FlashyOS mesh

Create Mesh Agent is a package on the FlashyOS mesh — a scaffolding tool, to be published with its generator, its fixtures and its versioned releases.

Its AAO charter is [`flashyos.roles.json`](flashyos.roles.json) — the single source the mesh
handshake and the directory fragment derive from, so two hand-written files can
never disagree. It declares **five roles**:

| Role | Family | Human approval at/above | What it is accountable for |
|---|---|---|---|
| `template` | engineering | HIGH | Owns the scaffold itself — what gets written into a new agent's directory — and keeps it in sync with `@flashyos/agent`'s current surface, so a generated starter never imports an SDK shape that no longer exists. |
| `conformance` | engineering | LOW | Runs the generator against its fixtures and asserts every scaffold it writes actually installs, typechecks and passes its own starter test — a scaffold that only looks right is worse than one that visibly fails. |
| `release` | operations | MEDIUM | Cuts versioned releases with a changelog entry, so a version says what the generator will refuse to write and never moves once it ships. |
| `adoption` | growth | LOW | Helps a new participant get from `npx` to a running, mesh-registered agent, and records real scaffolds that reached a first task rather than a download count. |
| `review` | risk | HIGH | Reviews a template change before it lands, because a bad scaffold ships into every adopter's codebase at once, not just this one. |

**Five roles, and the FREE tier allows five agents — a coincidence, not a target.** The role count above comes from dividing this package's actual accountability (who answers for the template, who answers for whether a scaffold runs, who answers for a version, who answers for a new adopter reaching a first task, who answers for a change before it ships) into five distinct jobs; it was not shrunk, or grown, to fit a plan's agent cap. flashyos's own `CLAUDE.md` is explicit that the charter is never the thing trimmed to fit a quota — raising the tier or using the referral path is the correct move if a charter's real role count ever exceeded what a tier allows, and declaring fewer roles than the work actually has is the one move that is never taken. That this package's honest division happens to land on exactly five, matching every other charter drafted in this estate so far, is worth noting and not worth reading into.

The charter validates against the estate's dependency-free AAO checker. The
vendored `vendor-aao-check.mjs` is **not present until the generator package is
migrated**, so the command below is planned, not runnable here today:

<!-- planned -->
```bash
node vendor-aao-check.mjs validate flashyos.roles.json   # 0 issues
```

**Becoming a live organisation.** The charter is what a live org is provisioned
from. This runs from the flashyos monorepo (`packages/api/…` does not live in
this shell) on a machine that holds `DATABASE_URL`, so it too is planned rather
than runnable here:

<!-- planned -->
```bash
npx tsx packages/api/scripts/provision-org-from-charter.ts \
  --charter flashyos.roles.json --tier FREE
```

`directory.fragment.json` is this org's `directory/1` node: the org, one agent
per role, and the accountable person.

**A naming note, left for a human.** This repository is `AgenteLabs/agent-starter`; the package it will carry is `@flashyos/create-mesh-agent`, per flashyos's own package table (`packages/create-mesh-agent`). The two names disagree, and this charter's `slug` follows the repository rather than guessing which side a future rename should resolve to. Reconciling them — rename the repository, or publish under a different package name than the monorepo path implies — is a decision for whoever carries the migration, not one taken here.
