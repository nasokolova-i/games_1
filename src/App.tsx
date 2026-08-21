import { useState, useEffect, useCallback, useRef } from 'react';

// Types
type Speed = 'slow' | 'medium' | 'fast';
type GameState = 'start' | 'playing' | 'paused' | 'levelComplete' | 'gameOver' | 'victory';

interface Target {
  id: number;
  x: number;
  y: number;
  emoji: string;
  isTarget: boolean;
  scale: number;
  rotation: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
  size: number;
}

interface HighScore {
  score: number;
  speed: Speed;
  date: string;
}

// Constants
const SPEED_CONFIG = {
  slow: { label: 'Медленно', time: 20, color: '#4ade80' },
  medium: { label: 'Средне', time: 15, color: '#facc15' },
  fast: { label: 'Быстро', time: 11, color: '#f87171' },
};

const TOTAL_LEVELS = 5;
const TASKS_PER_LEVEL = 5;
const MAX_TARGETS = 5;

// Safe zone reserved for the HUD at the top of the screen.
// No game objects may ever be placed or drift into this band.
const HUD_SAFE_TOP = 190;
const EDGE_PADDING = 90;
const BOTTOM_PADDING = 110;

const GAME_EMOJIS = ['🎯', '⭐', '🎮', '🎪', '🎨', '🎭', '🎪', '🎸', '🎺', '🎻'];
const TARGET_EMOJI = '💎';

// Difficulty settings per level
const LEVEL_CONFIG = [
  { targetSize: 1, distractorCount: 2, moveSpeed: 0 },
  { targetSize: 1, distractorCount: 3, moveSpeed: 0.5 },
  { targetSize: 0.9, distractorCount: 3, moveSpeed: 1 },
  { targetSize: 0.85, distractorCount: 4, moveSpeed: 1.5 },
  { targetSize: 0.8, distractorCount: 4, moveSpeed: 2 },
];

