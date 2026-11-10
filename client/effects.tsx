import { useEffect, useRef } from 'react';
import confetti from 'canvas-confetti';
import type { BingoEvent } from '../shared/types.js';

let audio: AudioContext | undefined;
export function unlockAudio() {
  try { audio ??= new AudioContext(); void audio.resume(); } catch { /* Audio is optional on browsers without Web Audio. */ }
}

function playBingo(superBingo: boolean) {
  if (!audio || audio.state !== 'running') return;
  const notes = superBingo ? [659.25, 830.61, 987.77, 1318.51] : [659.25, 830.61, 987.77];
  notes.forEach((frequency, index) => {
    const oscillator = audio!.createOscillator(); const gain = audio!.createGain();
    const start = audio!.currentTime + index * 0.07;
    oscillator.type = 'sine'; oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(0.07, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
    oscillator.connect(gain); gain.connect(audio!.destination);
    oscillator.start(start); oscillator.stop(start + 0.24);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  });
}

export function PartyEffects({ event, reduced, sound }: { event: BingoEvent | null; reduced: boolean; sound: boolean }) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!event || last.current === event.id) return;
    last.current = event.id;
    if (sound) playBingo(event.points === 2);
    if (reduced) { confetti.reset(); return; }
    let shake: Animation | undefined;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        shake = document.getElementById('main')?.animate([
          { transform: 'translate(0)' }, { transform: 'translate(-2px, 1px)' },
          { transform: 'translate(3px, -1px)' }, { transform: 'translate(-2px, 2px)' },
          { transform: 'translate(1px, -1px)' }, { transform: 'translate(0)' },
        ], { duration: 190, easing: 'linear' });
        const target = [...document.querySelectorAll<HTMLElement>('[data-bingo-key]')]
          .find((element) => element.dataset.bingoKey === event.key && element.getBoundingClientRect().width > 0);
        const box = target?.getBoundingClientRect();
        const origin = box ? { x: (box.left + box.width / 2) / innerWidth, y: (box.top + box.height / 2) / innerHeight } : { x: 0.5, y: 0.35 };
        void confetti({ origin, particleCount: event.points === 2 ? 100 : 58, spread: 72, startVelocity: 27,
          gravity: 1.1, ticks: 135, scalar: 0.9, colors: ['#ffe76b', '#244ce7', '#ff6251', '#3abf68', '#fffaf0'],
          shapes: ['square', 'circle'], zIndex: 150, disableForReducedMotion: true });
      });
    });
    return () => { cancelAnimationFrame(frame); shake?.cancel(); };
  }, [event, reduced, sound]);
  useEffect(() => () => { confetti.reset(); }, []);
  return null;
}
