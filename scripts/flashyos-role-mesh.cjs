/**
 * The pure logic behind flashyos-branch-mesh-sync.mjs — which branch reports
 * under which role, and how a role's assignments collapse into one heartbeat.
 *
 * Deliberately CommonJS and deliberately dependency-free. The sync runs in CI
 * from a sparse checkout of a couple of files with no package.json, so it can
 * import nothing; and this repository's Jest runs CommonJS, so a `.mjs` module
 * cannot be required from a test. A `.cjs` file is the one format both the ESM
 * script and the CJS test can load natively, with no transform and no new
 * dependency.
 */

const fs = require('fs');

const RESERVED_NAMESPACES = ['team', 'feature', 'project', 'incident'];

/** Ordered by how much attention each deserves; a role reports its busiest. */
const STATUS_PRIORITY = ['IDLE', 'REVIEWING', 'BUILDING', 'INCIDENT'];

function statusForAge(ageMs) {
  const HOUR = 3600 * 1000;
  if (ageMs < 6 * HOUR) return 'BUILDING';
  if (ageMs < 72 * HOUR) return 'REVIEWING';
  return 'IDLE';
}

/**
 * Accept either a list of names or a list of charter entries.
 *
 * Callers that do not care about succession — most tests, and anything holding
 * a plain list — keep passing strings and get the old behaviour exactly.
 */
function normalizeRoles(roles) {
  return roles.map((r) => (typeof r === 'string' ? { name: r, renamedFrom: [] } : r));
}

/** The canonical names a charter declares, in charter order. */
function roleNames(roles) {
  return normalizeRoles(roles).map((r) => r.name);
}

/**
 * Resolve a name — current or prior — to the role that answers to it today.
 *
 * Two passes, deliberately. A current name always beats somebody else's prior
 * name: if `intelligence` used to be `atlas` and a later role is *named*
 * `atlas`, then `atlas/x` is the later role's work, not a ghost of the rename.
 * One pass in charter order would hand it to whichever appeared first.
 *
 * Case-insensitive because branches are typed by hand —
 * `Forge/Velocity-deploy-frequency` and `forge/velocity-ops` both exist on this
 * remote, and only one of them would resolve under an exact match.
 */
function resolveRole(name, roles) {
  const wanted = name.toLowerCase();
  const declared = normalizeRoles(roles);
  for (const role of declared) {
    if (role.name.toLowerCase() === wanted) return role.name;
  }
  for (const role of declared) {
    if ((role.renamedFrom || []).some((prior) => prior.toLowerCase() === wanted)) return role.name;
  }
  return null;
}

/**
 * The role a branch reports under, or null when it reports under none.
 *
 * Returning null is the point of this function. `main`, a reserved namespace,
 * and anything whose first segment is not a declared role all produce nothing
 * — no agent, no tile, no entry in the public directory.
 *
 * A branch under a role's *prior* name still reports, via `renamedFrom`. Twenty
 * of the branches on this remote were opened under codenames, and renaming a
 * branch breaks every open pull request and link pointing at it. So the charter
 * resolves the old segment and the branches age out as they merge; without this
 * the rename would empty the roster instead of relabelling it.
 */
function roleForBranch(branch, roles) {
  if (!branch.includes('/')) return null;
  const head = branch.split('/')[0];
  if (RESERVED_NAMESPACES.includes(head.toLowerCase())) return null;
  return resolveRole(head, roles);
}

/** What a declared role reports when it has no assignment in flight. */
const NO_ASSIGNMENT = 'No assignment in flight';

/**
 * Group assignments under their roles.
 *
 * Each entry becomes one heartbeat: the role, its busiest status, and a task
 * line naming what it is actually working on. A role with several assignments
 * reports the most recent by commit plus a count — which is what someone
 * reading the roster wants, rather than five tiles for one colleague.
 *
 * **Every declared role reports, assignment or not.** A role is a standing
 * responsibility that exists whether or not work is in flight — that is the
 * definition the standard publishes, and a roster that dropped the quiet ones
 * would contradict it. So a role with nothing open reports IDLE and says so,
 * rather than vanishing.
 *
 * This is not the inflation the branch sync was fixed to stop. The difference
 * is what causes an entry to exist: a charter is a human-authored, committed,
 * reviewable declaration of responsibility, and a branch name is not. Ten
 * declared roles of which six are idle is a true and useful sentence about an
 * organization. A hundred and two branch names is not a sentence at all.
 */
