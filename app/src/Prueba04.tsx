import { SecureStorage } from '@aparajita/capacitor-secure-storage'
import { useCallback, useEffect, useState } from 'react'
import { completeHabit, listHabits, type Habit } from './api'
import { needsExactPermission, openExactSettings, scheduleTest } from './notify'

const TOKEN_KEY = 'grimoire-token'

/** Pantalla de prueba de la 0.4 (marcar contra la API desplegada y notificación).
 *  Ocupa /habitos hasta que la vista de Hábitos se porte en la fase 2. */
export default function Prueba04() {
  const [token, setToken] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [habits, setHabits] = useState<Habit[]>([])
  const [msg, setMsg] = useState('')
  const [askExact, setAskExact] = useState(false)

  // el token vive en el Keystore de Android, no en localStorage
  useEffect(() => {
    SecureStorage.get(TOKEN_KEY).then((t) => setToken(typeof t === 'string' ? t : ''))
    needsExactPermission().then(setAskExact, () => {})
  }, [])

  const load = useCallback(async () => {
    if (!token) return
    try {
      setHabits(await listHabits(token))
    } catch (e) {
      setMsg(String(e))
    }
  }, [token])

  useEffect(() => {
    load()
  }, [load])

  if (token === null) return null

  if (!token) {
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault()
          await SecureStorage.set(TOKEN_KEY, draft.trim())
          setToken(draft.trim())
        }}
      >
        <p>Token de la API:</p>
        <input type="password" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <button type="submit">Guardar</button>
      </form>
    )
  }

  return (
    <main>
      <h1>Hábitos</h1>
      <ul>
        {habits.map((h) => (
          <li key={h.id}>
            {h.name} — racha {h.streak}{' '}
            <button
              disabled={h.done_today}
              onClick={async () => {
                try {
                  const r = await completeHabit(token, h.id)
                  setMsg(`+${r.xp_earned} XP · nivel ${r.new_level} · racha ${r.streak}`)
                  await load()
                } catch (e) {
                  setMsg(String(e))
                }
              }}
            >
              {h.done_today ? 'Hecho' : 'Marcar'}
            </button>
          </li>
        ))}
      </ul>
      <button onClick={async () => setMsg(await scheduleTest().catch(String))}>
        Notificación en 2 min
      </button>
      {askExact && (
        <button
          onClick={async () => {
            await openExactSettings()
            setAskExact(await needsExactPermission())
          }}
        >
          Permitir alarmas exactas
        </button>
      )}
      <p>{msg}</p>
    </main>
  )
}
