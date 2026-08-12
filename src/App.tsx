import { useSession } from './timer/useSession'
import Today from './screens/Today'
import Workout from './screens/Workout'

export default function App() {
  const session = useSession()

  if (!session.ready) return <div className="loading">Loading…</div>

  return session.session ? <Workout {...session} /> : <Today {...session} />
}
