import { LinearClient } from '@linear/sdk'
import type { ConnectorCycle } from './connectors/types'

let client: LinearClient | null = null
let clientCreatedAt = 0

export function _resetClient() {
  client = null
  clientCreatedAt = 0
}

export function getLinearClient(): LinearClient {
  // Recreate client every 30 minutes to prevent SDK cache memory growth
  if (!client || Date.now() - clientCreatedAt > 30 * 60 * 1000) {
    const apiKey = process.env.LINEAR_API_KEY
    if (!apiKey) throw new Error('LINEAR_API_KEY is not set in environment variables')
    client = new LinearClient({ apiKey })
    clientCreatedAt = Date.now()
  }
  return client
}

async function serializeIssue(issue: any, projectOverride?: { id: string; name: string; description?: string }) {
  const [state, assigneeRaw, projectRaw, labels, cycleRaw, milestoneRaw] = await Promise.all([
    issue.state,
    issue.assignee,
    projectOverride ? Promise.resolve(null) : issue.project,
    issue.labels(),
    Promise.resolve(issue.cycle).catch(() => null),
    Promise.resolve(issue.projectMilestone).catch(() => null),
  ])

  const project = projectOverride ?? (projectRaw ? { id: projectRaw.id, name: projectRaw.name, description: projectRaw.description ?? undefined } : undefined)

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    state: state
      ? { id: state.id, name: state.name, color: state.color, type: state.type }
      : { id: '', name: 'Unknown', color: '#888888', type: 'started' },
    assignee: assigneeRaw
      ? { id: assigneeRaw.id, name: assigneeRaw.name, email: assigneeRaw.email, avatarUrl: assigneeRaw.avatarUrl ?? undefined }
      : undefined,
    project,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    url: issue.url,
    labels: labels.nodes.map((l: any) => ({ id: l.id, name: l.name, color: l.color })),
    cycleId: cycleRaw?.id ?? null,
    milestoneId: milestoneRaw?.id ?? null,
    dueDate: issue.dueDate ? new Date(issue.dueDate).toISOString() : null,
  }
}

// Returns deduplicated projects that have at least one issue assigned to the viewer
export async function fetchProjects() {
  const c = getLinearClient()
  const connection = await c.issues({
    first: 250,
    filter: { assignee: { isMe: { eq: true } }, state: { type: { nin: ['completed', 'cancelled'] } } }
  })

  const projectMap = new Map<string, { id: string; name: string; description?: string }>()

  for (const issue of connection.nodes) {
    const project = await issue.project
    if (project) {
      if (!projectMap.has(project.id)) {
        // Only access scalar fields that are safe with lazy-loaded project objects
        projectMap.set(project.id, {
          id: project.id,
          name: project.name,
          description: project.description ?? undefined,
        })
      }
    } else {
      // Issues with no project go into a virtual "No Project" bucket
      if (!projectMap.has('__no_project__')) {
        projectMap.set('__no_project__', { id: '__no_project__', name: 'No Project' })
      }
    }
  }

  return Array.from(projectMap.values())
}

// Returns issues assigned to the viewer within a given project
export async function fetchIssues(projectId: string) {
  const c = getLinearClient()

  if (projectId === '__no_project__') {
    const connection = await c.issues({
      first: 100,
      filter: {
        assignee: { isMe: { eq: true } },
        project: { null: true },
        state: { type: { nin: ['completed', 'cancelled'] } }
      }
    })
    return Promise.all(connection.nodes.map((issue) => serializeIssue(issue)))
  }

  const project = await c.project(projectId)
  const connection = await project.issues({
    first: 100,
    filter: { assignee: { isMe: { eq: true } } }
  })

  return Promise.all(
    connection.nodes.map((issue) =>
      serializeIssue(issue, { id: projectId, name: project.name, description: project.description ?? undefined })
    )
  )
}

export async function fetchIssueStates(issueId: string) {
  const c = getLinearClient()
  const issue = await c.issue(issueId)
  const team = await issue.team
  const states = await team.states()
  return states.nodes.map((s: any) => ({ id: s.id, name: s.name, color: s.color, type: s.type }))
}

export async function updateIssueState(issueId: string, stateId: string) {
  const c = getLinearClient()
  await c.updateIssue(issueId, { stateId })
}