function groupByRole(assignments, roles) {
  const byRole = new Map();

  // Seed with every declared role so the quiet ones survive to the output.
  for (const name of roleNames(roles)) byRole.set(name, []);

  for (const a of assignments) {
    const role = roleForBranch(a.branch, roles);
    if (!role) continue;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(a);
  }

  return [...byRole.entries()]
    .map(([role, items]) => {
      if (items.length === 0) {
        return { role, status: 'IDLE', assignments: [], currentTask: NO_ASSIGNMENT };
      }
      const sorted = [...items].sort((x, y) => y.committedAt - x.committedAt);
      const newest = sorted[0];
      const busiest = sorted
        .map((i) => i.status)
        .reduce((a, b) => (STATUS_PRIORITY.indexOf(b) > STATUS_PRIORITY.indexOf(a) ? b : a), 'IDLE');
      const others = sorted.length - 1;
      // Cut at the branch's own first slash, not at the role's length. Under
      // succession the two differ — `hermes/retention` reports under
      // `retention`, and slicing ten characters off it yields `tention`.
      const workstream = newest.branch.slice(newest.branch.indexOf('/') + 1);
      return {
        role,
        status: busiest,
        assignments: sorted.map((i) => i.branch),
        currentTask:
          `${workstream}: ${newest.message}`.slice(0, 160) + (others > 0 ? ` (+${others} more)` : ''),
      };
    })
    .sort((a, b) => a.role.localeCompare(b.role));
}

/**
 * The charter's roles, each with any prior names it still answers to.
 *
 * Returns entries rather than bare names because succession has to survive the
 * trip: a loader that dropped `renamedFrom` here would leave `roleForBranch`
 * with nothing to resolve, which is precisely the bug this fixes.
 */
function loadRoles(file) {
  if (!fs.existsSync(file)) {
    // Refusing is the whole point. The version of this sync that had no charter
    // to consult filled the gap by making every branch an agent, which is what
    // put `main` and `claude-source-code-audit-bxq1t0` on a public directory as
    // colleagues. An org with no charter has no roles, and publishing nothing
    // is the correct output rather than a failure to work around.
    throw new Error(
      `No charter at ${file}.\n\n` +
        'This org declares no roles, so no branch reports under one and this sync\n' +
        'has nothing to publish.\n\n' +
        'Write flashyos.roles.json — { "org": "<slug>", "roles": [{ "name", "family",\n' +
        '"purpose" }] } — naming the standing responsibilities this org actually has.\n' +
        'See https://flashyos.com/standard.',
    );
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed.roles) || parsed.roles.length === 0) {
    throw new Error(`${file} declares no roles`);
  }
  return parsed.roles.map((r) => ({
    name: r.name,
    renamedFrom: Array.isArray(r.renamedFrom) ? r.renamedFrom : [],
  }));
}

/**
 * What KIND of refusal the mint endpoint returned.
 *
 * The sync used to treat every non-ok response the same way: print it, count
 * it failed, and if every role failed, exit 1. That is right for a broken
 * bootstrap key and wrong for a plan limit, and the difference is not
 * cosmetic — flashy-academy's sync ran 975 times dying at a missing `npx`
 * bin, then began dying at
 *
 *   403 This org's FREE tier allows up to 5 agents.
 *
 * and nothing anywhere said the cause had changed. A red check that has
 * always been red is read by nobody, so the run that finally carried real
 * information looked exactly like the 975 before it.
 *
 * Three verdicts, which is this estate's existing idiom — `reachability.mjs`
 * separates `unreachable`, `ambiguous` and `refused` for the same reason: a
 * check that cannot tell one cause from another must say so rather than pick.
 *
 *   `capped`   the platform refusing on quota. Nothing in the repository can
 *              fix it; it is a decision about a plan, and it is named as such.
 *   `refused`  the platform refusing on the merits — a 400 naming the rule the
 *              role name broke, a 401 on a bad key. A commit can fix it.
 *   `failed`   anything else, including a transport error.
 *
 * Matched on the STATUS plus a quota marker in the body, never on the prose
 * alone: the message is a product string that will be reworded, and a checker
 * that greps a sentence stops working quietly on the day somebody improves it.
 */
const QUOTA_MARKERS = ['QUOTA_EXCEEDED', 'allows up to', 'raise the cap'];

function classifyMintFailure(status, body) {
  const text = typeof body === 'string' ? body : '';
  if (status === 403 && QUOTA_MARKERS.some((m) => text.includes(m))) return 'capped';
  if (status === 400 || status === 401 || status === 403) return 'refused';
  return 'failed';
}

module.exports = {
  RESERVED_NAMESPACES,
  QUOTA_MARKERS,
  classifyMintFailure,
  NO_ASSIGNMENT,
  statusForAge,
  roleForBranch,
  resolveRole,
  roleNames,
  groupByRole,
  loadRoles,
};
