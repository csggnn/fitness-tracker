import { useEffect, useRef, useState } from 'react'

/**
 * Holds a screen wake lock for as long as `active` is true, including while the session is paused.
 *
 * The lock is released whenever the tab hides, so it is re-acquired on `visibilitychange`. The API
 * is absent on insecure origins, where this degrades to reporting unsupported.
 */
export function useWakeLock(active: boolean): { supported: boolean; held: boolean } {
  const sentinel = useRef<WakeLockSentinel | null>(null)
  const [held, setHeld] = useState(false)
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator

  useEffect(() => {
    if (!supported) return
    let cancelled = false

    const acquire = async () => {
      if (!active || document.visibilityState !== 'visible' || sentinel.current) return
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (cancelled) {
          await lock.release()
          return
        }
        sentinel.current = lock
        setHeld(true)
        lock.addEventListener('release', () => {
          sentinel.current = null
          setHeld(false)
        })
      } catch {
        setHeld(false)
      }
    }

    const release = async () => {
      const lock = sentinel.current
      sentinel.current = null
      setHeld(false)
      try {
        await lock?.release()
      } catch {
        // Already released by the platform.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    if (active) void acquire()
    else void release()

    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      void release()
    }
  }, [active, supported])

  return { supported, held }
}
