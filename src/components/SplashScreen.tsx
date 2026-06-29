import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';

interface SplashScreenProps {
  onComplete: () => void;
}

export default function SplashScreen({ onComplete }: SplashScreenProps) {
  const [phase, setPhase] = useState<'in' | 'hold' | 'out'>('in');

  useEffect(() => {
    // Phase 1: fade in (instant on mount via initial/animate)
    // Phase 2: hold for ~2s, then start fade out
    const holdTimer = setTimeout(() => setPhase('out'), 2200);
    // Phase 3: after fade-out animation (0.6s), call onComplete
    const completeTimer = setTimeout(() => onComplete(), 3000);

    return () => {
      clearTimeout(holdTimer);
      clearTimeout(completeTimer);
    };
  }, [onComplete]);

  const containerVariants = {
    in: { opacity: 1 },
    out: { opacity: 0 },
  };

  const logoVariants = {
    hidden: { opacity: 0, scale: 0.8, y: 20 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: { duration: 0.8, ease: [0.22, 1, 0.36, 1] },
    },
  };

  const titleVariants = {
    hidden: { opacity: 0, y: 15 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.7, delay: 0.3, ease: [0.22, 1, 0.36, 1] },
    },
  };

  const subtitleVariants = {
    hidden: { opacity: 0, y: 10 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.6, delay: 0.6, ease: [0.22, 1, 0.36, 1] },
    },
  };

  const barVariants = {
    hidden: { scaleX: 0 },
    visible: {
      scaleX: 1,
      transition: { duration: 2.2, delay: 0.5, ease: [0.25, 0.1, 0.25, 1] },
    },
  };

  return (
    <motion.div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{ background: '#05070A' }}
      variants={containerVariants}
      initial="in"
      animate={phase}
      transition={{ duration: 0.6, ease: 'easeInOut' }}
    >
      {/* Radial gradient glow */
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 45%, rgba(245,158,11,0.06) 0%, rgba(30,58,138,0.04) 40%, transparent 70%)',
        }}
      />

      {/* Logo */}
      <motion.div
        variants={logoVariants}
        initial="hidden"
        animate="visible"
        className="relative mb-8"
      >
        <motion.img
          src="/logo.svg"
          alt="Z-CAPITAL"
          width={80}
          height={80}
          className="drop-shadow-lg"
          animate={{
            filter: [
              'drop-shadow(0 0 8px rgba(245,158,11,0.3))',
              'drop-shadow(0 0 20px rgba(245,158,11,0.6))',
              'drop-shadow(0 0 8px rgba(245,158,11,0.3))',
            ],
          }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      </motion.div>

      {/* Title */}
      <motion.h1
        variants={titleVariants}
        initial="hidden"
        animate="visible"
        className="relative"
        style={{
          fontSize: '2rem',
          fontWeight: 900,
          letterSpacing: '0.15em',
          background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 50%, #f59e0b 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
          lineHeight: 1.2,
        }}
      >
        Z-CAPITAL
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        variants={subtitleVariants}
        initial="hidden"
        animate="visible"
        className="relative mt-3"
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '0.7rem',
          letterSpacing: '0.3em',
          color: '#94a3b8',
        }}
      >
        INSTITUTIONAL GATEWAY
      </motion.p>

      {/* Loading bar at bottom */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 w-64">
        <motion.div
          className="h-[2px] rounded-full origin-left"
          style={{
            background: 'linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b)',
          }}
          variants={barVariants}
          initial="hidden"
          animate="visible"
        />
        <motion.div
          className="mt-3 text-center"
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
            fontSize: '0.6rem',
            color: '#475569',
            letterSpacing: '0.15em',
          }}
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          INITIALIZING SECURE SESSION
        </motion.div>
      </div>
    </motion.div>
  );
}
