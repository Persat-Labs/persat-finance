import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

interface SplashScreenProps {
  onFinish?: () => void
  minDuration?: number
}

export default function SplashScreen({ onFinish, minDuration = 1400 }: SplashScreenProps) {
  const [progress, setProgress] = useState(0)
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const p = Math.min(100, Math.floor((elapsed / minDuration) * 100))
      setProgress(p)

      if (p >= 100) {
        clearInterval(interval)
        setTimeout(() => {
          setIsVisible(false)
          if (onFinish) onFinish()
        }, 200)
      }
    }, 20)

    return () => clearInterval(interval)
  }, [minDuration, onFinish])

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.04 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#080503] text-[#ebe0d9] overflow-hidden select-none"
        >
          {/* Ambient Background Flare */}
          <div className="absolute w-[500px] h-[500px] rounded-full bg-[#ff8a00]/15 blur-[120px] pointer-events-none animate-pulse" />

          {/* Central Logo & Orbiting Rings */}
          <div className="relative w-36 h-36 flex items-center justify-center mb-8">
            {/* Outer Rotating Dash Ring */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-0 rounded-full border border-dashed border-[#ff8a00]/40"
            />

            {/* Inner Counter-Rotating Ring */}
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
              className="absolute inset-3 rounded-full border border-t-[#ffaa45] border-r-transparent border-b-[#ff8a00] border-l-transparent"
            />

            {/* Pulsing Ember Glow */}
            <motion.div
              animate={{ scale: [1, 1.15, 1], opacity: [0.4, 0.8, 0.4] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
              className="absolute w-20 h-20 rounded-full bg-[#ff8a00]/25 blur-lg"
            />

            {/* Central Logo */}
            <div className="relative z-10 w-16 h-16 rounded-2xl bg-[#17120f] border border-[#ff8a00]/60 flex items-center justify-center shadow-[0_0_30px_rgba(255,138,0,0.4)]">
              <img src="/persatlogo.png" alt="Persat" className="w-10 h-10 object-contain" />
            </div>
          </div>

          {/* Branding Title */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-center"
          >
            <h2 className="font-['Space_Grotesk'] text-2xl font-bold tracking-[0.25em] text-[#ebe0d9] uppercase mb-1">
              PERSAT
            </h2>
            <p className="font-['Space_Grotesk'] text-[11px] font-semibold text-[#ffb77f] tracking-widest uppercase">
              PEER-TO-PEER BITCOIN LENDING
            </p>
          </motion.div>

          {/* Progress Bar & Status */}
          <div className="w-56 mt-8">
            <div className="w-full bg-[#17120f] h-1.5 rounded-full overflow-hidden border border-[#564334]/40 mb-2">
              <motion.div
                className="h-full bg-gradient-to-r from-[#ffaa45] to-[#ff8a00] rounded-full shadow-[0_0_10px_#ff8a00]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between font-['Space_Grotesk'] text-[10px] text-[#a58c7b] uppercase">
              <span>Syncing Arc L1...</span>
              <span className="text-[#ff8a00] font-bold">{progress}%</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