// Main App Component
export default function App() {
  // Game State
  const [gameState, setGameState] = useState<GameState>('start');
  const [speed, setSpeed] = useState<Speed>('slow');
  const [currentLevel, setCurrentLevel] = useState(0);
  const [currentTask, setCurrentTask] = useState(0);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(SPEED_CONFIG.slow.time);
  const [totalTime, setTotalTime] = useState(0);
  const [targets, setTargets] = useState<Target[]>([]);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [highScores, setHighScores] = useState<HighScore[]>([]);
  const [hitFeedback, setHitFeedback] = useState<{ x: number; y: number; correct: boolean } | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  const gameLoopRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const gameContainerRef = useRef<HTMLDivElement>(null);
  const particleIdRef = useRef(0);
  const scoreRef = useRef(0);
  const hudRef = useRef<HTMLDivElement>(null);

  // Load high scores
  useEffect(() => {
    const saved = localStorage.getItem('selfRegulationHighScores');
    if (saved) {
      setHighScores(JSON.parse(saved));
    }
    setIsMobile('ontouchstart' in window);
  }, []);

  // Keep scoreRef in sync
  useEffect(() => {
    scoreRef.current = score;
  }, [score]);

  // Save high scores
  const saveHighScore = useCallback((newScore: number) => {
    const entry: HighScore = {
      score: newScore,
      speed,
      date: new Date().toLocaleDateString('ru-RU'),
    };
    const updated = [...highScores, entry]
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
    setHighScores(updated);
    localStorage.setItem('selfRegulationHighScores', JSON.stringify(updated));
  }, [highScores, speed]);

  // Playfield bounds: everything strictly below the HUD safe zone
  const getBounds = useCallback((rect: DOMRect) => {
    // Half of the largest object + its glow ring
    const objectRadius = 60;
    const hudHeight = hudRef.current?.getBoundingClientRect().height ?? 0;
    const safeTop = Math.max(HUD_SAFE_TOP, hudHeight + objectRadius + 16);

    const minX = EDGE_PADDING;
    const maxX = Math.max(minX + 1, rect.width - EDGE_PADDING);
    const minY = Math.min(safeTop, rect.height - BOTTOM_PADDING - 1);
    const maxY = Math.max(minY + 1, rect.height - BOTTOM_PADDING);
    return { minX, maxX, minY, maxY };
  }, []);

  // Generate targets
  const generateTargets = useCallback((level: number, containerRect: DOMRect) => {
    const config = LEVEL_CONFIG[level];
    const distractorCount = Math.min(config.distractorCount, MAX_TARGETS - 1);
    const totalTargets = distractorCount + 1;

    const { minX, maxX, minY, maxY } = getBounds(containerRect);
    const spanX = maxX - minX;
    const spanY = maxY - minY;

    const newTargets: Target[] = [];

    for (let i = 0; i < totalTargets; i++) {
      const emoji = i === 0 ? TARGET_EMOJI : GAME_EMOJIS[Math.floor(Math.random() * GAME_EMOJIS.length)];
      let x = minX + spanX / 2;
      let y = minY + spanY / 2;
      let minDist = 130;

      // Try to find a well-spaced spot; relax the spacing if the area is tight
      for (let attempt = 0; attempt < 120; attempt++) {
        const cx = minX + Math.random() * spanX;
        const cy = minY + Math.random() * spanY;

        const ok = newTargets.every(t => Math.hypot(t.x - cx, t.y - cy) > minDist);
        if (ok) {
          x = cx;
          y = cy;
          break;
        }
        if (attempt % 30 === 29) minDist = Math.max(70, minDist - 20);
      }

      newTargets.push({
        id: Date.now() + i * 1000 + Math.floor(Math.random() * 999),
        x,
        y,
        emoji,
        isTarget: i === 0,
        scale: config.targetSize,
        rotation: 0,
      });
    }

    // Shuffle so the correct target isn't always rendered first
    return newTargets.sort(() => Math.random() - 0.5);
  }, [getBounds]);

  // Start new task
  const startNewTask = useCallback(() => {
    if (!gameContainerRef.current) return;
    const rect = gameContainerRef.current.getBoundingClientRect();
    setTargets(generateTargets(currentLevel, rect));
  }, [currentLevel, generateTargets]);

  // Keep every object inside the playfield (never under the HUD)
  const clampTargets = useCallback((list: Target[]) => {
    const el = gameContainerRef.current;
    if (!el) return list;
    const { minX, maxX, minY, maxY } = getBounds(el.getBoundingClientRect());
    return list.map(t => ({
      ...t,
      x: Math.min(maxX, Math.max(minX, t.x)),
      y: Math.min(maxY, Math.max(minY, t.y)),
    }));
  }, [getBounds]);

  // Start game
  const startGame = useCallback(() => {
    setGameState('playing');
    setCurrentLevel(0);
    setCurrentTask(0);
    setScore(0);
    scoreRef.current = 0;
    setCombo(0);
    setTotalTime(0);
    setTimeLeft(SPEED_CONFIG[speed].time);
    lastTimeRef.current = performance.now();
  }, [speed]);

  // Spawn particles
  const spawnParticles = useCallback((x: number, y: number, color: string, count: number) => {
    const newParticles: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const speed = 2 + Math.random() * 4;
      newParticles.push({
        id: particleIdRef.current++,
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1,
        color,
        size: 8 + Math.random() * 12,
      });
    }
    setParticles(prev => [...prev, ...newParticles]);
  }, []);

  // Handle target click
  const handleTargetClick = useCallback((target: Target, event: React.MouseEvent | React.TouchEvent) => {
    if (gameState !== 'playing') return;
    event.preventDefault();
    event.stopPropagation();
    
    let clientX: number;
    let clientY: number;
    
    if ('touches' in event && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
    } else if ('changedTouches' in event && event.changedTouches.length > 0) {
      clientX = event.changedTouches[0].clientX;
      clientY = event.changedTouches[0].clientY;
    } else {
      clientX = (event as React.MouseEvent).clientX;
      clientY = (event as React.MouseEvent).clientY;
    }

    if (target.isTarget) {
      // Correct hit!
      const points = 100 * (1 + combo * 0.1) * LEVEL_CONFIG[currentLevel].targetSize;
      setScore(prev => Math.round(prev + points));
      setCombo(prev => prev + 1);
      spawnParticles(clientX, clientY, '#4ade80', 12);
      setHitFeedback({ x: clientX, y: clientY, correct: true });
      setTimeout(() => setHitFeedback(null), 500);

      // Next task or level
      if (currentTask < TASKS_PER_LEVEL - 1) {
        setCurrentTask(prev => prev + 1);
      } else if (currentLevel < TOTAL_LEVELS - 1) {
        setGameState('levelComplete');
      } else {
        setGameState('victory');
        saveHighScore(score + Math.round(points));
      }
    } else {
      // Wrong hit!
      setCombo(0);
      spawnParticles(clientX, clientY, '#f87171', 8);
      setHitFeedback({ x: clientX, y: clientY, correct: false });
      setTimeout(() => setHitFeedback(null), 500);
    }
  }, [gameState, combo, currentLevel, currentTask, spawnParticles]);

  // Game loop
  useEffect(() => {
    if (gameState !== 'playing') return;

    const animate = (currentTime: number) => {
      const delta = (currentTime - lastTimeRef.current) / 1000;
      lastTimeRef.current = currentTime;

      // Update timer
      setTimeLeft(prev => {
        const newTime = prev - delta;
        if (newTime <= 0) {
          setGameState('gameOver');
          saveHighScore(scoreRef.current);
          return 0;
        }
        return newTime;
      });

      setTotalTime(prev => prev + delta);

      // Update particles
      setParticles(prev => 
        prev
          .map(p => ({
            ...p,
            x: p.x + p.vx,
            y: p.y + p.vy,
            vy: p.vy + 0.1,
            life: p.life - 0.02,
          }))
          .filter(p => p.life > 0)
      );

      // Move targets if needed (always clamped to the playfield)
      const moveSpeed = LEVEL_CONFIG[currentLevel].moveSpeed;
      if (moveSpeed > 0) {
        setTargets(prev => clampTargets(prev.map(t => ({
          ...t,
          x: t.x + Math.sin(currentTime / 900 + t.id) * moveSpeed,
          y: t.y + Math.cos(currentTime / 900 + t.id * 0.7) * moveSpeed * 0.5,
          rotation: t.rotation + moveSpeed,
        }))));
      }

      gameLoopRef.current = requestAnimationFrame(animate);
    };

    gameLoopRef.current = requestAnimationFrame(animate);

    return () => {
      if (gameLoopRef.current) {
        cancelAnimationFrame(gameLoopRef.current);
      }
    };
  }, [gameState, currentLevel, saveHighScore, clampTargets]);

  // Re-clamp objects when the window is resized / rotated
  useEffect(() => {
    const onResize = () => setTargets(prev => clampTargets(prev));
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [clampTargets]);

  // Start new task when task/level changes
  useEffect(() => {
    if (gameState === 'playing') {
      startNewTask();
    }
  }, [gameState, currentTask, currentLevel, startNewTask]);

  // Reset timer when starting level
  useEffect(() => {
    if (gameState === 'playing') {
      setTimeLeft(SPEED_CONFIG[speed].time);
    }
  }, [gameState, speed, currentLevel]);

  // Return to the main menu (saves progress to the high-score table)
  const goHome = useCallback(() => {
    if (scoreRef.current > 0) {
      saveHighScore(scoreRef.current);
    }
    setGameState('start');
    setTargets([]);
    setParticles([]);
    setHitFeedback(null);
    setCombo(0);
    setScore(0);
    scoreRef.current = 0;
    setCurrentLevel(0);
    setCurrentTask(0);
    setTotalTime(0);
    setTimeLeft(SPEED_CONFIG[speed].time);
  }, [saveHighScore, speed]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'Escape') {
        e.preventDefault();
        if (gameState === 'playing') {
          setGameState('paused');
        } else if (gameState === 'paused') {
          setGameState('playing');
          lastTimeRef.current = performance.now();
        }
      }
      if (e.code === 'Enter' && (gameState === 'start' || gameState === 'gameOver' || gameState === 'victory')) {
        startGame();
      }
      // H — вернуться на главную
      if ((e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') && gameState !== 'start') {
        e.preventDefault();
        goHome();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameState, startGame, goHome]);

  // Next level
  const nextLevel = useCallback(() => {
    setCurrentLevel(prev => prev + 1);
    setCurrentTask(0);
    setTimeLeft(SPEED_CONFIG[speed].time);
    setGameState('playing');
    lastTimeRef.current = performance.now();
  }, [speed]);

  // Render
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 overflow-hidden">
      <div 
        ref={gameContainerRef}
        className="relative w-full h-screen"
        style={{ touchAction: 'none' }}
      >
        {/* Background particles */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute rounded-full bg-purple-500/20 animate-float"
              style={{
                width: 4 + Math.random() * 8,
                height: 4 + Math.random() * 8,
                left: `${Math.random() * 100}%`,
                top: `${Math.random() * 100}%`,
                animationDelay: `${Math.random() * 5}s`,
                animationDuration: `${3 + Math.random() * 4}s`,
              }}
            />
          ))}
        </div>

        {/* Start Screen */}
        {gameState === 'start' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-20">
            <div className="text-center space-y-6 max-w-lg">
              {/* Logo/Title */}
              <div className="space-y-4">
                <div className="text-8xl animate-bounce">💎</div>
                <h1 className="text-4xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400">
                  Тренажёр
                </h1>
                <h2 className="text-2xl md:text-4xl font-bold text-white">
                  Саморегуляции
                </h2>
                <p className="text-purple-300 text-lg">Задание №5 • Точность</p>
              </div>

              {/* Game Info Card */}
              <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 space-y-5">
                {/* How to play */}
                <div className="space-y-3">
                  <p className="text-white font-medium text-lg">Как играть:</p>
                  <div className="flex items-center justify-center gap-4 text-2xl">
                    <span className="text-4xl animate-pulse">💎</span>
                    <span className="text-purple-300">→</span>
                    <span className="text-4xl">❌</span>
                    <span className="text-purple-300">→</span>
                    <span className="text-4xl">✅</span>
                  </div>
                  <p className="text-purple-200 text-sm">
                    Нажимайте только на <span className="text-cyan-400 font-bold">💎 алмазы!</span><br/>
                    Избегайте других предметов
                  </p>
                </div>

                {/* Game structure */}
                <div className="flex justify-center gap-2">
                  {[...Array(TOTAL_LEVELS)].map((_, i) => (
                    <div key={i} className="flex flex-col items-center">
                      <div className="w-8 h-8 rounded-full bg-purple-500/30 border-2 border-purple-400 flex items-center justify-center text-white text-sm font-bold">
                        {i + 1}
                      </div>
                      <span className="text-[10px] text-purple-300 mt-1">×5</span>
                    </div>
                  ))}
                </div>

                {/* Speed Selection */}
                <div className="space-y-3">
                  <p className="text-white font-medium">Выберите скорость:</p>
                  <div className="flex gap-3 justify-center flex-wrap">
                    {(Object.keys(SPEED_CONFIG) as Speed[]).map((key) => (
                      <button
                        key={key}
                        onClick={() => setSpeed(key)}
                        className={`px-5 py-3 rounded-2xl font-bold transition-all duration-300 ${
                          speed === key
                            ? 'scale-110 shadow-lg ring-2 ring-white/50'
                            : 'opacity-60 hover:opacity-100'
                        }`}
                        style={{
                          backgroundColor: speed === key ? SPEED_CONFIG[key].color : 'rgba(255,255,255,0.1)',
                          color: speed === key ? '#000' : '#fff',
                        }}
                      >
                        <span className="text-lg">{SPEED_CONFIG[key].label}</span>
                        <span className="block text-xs opacity-80">{SPEED_CONFIG[key].time} сек/уровень</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Start Button */}
              <button
                onClick={startGame}
                className="relative group px-12 py-5 bg-gradient-to-r from-green-500 to-emerald-500 rounded-full text-white text-2xl font-bold hover:scale-105 transition-all duration-300 shadow-2xl btn-glow"
              >
                <span className="relative z-10 flex items-center gap-3">
                  <span>🎮</span>
                  <span>Начать игру</span>
                </span>
                <div className="absolute inset-0 bg-gradient-to-r from-green-400 to-emerald-400 rounded-full blur-xl opacity-50 group-hover:opacity-75 transition-opacity" />
              </button>

              {/* Controls hint */}
              <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 text-purple-400 text-sm">
                <span>⌨️ Пробел — пауза</span>
                <span>🏠 H — на главную</span>
                <span>📱 Тап — клик</span>
              </div>
            </div>
          </div>
        )}

        {/* Playing State */}
        {(gameState === 'playing' || gameState === 'paused') && (
          <>
            {/* HUD (never intercepts gameplay clicks) */}
            <div ref={hudRef} className="absolute top-0 left-0 right-0 p-4 z-20 pointer-events-none select-none">
              {/* Level Progress Bar */}
              <div className="max-w-4xl mx-auto mb-3">
                <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-cyan-500 rounded-full level-progress"
                    style={{ width: `${((currentLevel * TASKS_PER_LEVEL + currentTask) / (TOTAL_LEVELS * TASKS_PER_LEVEL)) * 100}%` }}
                  />
                </div>
                <div className="flex justify-between mt-1 px-1">
                  {[...Array(TOTAL_LEVELS)].map((_, i) => (
                    <div key={i} className={`w-3 h-3 rounded-full transition-all duration-300 ${
                      i < currentLevel ? 'bg-green-400' : i === currentLevel ? 'bg-yellow-400 scale-125' : 'bg-white/30'
                    }`} />
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-start max-w-4xl mx-auto gap-2">
                {/* Left cluster: controls + level info */}
                <div className="flex items-start gap-2">
                  {/* Control buttons (clickable inside the non-interactive HUD) */}
                  <div className="flex flex-col gap-2 pointer-events-auto">
                    <button
                      onClick={goHome}
                      aria-label="В главное меню"
                      title="В главное меню"
                      className="w-11 h-11 flex items-center justify-center text-xl bg-black/50 hover:bg-purple-600/70 backdrop-blur-lg rounded-2xl border border-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
                    >
                      🏠
                    </button>
                    <button
                      onClick={() => {
                        if (gameState === 'playing') {
                          setGameState('paused');
                        } else {
                          setGameState('playing');
                          lastTimeRef.current = performance.now();
                        }
                      }}
                      aria-label={gameState === 'playing' ? 'Пауза' : 'Продолжить'}
                      title={gameState === 'playing' ? 'Пауза' : 'Продолжить'}
                      className="w-11 h-11 flex items-center justify-center text-xl bg-black/50 hover:bg-purple-600/70 backdrop-blur-lg rounded-2xl border border-white/10 transition-all duration-200 hover:scale-110 active:scale-95"
                    >
                      {gameState === 'playing' ? '⏸' : '▶'}
                    </button>
                  </div>

                  {/* Level/Task */}
                  <div className="bg-black/40 backdrop-blur-lg rounded-2xl px-4 py-3">
                    <p className="text-purple-300 text-sm">Уровень {currentLevel + 1}/{TOTAL_LEVELS}</p>
                    <p className="text-white font-bold">Задание {currentTask + 1}/{TASKS_PER_LEVEL}</p>
                  </div>
                </div>

                {/* Timer */}
                <div className={`bg-black/40 backdrop-blur-lg rounded-2xl px-6 py-3 text-center ${
                  timeLeft < 5 ? 'animate-pulse bg-red-500/40' : ''
                }`}>
                  <p className="text-purple-300 text-sm">Время</p>
                  <p className={`text-3xl font-bold font-mono ${
                    timeLeft < 5 ? 'text-red-400' : 'text-white'
                  }`}>
                    {timeLeft.toFixed(1)}
                  </p>
                </div>

                {/* Score */}
                <div className="bg-black/40 backdrop-blur-lg rounded-2xl px-4 py-3 text-right">
                  <p className="text-purple-300 text-sm">Очки</p>
                  <p className="text-2xl font-bold text-yellow-400 score-pop" key={score}>{score}</p>
                  {combo > 1 && (
                    <div className="mt-1 px-3 py-1 bg-gradient-to-r from-cyan-500 to-purple-500 rounded-full animate-bounce">
                      <p className="text-white text-sm font-bold">×{combo} КОМБО!</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Playfield separator under the HUD */}
            <div
              className="absolute left-0 right-0 pointer-events-none z-10"
              style={{
                top: HUD_SAFE_TOP - 34,
                height: 1,
                background: 'linear-gradient(90deg, transparent, rgba(168,85,247,0.35), transparent)',
              }}
            />

            {/* Targets */}
            {targets.map((target) => (
              <div
                key={target.id}
                className={`absolute z-10 ${
                  gameState === 'paused' ? 'pointer-events-none opacity-50' : ''
                }`}
                style={{
                  left: target.x,
                  top: target.y,
                  transform: `translate(-50%, -50%) rotate(${target.rotation}deg)`,
                  willChange: 'transform',
                }}
              >
                <button
                  onClick={(e) => handleTargetClick(target, e)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleTargetClick(target, e);
                  }}
                  className="relative block transition-all duration-100 hover:scale-110 active:scale-90 focus:outline-none"
                  style={{
                    fontSize: `${target.scale * (isMobile ? 70 : 90)}px`,
                    lineHeight: 1,
                    filter: target.isTarget ? 'drop-shadow(0 0 25px rgba(96, 165, 250, 0.9))' : 'none',
                  }}
                >
                  <span className={target.isTarget ? 'animate-pulse' : ''}>
                    {target.emoji}
                  </span>
                </button>
                {target.isTarget && (
                  <div 
                    className="absolute pointer-events-none animate-ping opacity-30"
                    style={{
                      inset: '-8px',
                      border: '4px solid #60a5fa',
                      borderRadius: '50%',
                    }}
                  />
                )}
              </div>
            ))}

            {/* Particles */}
            {particles.map((p) => (
              <div
                key={p.id}
                className="absolute rounded-full pointer-events-none"
                style={{
                  left: p.x,
                  top: p.y,
                  width: p.size,
                  height: p.size,
                  backgroundColor: p.color,
                  opacity: p.life,
                  transform: 'translate(-50%, -50%)',
                }}
              />
            ))}

            {/* Hit Feedback */}
            {hitFeedback && (
              <div
                className="absolute pointer-events-none z-30 animate-hitFeedback"
                style={{
                  left: hitFeedback.x,
                  top: hitFeedback.y,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <span className={`text-4xl font-bold ${hitFeedback.correct ? 'text-green-400' : 'text-red-400'}`}>
                  {hitFeedback.correct ? '+' + Math.round(100 * (1 + combo * 0.1)) : '✕'}
                </span>
              </div>
            )}

            {/* Pause overlay */}
            {gameState === 'paused' && (
              <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-30">
                <div className="text-center space-y-6 p-6">
                  <h2 className="text-5xl font-bold text-white">⏸️ Пауза</h2>
                  <div className="bg-white/10 backdrop-blur-lg rounded-2xl px-8 py-4">
                    <p className="text-purple-200">
                      Очки: <span className="text-yellow-400 font-bold">{score}</span>
                    </p>
                    <p className="text-purple-300 text-sm">
                      Уровень {currentLevel + 1}/{TOTAL_LEVELS} • Задание {currentTask + 1}/{TASKS_PER_LEVEL}
                    </p>
                  </div>
                  <p className="text-purple-300 text-sm">Нажмите Пробел для продолжения</p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={() => {
                        setGameState('playing');
                        lastTimeRef.current = performance.now();
                      }}
                      className="px-8 py-4 bg-gradient-to-r from-purple-500 to-pink-500 rounded-full text-white text-xl font-bold hover:scale-105 transition-transform"
                    >
                      ▶ Продолжить
                    </button>
                    <button
                      onClick={goHome}
                      className="px-8 py-4 bg-white/10 hover:bg-white/20 border border-white/20 rounded-full text-white text-xl font-bold hover:scale-105 transition-all"
                    >
                      🏠 На главную
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Level Complete */}
        {gameState === 'levelComplete' && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20 overflow-hidden">
            {/* Floating stars */}
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className="absolute text-2xl animate-float"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 2}s`,
                    opacity: 0.6,
                  }}
                >
                  {['⭐', '✨', '🌟', '💫'][Math.floor(Math.random() * 4)]}
                </div>
              ))}
            </div>

            <div className="text-center space-y-8 p-8 max-w-md relative z-10">
              <div className="space-y-4">
                <div className="flex justify-center gap-2 text-4xl animate-bounce">
                  <span>⭐</span>
                  <span>⭐</span>
                  <span>⭐</span>
                </div>
                <h2 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-cyan-400">
                  Уровень пройден!
                </h2>
                <p className="text-purple-300 text-lg">Уровень {currentLevel + 1} завершён</p>
              </div>
              
              <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 space-y-4">
                <div className="flex justify-center gap-8">
                  <div className="text-center">
                    <p className="text-purple-300 text-sm">Очки</p>
                    <p className="text-3xl font-bold text-yellow-400">{score}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-purple-300 text-sm">Время</p>
                    <p className="text-3xl font-bold text-white">{totalTime.toFixed(1)}с</p>
                  </div>
                </div>
                <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 rounded-xl p-3">
                  <p className="text-purple-200">Следующий: Уровень {currentLevel + 2}</p>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={nextLevel}
                  className="w-full px-12 py-5 bg-gradient-to-r from-green-500 to-cyan-500 rounded-full text-white text-2xl font-bold hover:scale-105 transition-all duration-300 shadow-2xl btn-glow"
                >
                  <span className="flex items-center justify-center gap-3">
                    <span>Следующий уровень</span>
                    <span>→</span>
                  </span>
                </button>
                <button
                  onClick={goHome}
                  className="text-purple-300 hover:text-white transition-colors"
                >
                  🏠 На главную
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Victory */}
        {gameState === 'victory' && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20 overflow-hidden">
            {/* Confetti effect */}
            <div className="absolute inset-0 pointer-events-none">
              {[...Array(30)].map((_, i) => (
                <div
                  key={i}
                  className="absolute animate-float"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animationDelay: `${Math.random() * 3}s`,
                    animationDuration: `${2 + Math.random() * 3}s`,
                    fontSize: `${20 + Math.random() * 20}px`,
                  }}
                >
                  {['🏆', '👑', '💎', '⭐', '🎉', '🎊', '🥇', '✨'][Math.floor(Math.random() * 8)]}
                </div>
              ))}
            </div>

            <div className="text-center space-y-8 p-8 max-w-md relative z-10">
              <div className="space-y-4">
                <div className="text-8xl animate-bounce">🏆</div>
                <h2 className="text-4xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-pink-400 to-purple-400">
                  Победа!
                </h2>
                <p className="text-purple-300 text-xl">Все 5 уровней пройдены!</p>
              </div>
              
              <div className="bg-gradient-to-r from-yellow-500/20 to-orange-500/20 backdrop-blur-lg rounded-3xl p-8 space-y-4 border-2 border-yellow-400/30">
                <p className="text-2xl text-white">Финальные очки</p>
                <p className="text-6xl font-bold text-yellow-400 animate-pulse">{score}</p>
                <div className="flex justify-center gap-8 pt-2">
                  <div className="text-center">
                    <p className="text-purple-300 text-sm">Время</p>
                    <p className="text-2xl font-bold text-white">{totalTime.toFixed(1)}с</p>
                  </div>
                  <div className="text-center">
                    <p className="text-purple-300 text-sm">Скорость</p>
                    <p className="text-2xl font-bold" style={{ color: SPEED_CONFIG[speed].color }}>
                      {SPEED_CONFIG[speed].label}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  onClick={startGame}
                  className="w-full px-12 py-5 bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full text-white text-2xl font-bold hover:scale-105 transition-all duration-300 shadow-2xl btn-glow"
                >
                  <span className="flex items-center justify-center gap-3">
                    <span>🔄</span>
                    <span>Играть снова</span>
                  </span>
                </button>
                <button
                  onClick={() => setGameState('start')}
                  className="text-purple-300 hover:text-white transition-colors"
                >
                  🏠 На главную
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Game Over */}
        {gameState === 'gameOver' && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-20">
            <div className="text-center space-y-8 p-8 max-w-md">
              <div className="space-y-4">
                <div className="text-7xl animate-pulse">⏰</div>
                <h2 className="text-4xl md:text-5xl font-bold text-red-400">
                  Время вышло!
                </h2>
              </div>
              
              <div className="bg-white/10 backdrop-blur-lg rounded-3xl p-6 space-y-4">
                <div className="flex justify-center gap-8">
                  <div className="text-center">
                    <p className="text-purple-300 text-sm">Очки</p>
                    <p className="text-4xl font-bold text-yellow-400">{score}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-purple-300 text-sm">Прогресс</p>
                    <p className="text-4xl font-bold text-white">
                      {currentLevel + 1}/{TOTAL_LEVELS}
                    </p>
                  </div>
                </div>
                <p className="text-purple-200">Задание {currentTask + 1} не выполнено</p>
              </div>

              <div className="space-y-4">
                <button
                  onClick={startGame}
                  className="w-full px-12 py-5 bg-gradient-to-r from-red-500 to-pink-500 rounded-full text-white text-2xl font-bold hover:scale-105 transition-all duration-300 shadow-2xl btn-glow"
                >
                  <span className="flex items-center justify-center gap-3">
                    <span>🔄</span>
                    <span>Попробовать снова</span>
                  </span>
                </button>
                <button
                  onClick={() => setGameState('start')}
                  className="text-purple-300 hover:text-white transition-colors"
                >
                  🏠 На главную
                </button>
              </div>
            </div>
          </div>
        )}

        {/* High Scores */}
        {gameState === 'start' && highScores.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
            <div className="max-w-lg mx-auto bg-black/40 backdrop-blur-lg rounded-2xl p-4">
              <h3 className="text-white font-bold mb-2 text-center">🏆 Таблица лидеров</h3>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {highScores.slice(0, 5).map((hs, i) => (
                  <div key={i} className="flex justify-between items-center text-sm px-2">
                    <span className="text-purple-300">
                      {i + 1}. {hs.date}
                    </span>
                    <span className="text-yellow-400 font-bold">{hs.score}</span>
                    <span style={{ color: SPEED_CONFIG[hs.speed].color }}>
                      {SPEED_CONFIG[hs.speed].label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
