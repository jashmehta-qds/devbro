import React, { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '../store'
import type { Skill } from '../types'
import { useTerminal } from '../hooks/useTerminal'
import { Markdown } from './Markdown'

interface SkillsTabProps {
  ticketId: string
}

// Schema reuse: existing tables have (name, command) columns.
// For global/project we treat the `command` column as `content` — markdown text
// that Claude reads in CLAUDE.md but is NOT runnable in the terminal.
interface GuidelineRow {
  id: string
  name: string
  command: string
  created_at: number
}

interface ProjectGuidelineRow extends GuidelineRow {
  project_id: string
}

export function SkillsTab({ ticketId }: SkillsTabProps) {
  const { skills, setSkills, selectedIssue } = useAppStore()
  const { runCommand } = useTerminal()
  const projectId = selectedIssue?.project?.id ?? null

  const ticketSkills = skills[ticketId] || []

  // Global + project guidelines (markdown docs)
  const [globalGuidelines, setGlobalGuidelines] = useState<GuidelineRow[]>([])
  const [projectGuidelines, setProjectGuidelines] = useState<ProjectGuidelineRow[]>([])
  const [runningId, setRunningId] = useState<string | null>(null)

  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editContent, setEditContent] = useState('')
  const [addingTo, setAddingTo] = useState<'global' | 'project' | 'ticket' | null>(null)
  const [newName, setNewName] = useState('')
  const [newContent, setNewContent] = useState('')

  const toggleCollapse = (key: string) =>
    setCollapsedSections((p) => ({ ...p, [key]: !p[key] }))

  // ---- loaders
  const loadTicket = useCallback(async () => {
    try {
      const data = await window.api.skills.list(ticketId)
      setSkills(ticketId, data as Skill[])
    } catch {}
  }, [ticketId, setSkills])

  const loadGlobal = useCallback(async () => {
    try {
      const data = await window.api.globalSkills.list()
      setGlobalGuidelines(data as any)
    } catch {}
  }, [])

  const loadProject = useCallback(async (pid: string) => {
    try {
      const data = await window.api.projectSkills.list(pid)
      setProjectGuidelines(data as any)
    } catch {}
  }, [])

  useEffect(() => { loadTicket() }, [loadTicket])
  useEffect(() => { loadGlobal() }, [loadGlobal])
  useEffect(() => {
    if (projectId) loadProject(projectId)
    else setProjectGuidelines([])
  }, [projectId, loadProject])

  // ---- actions
  const runSkill = async (id: string, command: string) => {
    setRunningId(id)
    try { await runCommand(command) }
    finally { setTimeout(() => setRunningId(null), 1000) }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditContent('')
  }

  const cancelAdd = () => {
    setAddingTo(null)
    setNewName('')
    setNewContent('')
  }

  const addGuideline = async () => {
    if (!newName.trim() || !newContent.trim()) return
    try {
      if (addingTo === 'global') {
        await window.api.globalSkills.add(newName.trim(), newContent.trim())
        await loadGlobal()
      } else if (addingTo === 'project' && projectId) {
        await window.api.projectSkills.add(projectId, newName.trim(), newContent.trim())
        await loadProject(projectId)
      } else if (addingTo === 'ticket') {
        await window.api.skills.add(ticketId, newName.trim(), newContent.trim())
        await loadTicket()
      }
      cancelAdd()
    } catch (err) { console.error(err) }
  }

  const deleteGuideline = async (tier: 'global' | 'project' | 'ticket', id: string) => {
    try {
      if (tier === 'global') { await window.api.globalSkills.delete(id); await loadGlobal() }
      else if (tier === 'project') { await window.api.projectSkills.delete(id); if (projectId) await loadProject(projectId) }
      else { await window.api.skills.delete(id); await loadTicket() }
    } catch (err) { console.error(err) }
  }

  // ---- guideline UI (markdown doc, not runnable)
  const renderGuideline = (tier: 'global' | 'project', g: GuidelineRow) => {
    const isEditing = editingId === g.id
    return (
      <div key={g.id} className="bg-gray-800/50 border border-gray-700 rounded-lg p-3 group">
        {isEditing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Title"
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-violet-500"
            />
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              rows={6}
              placeholder="Markdown instructions, conventions, gotchas..."
              className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 font-mono focus:outline-none focus:border-violet-500"
            />
            <div className="flex gap-2">
              <button
                onClick={async () => {
                  if (!editName.trim() || !editContent.trim()) return
                  // No update API — delete + add
                  await deleteGuideline(tier, g.id)
                  if (tier === 'global') {
                    await window.api.globalSkills.add(editName.trim(), editContent.trim())
                    await loadGlobal()
                  } else if (projectId) {
                    await window.api.projectSkills.add(projectId, editName.trim(), editContent.trim())
                    await loadProject(projectId)
                  }
                  cancelEdit()
                }}
                className="px-2.5 py-1 bg-violet-600 text-white rounded text-xs hover:bg-violet-700 transition-colors"
              >Save</button>
              <button onClick={cancelEdit} className="px-2.5 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600 transition-colors">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-1.5">
              <h4 className="text-sm font-medium text-gray-100">{g.name}</h4>
              <div className="flex items-center gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => { setEditingId(g.id); setEditName(g.name); setEditContent(g.command) }}
                  className="text-xs text-gray-500 hover:text-violet-400"
                  title="Edit"
                >✎</button>
                <button
                  onClick={() => deleteGuideline(tier, g.id)}
                  className="text-xs text-gray-500 hover:text-red-400"
                  title="Delete"
                >✕</button>
              </div>
            </div>
            <div className="text-xs text-gray-400">
              <Markdown>{g.command}</Markdown>
            </div>
          </>
        )}
      </div>
    )
  }

  // ---- ticket command UI (runnable)
  const renderCommand = (s: Skill) => (
    <div key={s.id} className="flex items-center gap-3 bg-gray-800 border border-gray-700 rounded-lg p-2.5 group">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-200">{s.name}</div>
        <div className="text-xs text-gray-500 font-mono truncate">{s.command}</div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={() => runSkill(s.id, s.command)}
          disabled={runningId === s.id}
          className="px-2 py-1 bg-green-700/40 text-green-400 rounded text-xs hover:bg-green-700/60 disabled:opacity-50 transition-colors border border-green-700/50"
          title="Run in terminal"
        >{runningId === s.id ? '...' : '▶'}</button>
        <button
          onClick={() => deleteGuideline('ticket', s.id)}
          className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-all text-xs"
          title="Delete"
        >✕</button>
      </div>
    </div>
  )

  // ---- add form
  const renderAddForm = (tier: 'global' | 'project' | 'ticket') => {
    if (addingTo !== tier) return null
    const isCommand = tier === 'ticket'
    return (
      <div className="bg-gray-800 border border-violet-700/50 rounded-lg p-3 space-y-2 mt-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder={isCommand ? 'Command name (e.g. "Run tests")' : 'Title (e.g. "Coding conventions")'}
          className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-violet-500"
          autoFocus
        />
        {isCommand ? (
          <input
            type="text"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addGuideline()}
            placeholder="npm test"
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600 font-mono focus:outline-none focus:border-violet-500"
          />
        ) : (
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={6}
            placeholder={tier === 'global'
              ? 'e.g. "Always use TypeScript strict mode. Prefer functional components. Never disable lint without a comment explaining why."'
              : 'e.g. "Migrations are run via ./scripts/migrate.sh. Tests live under tests/. Use yarn, not npm."'}
            className="w-full bg-gray-900 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 font-mono focus:outline-none focus:border-violet-500"
          />
        )}
        <div className="flex gap-2">
          <button
            onClick={addGuideline}
            disabled={!newName.trim() || !newContent.trim()}
            className="px-2.5 py-1 bg-violet-600 text-white rounded text-xs hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >Save</button>
          <button onClick={cancelAdd} className="px-2.5 py-1 bg-gray-700 text-gray-300 rounded text-xs hover:bg-gray-600 transition-colors">Cancel</button>
        </div>
      </div>
    )
  }

  const sectionHeader = (key: string, label: string, sublabel: string, onAdd: () => void) => {
    const collapsed = !!collapsedSections[key]
    return (
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => toggleCollapse(key)} className="flex items-center gap-2 text-sm font-medium text-gray-200 hover:text-gray-100">
          <span className="text-xs text-gray-500">{collapsed ? '▶' : '▼'}</span>
          {label}
          <span className="text-xs text-gray-600 font-normal">{sublabel}</span>
        </button>
        <button
          onClick={onAdd}
          className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
        >+ Add</button>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Global Guidelines */}
      <section>
        {sectionHeader('global', 'Global Guidelines', '— knowledge sent to Claude in every ticket', () => setAddingTo(addingTo === 'global' ? null : 'global'))}
        {!collapsedSections['global'] && (
          <>
            {globalGuidelines.length === 0 && addingTo !== 'global' && (
              <p className="text-xs text-gray-600 italic">
                No global guidelines yet. Add coding conventions, preferred libraries, or organisation-wide rules Claude should always follow.
              </p>
            )}
            <div className="space-y-2">
              {globalGuidelines.map((g) => renderGuideline('global', g))}
            </div>
            {renderAddForm('global')}
          </>
        )}
      </section>

      {/* Project Playbook */}
      {projectId && (
        <section>
          {sectionHeader('project', 'Project Playbook', '— knowledge sent for every ticket in this project', () => setAddingTo(addingTo === 'project' ? null : 'project'))}
          {!collapsedSections['project'] && (
            <>
              {projectGuidelines.length === 0 && addingTo !== 'project' && (
                <p className="text-xs text-gray-600 italic">
                  No project playbook yet. Add architecture notes, common commands, deployment quirks, anything Claude should know about this codebase.
                </p>
              )}
              <div className="space-y-2">
                {projectGuidelines.map((g) => renderGuideline('project', g))}
              </div>
              {renderAddForm('project')}
            </>
          )}
        </section>
      )}

      {/* Ticket Commands */}
      <section>
        {sectionHeader('ticket', 'Ticket Commands', '— runnable shortcuts for this ticket', () => setAddingTo(addingTo === 'ticket' ? null : 'ticket'))}
        {!collapsedSections['ticket'] && (
          <>
            {ticketSkills.length === 0 && addingTo !== 'ticket' && (
              <p className="text-xs text-gray-600 italic">
                No ticket commands yet. Add shell commands you run often for this ticket — click ▶ to send to the terminal.
              </p>
            )}
            <div className="space-y-2">
              {ticketSkills.map(renderCommand)}
            </div>
            {renderAddForm('ticket')}
          </>
        )}
      </section>
    </div>
  )
}
