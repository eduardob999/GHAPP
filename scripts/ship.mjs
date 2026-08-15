#!/usr/bin/env node
/**
 * Ship: check, push, deploy, and *prove* the site is live.
 *
 * One command so the end of a session is not five commands remembered in the
 * right order. It exists mainly because of one trap:
 *
 * **A green Actions run does not prove the site published.** Both Pages steps
 * in `.github/workflows/deploy.yml` carry `continue-on-error: true` — the
 * deliberate trade-off documented in the roadmap, so the pipeline stayed quiet
 * before Pages was enabled. The consequence is that `deploy-pages` can fail and
 * the run still reports success. So this script does not trust the run: it
 * fetches the published page afterwards and checks the bundle it names actually
 * loads.
 *
 * Usage:
 *   node scripts/ship.mjs                     check, push, deploy, verify
 *   node scripts/ship.mjs -m "feat: thing"    commit everything first
 *   node scripts/ship.mjs --no-build          skip the local build
 *   node scripts/ship.mjs --no-wait           push and return, do not watch
 *   node scripts/ship.mjs --dry-run           say what it would do
 */
import { execSync, spawnSync } from 'node:child_process';

const SITE = 'https://eduardob999.github.io/GHAPP/';
const WORKFLOW = 'deploy.yml';
/** Pages' CDN takes a moment to serve a new deployment after the run goes green. */
const VERIFY_ATTEMPTS = 10;
const VERIFY_DELAY_MS = 15_000;

const args = process.argv.slice(2);
const has = (...names) => names.some((n) => args.includes(n));
const valueOf = (...names) => {
  for (const name of names) {
    const index = args.indexOf(name);
    if (index !== -1 && args[index + 1]) return args[index + 1];
  }
  return null;
};

const dryRun = has('--dry-run');
const skipBuild = has('--no-build');
const skipWait = has('--no-wait');
const message = valueOf('-m', '--message');

const sh = (command, options = {}) =>
  execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();

const step = (text) => console.log(`\n[1m▸ ${text}[0m`);
const ok = (text) => console.log(`  [32m✓[0m ${text}`);
const warn = (text) => console.log(`  [33m![0m ${text}`);

function die(text, detail = '') {
  console.error(`  [31m✗[0m ${text}`);
  if (detail) console.error(detail);
  process.exit(1);
}

/** Runs a command with output streaming, and returns whether it succeeded. */
function run(command, args_) {
  if (dryRun) {
    console.log(`  (dry run) ${command} ${args_.join(' ')}`);
    return true;
  }
  return spawnSync(command, args_, { stdio: 'inherit' }).status === 0;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── 1. The tree ──────────────────────────────────────────────────────────────

step('Working tree');
const branch = sh('git rev-parse --abbrev-ref HEAD');
let dirty = sh('git status --porcelain');

if (dirty && message) {
  if (!run('git', ['add', '-A'])) die('git add failed.');
  if (!run('git', ['commit', '-m', message])) die('git commit failed.');
  dirty = dryRun ? dirty : sh('git status --porcelain');
  ok(`Committed on ${branch}.`);
} else if (dirty) {
  // Deliberately fatal rather than "helpful". Sessions here routinely put
  // temporary scaffolding in src/App.tsx, and shipping that to a live site is
  // exactly the accident worth spending an error message on.
  die(
    'Uncommitted changes. Commit them, or pass -m "message" to commit everything.',
    dirty
      .split('\n')
      .map((line) => `      ${line}`)
      .join('\n'),
  );
} else {
  ok(`Clean on ${branch}.`);
}

const ahead = Number(sh(`git rev-list --count origin/${branch}..HEAD`) || '0');
ok(`${ahead} commit${ahead === 1 ? '' : 's'} to push.`);

// ── 2. The checks the workflow will run anyway, but faster and locally ───────

if (!skipBuild) {
  step('Typecheck and build');
  if (!run('npm', ['run', 'build'])) {
    die('Build failed. Nothing pushed — CI would only have told you the same thing more slowly.');
  }
  ok('Builds clean.');
} else {
  warn('Skipping the local build (--no-build).');
}

// ── 3. Push ──────────────────────────────────────────────────────────────────

step('Push');
if (ahead === 0 && !dryRun) {
  ok('Nothing to push; re-running the workflow instead.');
  if (!run('gh', ['workflow', 'run', WORKFLOW, '--ref', branch])) {
    die('Could not dispatch the workflow.');
  }
} else if (!run('git', ['push', 'origin', branch])) {
  die('Push failed.');
}

if (branch !== 'main') {
  warn(`On ${branch}, not main. The Pages workflow only deploys main.`);
  process.exit(0);
}

if (skipWait || dryRun) {
  console.log(`\nPushed. Watch it at https://github.com/eduardob999/GHAPP/actions`);
  process.exit(0);
}

// ── 4. Watch the run ─────────────────────────────────────────────────────────

step('Deploy');
await sleep(6000); // Give GitHub a moment to register the run before asking for it.

const runId = sh(
  `gh run list --workflow=${WORKFLOW} --branch=${branch} --limit=1 --json databaseId --jq '.[0].databaseId'`,
);
if (!runId) die('No workflow run found.');

console.log(`  Run ${runId}: https://github.com/eduardob999/GHAPP/actions/runs/${runId}`);
run('gh', ['run', 'watch', runId, '--exit-status']);

// `gh run watch` can return before the conclusion is recorded — and it exits
// straight away when the run is already finished — so the conclusion is polled
// rather than assumed from the watch exiting.
let conclusion = '';
for (let attempt = 0; attempt < 40 && !conclusion; attempt += 1) {
  conclusion = sh(`gh run view ${runId} --json conclusion --jq .conclusion`);
  if (!conclusion) await sleep(10_000);
}

if (conclusion !== 'success') {
  die(`The workflow concluded "${conclusion || 'nothing yet'}". See the run above.`);
}
ok('Workflow green.');

// A green run is not proof — see the note at the top of this file. Look for the
// step having actually been skipped over by continue-on-error.
const failedSteps = sh(
  `gh run view ${runId} --json jobs --jq '[.jobs[].steps[] | select(.conclusion=="failure") | .name] | join(", ")'`,
);
if (failedSteps) {
  warn(`Steps that failed but did not fail the run: ${failedSteps}`);
}

// ── 5. Prove it is live ──────────────────────────────────────────────────────

step('Verify the published site');
const head = sh('git rev-parse --short HEAD');

for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
  try {
    const response = await fetch(SITE, { cache: 'no-store' });
    const html = await response.text();
    const bundle = /src="([^"]*assets\/[^"]+\.js)"/.exec(html)?.[1];

    if (response.ok && bundle) {
      const assetUrl = new URL(bundle, SITE).href;
      const asset = await fetch(assetUrl, { cache: 'no-store' });

      if (asset.ok) {
        ok(`${SITE} serves ${response.status}, and its bundle loads.`);
        console.log(`\n[1mLive:[0m ${SITE}  (${head})`);
        process.exit(0);
      }
      warn(`Page served, but ${assetUrl} returned ${asset.status}.`);
    } else {
      warn(`Attempt ${attempt}: ${response.status}${bundle ? '' : ', no bundle in the HTML'}.`);
    }
  } catch (error) {
    warn(`Attempt ${attempt}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (attempt < VERIFY_ATTEMPTS) await sleep(VERIFY_DELAY_MS);
}

die(
  `The workflow was green but ${SITE} is not serving the site.`,
  '      Check that Settings → Pages → Source is "GitHub Actions", and that\n' +
    '      deploy-pages did not fail silently under continue-on-error.',
);
