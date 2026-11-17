#!/usr/bin/env node
/**
 * Reports this repository's branches to FlashyOS as *assignments*, grouped
 * under the role that owns each one.
 *
 * The previous version made every branch its own agent. It was an effective
 * way to make the floor plan look populated and a bad way to describe an
 * organization: the public roster read as a git log, with entries like
 * `claude-source-code-audit-bxq1t0`, `fix-dockerfile-drop-broken-npm-upgrade`
 * and `main` presented as colleagues. Fifty-five of the hundred and two agents
 * on the network were branch names.
 *
 * The fix is to keep apart the two things that were being named with one
 * string:
 *
 *   role        a standing responsibility, lasting years   `retention`
 *   assignment  the work in flight, lasting days           `retention/win-back`
 *
 * A role exists when no work is in flight; an assignment does not. So roles
 * come from flashyos.roles.json — this organization's declared charter — and a
 * branch reports under the role named by its first segment. A branch belonging
 * to no role reports nothing at all rather than inventing an agent, which is
 * the single change that stops the roster filling with build logs.
 *
 * Required env: GITHUB_REPOSITORY, GH_TOKEN (or GITHUB_TOKEN),
 * FLASHYOS_API_URL, FLASHYOS_ORG_ID, FLASHYOS_AGENT_BOOTSTRAP_KEY.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { roleForBranch, groupByRole, loadRoles, roleNames, statusForAge, classifyMintFailure } =
  require('./flashyos-role-mesh.cjs');

const GITHUB_API = 'https://api.github.com';

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const flashyosApiUrl = process.env.FLASHYOS_API_URL;
  const orgId = process.env.FLASHYOS_ORG_ID;
  const bootstrapKey = process.env.FLASHYOS_AGENT_BOOTSTRAP_KEY;

  if (!repo || !ghToken || !flashyosApiUrl || !orgId || !bootstrapKey) {
    console.error(
      'Missing required env (GITHUB_REPOSITORY, GH_TOKEN, FLASHYOS_API_URL, FLASHYOS_ORG_ID, FLASHYOS_AGENT_BOOTSTRAP_KEY)',
    );
    process.exit(1);
  }

  const here = path.dirname(fileURLToPath(import.meta.url));
  const roles = loadRoles(path.join(here, '..', 'flashyos.roles.json'));
  console.log(`Charter declares ${roles.length} roles: ${roleNames(roles).join(', ')}`);
  const withPriors = roles.filter((r) => r.renamedFrom.length);
  if (withPriors.length) {
    // Printed because a branch resolving through a prior name looks like a
    // mismatch in the log otherwise — `hermes/retention` reporting under
    // `retention` should be explicable from the run's own output.
    console.log(
      `Succession in force: ${withPriors.map((r) => `${r.renamedFrom.join('/')} → ${r.name}`).join(', ')}`,
    );
  }

  async function ghFetch(p) {
    const res = await fetch(`${GITHUB_API}${p}`, {
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) throw new Error(`GitHub API ${p} -> ${res.status}`);
    return res.json();
  }

  const branches = [];
  for (let page = 1; ; page++) {
    const batch = await ghFetch(`/repos/${repo}/branches?per_page=100&page=${page}`);
    branches.push(...batch.map((b) => b.name));
    if (batch.length < 100) break;
  }
  console.log(`Found ${branches.length} branches in ${repo}`);

  // Only fetch commits for branches that will actually report. The old version
  // fetched one commit per branch across a hundred-odd branches, nearly all of
  // which then became an agent nobody wanted.
  const relevant = branches.filter((b) => roleForBranch(b, roles));
  console.log(
    `${relevant.length} belong to a declared role; ${branches.length - relevant.length} report nothing.`,
  );

  const assignments = [];
  for (const branch of relevant) {
    try {
      const commit = await ghFetch(`/repos/${repo}/commits/${encodeURIComponent(branch)}`);
      const committedAt = new Date(commit.commit?.committer?.date ?? 0).getTime();
      if (!committedAt) throw new Error('no commit date');
      assignments.push({
        branch,
        message: (commit.commit?.message || '').split('\n')[0].slice(0, 120),
        committedAt,
        status: statusForAge(Date.now() - committedAt),
      });
    } catch (err) {
      console.warn(`  ${branch} -> skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  const grouped = groupByRole(assignments, roles);

  let synced = 0;
  let failed = 0;
  /** Roles the platform refused on quota — a plan decision, not a defect here. */
  const capped = [];
  for (const entry of grouped) {
    try {
      const mint = await fetch(`${flashyosApiUrl}/api/v1/orgs/${orgId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-agent-bootstrap-key': bootstrapKey },
        body: JSON.stringify({ agentName: entry.role }),
      });
      if (!mint.ok) {
        // A 400 here is the naming standard refusing the role, and the body
        // names the rule broken. Printing it is the difference between a fix
        // and a shrug. A 403 on quota is a different animal and is separated
        // out below, because no commit in this repository can clear one.
        const detail = await mint.text();
        const kind = classifyMintFailure(mint.status, detail);
        if (kind === 'capped') {
          capped.push(entry.role);
          continue;
        }
        throw new Error(`mint ${entry.role} -> ${mint.status}: ${detail.slice(0, 300)}`);
      }
      const { token } = await mint.json();
      if (!token) throw new Error(`mint ${entry.role} returned no token`);

      const beat = await fetch(`${flashyosApiUrl}/api/v1/agents/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId,
          token,
          agentName: entry.role,
          status: entry.status,
          currentTask: entry.currentTask,
        }),
      });
      if (!beat.ok) throw new Error(`heartbeat ${entry.role} -> ${beat.status}`);

      console.log(
        `  ${entry.role} (${entry.status}) — ${entry.assignments.length} assignment(s): ${entry.currentTask}`,
      );
      synced++;
    } catch (err) {
      console.warn(`  ${entry.role} -> failed: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log(
    `\nReported ${synced}/${grouped.length} roles (${failed} failed, ${capped.length} over quota).`,
  );

  // A quota refusal is the platform working correctly and saying this org has
  // reached its plan limit. It is reported as ITS OWN THING rather than folded
  // into `failed`, because the two need opposite responses: one is somebody's
  // commit, the other is somebody's decision, and a run that cannot tell them
  // apart sends the reader to the wrong place. That is not hypothetical — this
  // property was red for 975 runs on a dead `npx` bin, and when the cause
  // became a quota nothing said so.
  if (capped.length) {
    console.error(
      `::error title=Charter declares more roles than this org's plan allows::` +
        `${capped.length} of ${grouped.length} role(s) could not be minted because the ` +
        `organisation is at its agent cap: ${capped.join(', ')}. No commit in this ` +
        `repository can clear this — it is a plan decision (raise the tier, use the ` +
        `referral path the API names, or declare fewer roles). The charter is not the ` +
        `thing to trim to fit a cap.`,
    );
  }

  // A run that reported nothing is a failure, not a success — an empty-secret
  // or key-mismatch 401 on every call masqueraded as a green check for weeks
  // precisely because this exited 0. Quota counts here too: reporting nothing
  // is reporting nothing, whatever the reason. What changes is that the log
  // now says which of the two it was.
  if (grouped.length > 0 && synced === 0) {
    console.error(
      capped.length === grouped.length
        ? 'No role reported: every one is over this org\'s agent cap. Red by design until the plan changes.'
        : 'Every role failed to report — failing the run so it shows red in CI.',
    );
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].endsWith('flashyos-branch-mesh-sync.mjs')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
