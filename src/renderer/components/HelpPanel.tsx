import React, { useState } from 'react'

export function HelpPanel() {
  return (
    <div className="bg-gray-950 min-h-full py-10 px-8 overflow-y-auto">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold text-gray-50 tracking-tight">Welcome to devbro</h1>
        <p className="text-sm text-gray-500 mt-1 mb-10">A quick tour of what's where — and how to get productive in five minutes.</p>

        <section className="mb-12">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-4">Getting started</h2>
          <ol className="space-y-6">
            <Step n={1} title="Connect your issue tracker">
              Open <Kbd>⌘,</Kbd> Settings from the sidebar footer. Pick <b>Linear</b>, <b>Jira</b>, or <b>Asana</b> and paste
              your API token. Only one connector needs to be active at a time — you can switch later.
            </Step>
            <Step n={2} title="Set your workspace folder">
              In Settings → Work Directory, choose a single parent folder that already contains all your git repos
              (e.g. <Mono>~/Work</Mono>). devbro doesn't clone anything — it just launches terminals inside repos you already have.
            </Step>
            <Step n={3} title="Link repos to projects (or to “No Project”)">
              Click a project in the sidebar to open its <b>Project view</b>. Under <em>Related repos</em>, pick the folders that
              belong to that project. Tickets without a project share a special <b>No Project</b> bucket — link repos there once and
              every no-project ticket sees them.
            </Step>
            <Step n={4} title="Open a ticket">
              Click any issue in the sidebar, or press <Kbd>⌘K</Kbd> to search. Each ticket opens in its own tab (top bar).
              The ticket view shows description on the left and a switcher (Notes / Checklist / Skills / Diff / Activity) on the right.
            </Step>
            <Step n={5} title="Launch Claude in the right repo">
              In the ticket header, click the terminal button next to a repo name. If the project has multiple linked repos, you get
              one button per repo. A CLAUDE.md is generated on the fly with the ticket description, your notes, and checklist — so
              Claude walks in with full context.
            </Step>
            <Step n={6} title="Track progress as you go">
              While the session runs, jot notes in the <b>Notes</b> tab and tick items in <b>Checklist</b>. On session exit devbro
              generates a progress summary automatically and appends it to the ticket's Activity log.
            </Step>
            <Step n={7} title="Daily standup">
              Click <b>Standup</b> in the sidebar footer (or <Kbd>⌘U</Kbd>) to draft a standup from yesterday's activity across all
              tickets. Streaming Claude output — copy when ready.
            </Step>
          </ol>
        </section>

        <section className="mb-12">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-4">Where everything lives</h2>
          <div className="grid grid-cols-2 gap-3">
            <Loc title="Sidebar (left)" desc="Projects, issues, search, filters. Brand mark + refresh + filter buttons at the top; launcher pills at the bottom." />
            <Loc title="Tab bar (top)" desc="Open tickets and pages (Analytics, Settings). ID prominent, title below. Green dot = live terminal." />
            <Loc title="Ticket header" desc="Identifier · status · priority · assignee · branch · git chips · repo terminal button. Title on the next row with a 100px progress bar on the right." />
            <Loc title="Right pane switcher" desc="Notes (default), Checklist, Skills, Diff, Activity. Hover any pill to see its label; click to switch." />
            <Loc title="Terminal (bottom)" desc="Drag the top edge to resize. ⌘T toggles. CLAUDE.md preview appears above the Start Claude button before you launch." />
            <Loc title="Footer launcher" desc="Analytics · Standup · Settings. Icon-only until hovered, keyboard shortcut chip on the right. Refresh Context (⚡) lives in the sidebar header, not the footer." />
          </div>
        </section>

        <section className="mb-12">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-4">Keyboard shortcuts</h2>
          <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800 shadow-soft">
            <Shortcut keys="⌘K"     label="Search — issues, commands (>), identifier jump (#ENG-123)" />
            <Shortcut keys="⌘T"     label="Toggle terminal panel" />
            <Shortcut keys="⌘D"     label="Analytics" />
            <Shortcut keys="⌘U"     label="Standup" />
            <Shortcut keys="⌘,"     label="Settings" />
            <Shortcut keys="↑ ↓ ↵"  label="Navigate results in command palette" />
            <Shortcut keys="esc"    label="Close palette / dropdown / editing state" />
          </div>
        </section>

        <section className="mb-4">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-gray-500 font-medium mb-4">FAQ</h2>
          <div className="space-y-2">
            <Faq q="Where is my data stored?">
              Everything local: a SQLite database in <Mono>~/Library/Application Support/devbro/</Mono> (macOS) or the
              platform-equivalent app data dir. Notes, checklists, progress logs, and cached issues live there. Nothing leaves your machine
              except calls to your issue tracker and Claude.
            </Faq>
            <Faq q="Why can I only run one terminal session at a time by default?">
              Each Claude session can use 1–4 GB of RAM. On a typical laptop that adds up fast. You can raise the cap in
              Settings → Terminal Sessions (up to 5). Only do it if you have 32 GB+.
            </Faq>
            <Faq q="I hit Linear's rate limit (2500/hr). What now?">
              Wait it out (limits reset hourly) and avoid mashing the refresh button. devbro throttles fresh fetches to once per minute
              per project. Bulk-refresh only when you actually need it — the sidebar shows cached issues instantly.
            </Faq>
            <Faq q="Nothing happens when I click 'Start Claude' in the terminal panel.">
              Make sure the <Mono>claude</Mono> CLI is installed and on your PATH. Test it: open a terminal outside devbro and run
              <Mono> claude --version</Mono>. If it works there but not in devbro, your login shell (zsh/bash) probably isn't loading the
              same PATH — check your <Mono>.zshrc</Mono>/<Mono>.bashrc</Mono>.
            </Faq>
            <Faq q="How does devbro decide which repo to open the terminal in?">
              For a ticket with a project: it uses that project's linked repos. For a no-project ticket: it uses whatever's linked to the
              <b> No Project</b> pseudo-project. Manage both by clicking the project in the sidebar and editing <em>Related repos</em>.
            </Faq>
            <Faq q="What's the ⚡ Refresh Context button for?">
              It rebuilds <Mono>~/.dev-dashboard/global-context.md</Mono> — a file Claude reads at session start with cross-project
              conventions. Trigger it after you edit your global preferences or add a new project.
            </Faq>
            <Faq q="Progress summary didn't generate after my session.">
              It runs asynchronously in the background. If the Claude CLI errored (auth, no git history, timeout), the run is silent by design.
              You can manually generate one from the ticket's Activity tab, or check the log file in the app data dir.
            </Faq>
            <Faq q="Can I use multiple Linear workspaces / Jira instances?">
              Not yet. One connector, one workspace at a time. Multi-workspace support is on the roadmap.
            </Faq>
            <Faq q="How do I file a bug or request a feature?">
              Open GitHub issues on the devbro repo. Include the log file from Settings → Danger Zone → Open log file if it's a crash.
            </Faq>
          </div>
        </section>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex-shrink-0 w-7 h-7 rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 text-xs font-mono font-medium flex items-center justify-center mt-0.5">
        {n}
      </span>
      <div>
        <h3 className="text-sm font-medium text-gray-100">{title}</h3>
        <p className="text-sm text-gray-400 mt-1 leading-relaxed">{children}</p>
      </div>
    </li>
  )
}

function Loc({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 shadow-soft">
      <h4 className="text-sm font-medium text-gray-100">{title}</h4>
      <p className="text-xs text-gray-500 mt-1 leading-relaxed">{desc}</p>
    </div>
  )
}

function Shortcut({ keys, label }: { keys: string; label: string }) {
  return (
    <div className="flex items-center justify-between px-4 py-2.5">
      <span className="text-sm text-gray-300">{label}</span>
      <span className="text-[11px] font-mono text-gray-400 bg-gray-800 border border-gray-700/50 rounded-md px-2 py-0.5">{keys}</span>
    </div>
  )
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-soft">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-850 transition-colors"
      >
        <span className="text-sm text-gray-100 font-medium">{q}</span>
        <span className={`text-gray-500 text-xs transition-transform duration-150 ${open ? 'rotate-90' : ''}`}>▸</span>
      </button>
      {open && <div className="px-4 pb-4 text-sm text-gray-400 leading-relaxed border-t border-gray-800 pt-3">{children}</div>}
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-md bg-gray-800 text-gray-300 text-[11px] font-mono border border-gray-700/50 mx-0.5">{children}</span>
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono text-gray-300 bg-gray-900 px-1 py-0.5 rounded text-[12px]">{children}</span>
}