export async function fetchProjectDetails(projectId: string) {
  const c = getLinearClient()

  if (projectId === '__no_project__') {
    return { id: '__no_project__', name: 'No Project', description: null, state: null, progress: 0, startDate: null, targetDate: null, milestones: [] }
  }

  const project = await c.project(projectId)

  const [milestonesConn, lead, membersConn, issuesConn] = await Promise.all([
    project.projectMilestones(),
    project.lead,
    project.members(),
    project.issues({ first: 250 }),
  ])

  const milestones = milestonesConn.nodes.map((m: any) => ({
    id: m.id,
    name: m.name,
    description: m.description ?? null,
    targetDate: m.targetDate ?? null,
    sortOrder: m.sortOrder ?? 0,
  }))

  // Count issues by state type
  const issueStateCounts: Record<string, number> = {}
  for (const issue of issuesConn.nodes) {
    const state = await issue.state
    const type = state?.type ?? 'unknown'
    issueStateCounts[type] = (issueStateCounts[type] ?? 0) + 1
  }

  const members = membersConn.nodes.map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    avatarUrl: u.avatarUrl ?? null,
  }))

  return {
    id: project.id,
    name: project.name,
    description: project.description ?? null,   // short summary line
    content: project.content ?? null,            // full markdown body document
    state: project.state ?? null,
    progress: project.progress ?? 0,
    startDate: project.startDate ?? null,
    targetDate: project.targetDate ?? null,
    url: project.url ?? null,
    updatedAt: project.updatedAt?.toISOString() ?? null,
    lead: lead ? { id: lead.id, name: lead.name, email: lead.email, avatarUrl: lead.avatarUrl ?? null } : null,
    members,
    issueStateCounts,
    totalIssues: issuesConn.nodes.length,
    milestones,
  }
}

export async function fetchTeamCycles(): Promise<ConnectorCycle[]> {
  const c = getLinearClient()
  const teamId = process.env.LINEAR_TEAM_ID

  let teamNodes: any[] = []
  if (teamId) {
    try { teamNodes = [await c.team(teamId)] } catch {}
  }
  if (teamNodes.length === 0) {
    try {
      const me = await c.viewer
      const conn = await me.teams()
      teamNodes = conn.nodes
    } catch {}
  }

  const now = new Date()
  const cycles: ConnectorCycle[] = []

  for (const team of teamNodes) {
    try {
      const conn = await team.cycles({ first: 20, filter: { completedAt: { null: true } } })
      for (const cy of conn.nodes) {
        const start = new Date(cy.startsAt)
        const end = new Date(cy.endsAt)
        cycles.push({
          id: cy.id,
          number: cy.number,
          name: cy.name ?? null,
          isCurrent: start <= now && now <= end,
          isNext: start > now,
          startsAt: cy.startsAt.toISOString(),
          endsAt: cy.endsAt.toISOString(),
        })
      }
    } catch {}
  }

  return cycles
}

export async function fetchIssue(issueId: string) {
  const c = getLinearClient()
  const issue = await c.issue(issueId)

  const state = await issue.state
  const assignee = await issue.assignee
  const project = await issue.project
  const parent = await issue.parent
  const labels = await issue.labels()

  return {
    id: issue.id,
    identifier: issue.identifier,
    title: issue.title,
    description: issue.description ?? undefined,
    priority: issue.priority,
    priorityLabel: issue.priorityLabel,
    state: state
      ? { id: state.id, name: state.name, color: state.color, type: state.type }
      : { id: '', name: 'Unknown', color: '#888888', type: 'started' },
    assignee: assignee
      ? { id: assignee.id, name: assignee.name, email: assignee.email, avatarUrl: assignee.avatarUrl ?? undefined }
      : undefined,
    project: project
      ? { id: project.id, name: project.name, description: project.description ?? undefined }
      : undefined,
    parent: parent
      ? { id: parent.id, identifier: parent.identifier, title: parent.title }
      : undefined,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
    url: issue.url,
    labels: labels.nodes.map((l: any) => ({ id: l.id, name: l.name, color: l.color })),
    dueDate: issue.dueDate ? new Date(issue.dueDate).toISOString() : null,
  }
}
