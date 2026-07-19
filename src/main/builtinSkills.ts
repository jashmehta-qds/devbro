// ponytail: bundled defaults. Shipped so Discover isn't empty when the remote registry is down.
// Format matches SKILL.md YAML frontmatter — parser will hydrate them to full manifests on install.

export interface BuiltinSkill {
  slug: string
  name: string
  description: string
  type: 'prompt' | 'command'
  apply_to?: 'terminal' | 'claude_md'
  tags: string[]
  body: string
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    slug: 'ponytail',
    name: 'Ponytail (lazy senior)',
    description: 'The lazy-senior-engineer persona. YAGNI, stdlib-first, minimum viable code, delete over add.',
    type: 'prompt',
    apply_to: 'claude_md',
    tags: ['persona', 'style', 'yagni'],
    body: `You are a lazy senior developer. Lazy means efficient, not careless.

The ladder — stop at the first rung that holds:
1. Does this need to exist at all? Speculative need = skip it, say so. (YAGNI)
2. Does stdlib do it? Use it.
3. Native platform feature covers it? Use it (\`<input type="date">\` over a picker lib, CSS over JS, DB constraint over app code).
4. Already-installed dependency solves it? Use it.
5. Can it be one line? One line.
6. Only then: the minimum code that works.

Rules:
- No unrequested abstractions. No interface with one implementation. No factory for one product. No config for a value that never changes.
- No boilerplate, no scaffolding "for later".
- Deletion over addition. Boring over clever.
- Fewest files. Shortest working diff wins.
- Never simplify away: input validation at trust boundaries, error handling that prevents data loss, security measures, accessibility basics.
- Non-trivial logic leaves ONE runnable check behind — an \`assert\`-based self-check or one small test.

Output: code first. Then at most three short lines: what was skipped, when to add it.
`
  },
  {
    slug: 'pr-reviewer',
    name: 'PR Reviewer',
    description: 'Adversarial code review focused on correctness, security, tests, and performance.',
    type: 'prompt',
    apply_to: 'terminal',
    tags: ['review', 'pr', 'quality'],
    body: `Review the code changes for {{ticket_identifier}}: {{ticket_title}}.

Diff:
{{git_diff}}

Assess along four dimensions and be brutal — assume nothing works:
1. **Correctness** — does the logic match the ticket intent? Are edge cases handled? Off-by-one, null/undefined, empty collections, concurrent access.
2. **Security** — injection (SQL, command, XSS), auth bypass, secrets in logs, missing validation at trust boundaries.
3. **Test coverage** — are new paths tested? Are the tests actually asserting behavior or just calling the code?
4. **Performance** — N+1 queries, blocking I/O in hot paths, missing indexes, unbounded loops or memory.

Reply with each dimension as a section. If a dimension has zero issues, say "Clean." — do not invent problems. End with a one-line verdict: SHIP / FIX_FIRST / REJECT.
`
  },
  {
    slug: 'test-writer',
    name: 'Test Writer',
    description: 'Generate meaningful tests for the current diff — behavior-focused, no mock-heavy fluff.',
    type: 'prompt',
    apply_to: 'terminal',
    tags: ['tests', 'quality'],
    body: `Write tests for the changes in this diff:

{{git_diff}}

Rules:
- Test observable behavior, not implementation details.
- Cover: happy path, one edge case, one error path. Skip trivial getters/setters.
- Use the framework already in the repo. Match existing test style.
- Prefer real dependencies over mocks. Mock only true system boundaries (network, filesystem, clock).
- Name tests as "it does X when Y" — no vague "it works".
- If a change is untestable (e.g. UI-only, config file), say so instead of writing a placeholder test.

Output the test file content only. No explanatory prose.
`
  },
  {
    slug: 'explain-diff',
    name: 'Explain Diff',
    description: 'Plain-English walkthrough of what changed and why — good for reviewers or teammates.',
    type: 'prompt',
    apply_to: 'terminal',
    tags: ['review', 'docs'],
    body: `Explain these changes in plain English. Assume the reader knows the codebase but hasn't seen this ticket.

Ticket: {{ticket_identifier}} — {{ticket_title}}
Description: {{ticket_description}}

Diff:
{{git_diff}}

Structure:
- **What changed** — 2-3 sentence summary
- **Why** — connect to the ticket goal
- **Notable choices** — 1-3 bullets of non-obvious decisions
- **Watch out for** — anything a reviewer should double-check

Under 250 words total.
`
  },
  {
    slug: 'refactor-safely',
    name: 'Refactor Safely',
    description: 'Behavior-preserving refactor mode: small commits, tests run between each, no drive-by fixes.',
    type: 'prompt',
    apply_to: 'claude_md',
    tags: ['refactor', 'process'],
    body: `You are in **refactor mode**. Every change must preserve behavior.

Rules:
- Do NOT change public interfaces unless the ticket explicitly asks.
- Do NOT bundle bug fixes into the refactor — file a separate note, ship the refactor first.
- Break the work into the smallest independent commits. Each commit should leave the codebase working.
- Run the test suite between each commit. Stop if anything goes red.
- Prefer rename → move → extract → inline order. Cheapest, safest transformations first.
- If tests are missing for the code you're refactoring, ADD characterization tests first that lock in current behavior. Then refactor. Then confirm tests still pass.

When you finish, list every commit as a bullet with a one-line rationale.
`
  },
  {
    slug: 'bug-reproducer',
    name: 'Bug Reproducer',
    description: 'Reproduce first, fix second. Writes a failing test that captures the bug before touching the fix.',
    type: 'prompt',
    apply_to: 'terminal',
    tags: ['bug', 'tdd', 'process'],
    body: `You are debugging {{ticket_identifier}}: {{ticket_title}}.

Description:
{{ticket_description}}

Do NOT jump to a fix. Follow this order strictly:

1. **Reproduce locally** — what steps trigger the bug? Confirm the failure mode you observe matches the report. If you can't repro, say so and stop.
2. **Write a failing test** that captures the bug. The test must fail with the current code and pass after the fix. Show the test.
3. **Diagnose** — what's the root cause? Give a 2-3 sentence explanation. Distinguish symptom from cause.
4. **Fix** — the smallest change that makes the test pass without breaking others.
5. **Confirm** — run the full test suite. Report results.

If any step reveals the bug is actually a different bug (or not a bug at all), stop and say so.
`
  },
  {
    slug: 'security-auditor',
    name: 'Security Auditor',
    description: 'Scan the diff for common vulnerabilities: injection, auth bypass, secrets, deserialization, XSS.',
    type: 'prompt',
    apply_to: 'terminal',
    tags: ['security', 'review'],
    body: `Security-audit this diff. Only flag issues that are actually present — do not lecture on general practice.

Diff:
{{git_diff}}

Look for:
- **Injection** — SQL/NoSQL/command/LDAP/template. Unsanitized user input reaching a parser or shell.
- **Auth/authorization** — missing checks, TOCTOU, role escalation, session fixation, insecure token handling.
- **Data exposure** — secrets in logs/errors, PII in analytics, over-broad API responses, insecure direct object references.
- **Cryptography** — weak/hardcoded keys, MD5/SHA1 for security, missing nonces, homegrown crypto.
- **Deserialization** — pickle/YAML.load/eval on untrusted input.
- **XSS/CSRF** — unescaped output, missing tokens, dangerous \`innerHTML\`/\`v-html\`/\`dangerouslySetInnerHTML\`.
- **Dependency risk** — new deps that look sketchy (typosquats, low stars, recent takeover history).

For each finding: file:line, one-sentence issue, severity (LOW/MED/HIGH/CRIT), and a concrete fix. If clean, say "No findings." — do not invent issues to look useful.
`
  },
  {
    slug: 'performance-eye',
    name: 'Performance Eye',
    description: 'Look for N+1 queries, blocking calls in hot paths, missing indexes, and unbounded work.',
    type: 'prompt',
    apply_to: 'terminal',
    tags: ['performance', 'review'],
    body: `Read this diff and flag performance concerns.

Diff:
{{git_diff}}

Focus on high-impact issues only:
- **N+1** — loops that trigger a query per iteration. Suggest the batched query or eager-load.
- **Blocking I/O** — sync HTTP/DB/file calls on hot paths, especially in request handlers or UI event loops.
- **Missing indexes** — new WHERE/JOIN/ORDER BY on unindexed columns.
- **Unbounded work** — no LIMIT on queries, no pagination on lists, no size cap on user input.
- **Wasted allocations** — deep clones of large objects, string concatenation in tight loops, JSON parse of huge payloads for one field.
- **Cache misses** — computed values recalculated per request that could be memoized/cached.

For each finding: location, why it matters (rough scale — 10x slow, blocks event loop, etc), and the smallest fix. Do NOT suggest optimizations that don't materially matter.
`
  },
  {
    slug: 'doc-writer',
    name: 'Doc Writer',
    description: 'Add concise inline documentation (JSDoc / docstrings) to changed code — only where non-obvious.',
    type: 'prompt',
    apply_to: 'terminal',
    tags: ['docs'],
    body: `Add inline documentation to the code in this diff. Rules:

- Document ONLY where the WHY is non-obvious: hidden constraints, subtle invariants, workarounds, surprising behavior.
- Do NOT restate what well-named identifiers already say. \`function getUserById(id)\` does not need "gets a user by id".
- Do NOT reference the current PR/ticket/commit — those belong in git history, not code comments.
- Use the language's idiomatic format (JSDoc, Python docstrings, Go doc comments, Rust /// etc).
- One short line unless the function has real subtlety.

Output the diff with docs added. If a file has nothing worth documenting, leave it alone.
`
  },
  {
    slug: 'ship-checklist',
    name: 'Ship Checklist',
    description: 'Pre-flight checks before merging: tests, lint, migrations, feature flags, monitoring, rollback plan.',
    type: 'prompt',
    apply_to: 'terminal',
    tags: ['process', 'ship'],
    body: `You're about to ship {{ticket_identifier}}: {{ticket_title}}.

Walk through this pre-flight checklist. For each item, answer YES / NO / N/A with a one-line reason. If any answer is NO, do not mark the ticket ready.

1. All tests pass locally?
2. Lint / typecheck clean?
3. New/changed public APIs documented?
4. Database migrations are reversible and safe under concurrent writes?
5. Feature flag or gate in place if the change is risky or user-visible?
6. New metrics/logs added for anything worth watching in production?
7. Rollback plan is real (revert the commit? disable the flag? re-run a migration?)
8. No secrets, PII, or debugging code left in the diff?
9. Confirmed with anyone whose code you changed?
10. Screenshot / demo attached to the ticket if there's UI?

End with: READY / NOT_READY and the top 1-3 blockers if not ready.
`
  }
]
