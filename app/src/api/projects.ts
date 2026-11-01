import { useQuery } from '@tanstack/react-query'
import { v7 as uuidv7 } from 'uuid'
import type { ApiProject, ProjectInput } from '../types'
import { get, type ApiRequest } from './client'
import { enqueue, useQueue, type QueueEntry } from './queryClient'

type Named = Pick<ApiProject, 'id' | 'name'>

export const projectRequests = {
  create: (input: ProjectInput): ApiRequest => ({
    method: 'POST',
    path: '/projects',
    body: { id: uuidv7(), ...input },
    label: `Crear ${input.name}`,
  }),
  update: (p: Named, patch: Partial<ProjectInput>): ApiRequest => ({
    method: 'PATCH',
    path: `/projects/${p.id}`,
    body: patch,
    label: `Editar ${p.name}`,
  }),
  remove: (p: Named): ApiRequest => ({
    method: 'DELETE',
    path: `/projects/${p.id}`,
    label: `Borrar ${p.name}`,
  }),
}

/** Los conteos de tareas no se predicen: son un agregado del servidor y cambian al sincronizar. */
export function applyProjectQueue(
  projects: ApiProject[],
  entries: Pick<QueueEntry, 'request' | 'status'>[],
): { projects: ApiProject[]; pendingIds: Set<string> } {
  let out = projects
  const pendingIds = new Set<string>()
  for (const { request: r, status } of entries) {
    if (status !== 'pending' && status !== 'success') continue
    const [, resource, id] = r.path.split('/')
    if (resource !== 'projects') continue
    const body = r.body as Record<string, never> | undefined
    const target = id ?? (body?.id as string | undefined)
    if (target && status === 'pending') pendingIds.add(target)

    if (r.method === 'POST') {
      if (out.some((p) => p.id === target)) continue
      out = [{
        description: null,
        status: 'active',
        color: '#9b7fc4', // el mismo valor por defecto del servidor
        category: null,
        created_at: new Date().toISOString(),
        tasks_total: 0,
        tasks_pending: 0,
        ...(body as unknown as ProjectInput & { id: string }),
      }, ...out] // la lista va de la más reciente a la más antigua
    } else if (r.method === 'PATCH') {
      out = out.map((p) => (p.id === id ? { ...p, ...(body as Partial<ApiProject>) } : p))
    } else if (r.method === 'DELETE') {
      out = out.filter((p) => p.id !== id)
    }
  }
  return { projects: out, pendingIds }
}

export function useProjects() {
  const query = useQuery({ queryKey: ['projects'], queryFn: () => get<ApiProject[]>('/projects') })
  const queue = useQueue()
  return { query, queue, ...applyProjectQueue(query.data ?? [], queue) }
}

export const projectActions = {
  create: (input: ProjectInput) => enqueue(projectRequests.create(input)),
  update: (p: Named, patch: Partial<ProjectInput>) => enqueue(projectRequests.update(p, patch)),
  remove: (p: Named) => enqueue(projectRequests.remove(p)),
}
