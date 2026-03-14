import React, { useState, useEffect } from 'react';
import { Mic, Play, Trophy, Flame, Users } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useTelegram } from '../lib/telegram';
import { RecordButton } from './RecordButton';
import confetti from 'canvas-confetti'; // npm install canvas-confetti (or use your own)

interface Battle {
  id: string;
  challenger_id: string;
  opponent_id: string;
  status: 'waiting' | 'recording' | 'judging' | 'finished';
  streak_multiplier: number;
  tip_pot: number;
}

interface VoiceEntry {
  id: string;
  user_id: string;
  voice_url: string;
  roast_text?: string;
  score?: number;
}

interface BattleArenaProps {
  battleId: string;
}

export const BattleArena: React.FC<BattleArenaProps> = ({ battleId }) => {
  const { user } = useTelegram(); // tg user from our existing hook
  const [battle, setBattle] = useState<Battle | null>(null);
  const [voices, setVoices] = useState<VoiceEntry[]>([]);
  const [myVoice, setMyVoice] = useState<string | null>(null);
  const [opponentVoice, setOpponentVoice] = useState<string | null>(null);
  const [isJudging, setIsJudging] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);

  const isChallenger = user?.id === battle?.challenger_id;
  const opponentId = isChallenger ? battle?.opponent_id : battle?.challenger_id;

  // Fetch initial battle + voices
  useEffect(() => {
    const fetchBattle = async () => {
      const { data: b } = await supabase.from('battles').select('*').eq('id', battleId).single();
      setBattle(b);

      const { data: v } = await supabase
        .from('battle_voices')
        .select('*')
        .eq('battle_id', battleId);
      setVoices(v || []);
    };

    fetchBattle();

    // Realtime subscriptions
    const battleSub = supabase
      .channel('battle')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battles', filter: `id=eq.${battleId}` }, (payload) => {
        setBattle(payload.new as Battle);
      })
      .subscribe();

    const voicesSub = supabase
      .channel('voices')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battle_voices', filter: `battle_id=eq.${battleId}` }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setVoices((prev) => [...prev, payload.new as VoiceEntry]);
        }
      })
      .subscribe();

    return () => {
      battleSub.unsubscribe();
      voicesSub.unsubscribe();
    };
  }, [battleId]);

  // Separate my voice & opponent voice
  useEffect(() => {
    const myV = voices.find((v) => v.user_id === user?.id);
    const oppV = voices.find((v) => v.user_id === opponentId);

    setMyVoice(myV?.voice_url || null);
    setOpponentVoice(oppV?.voice_url || null);

    // Auto-judge when both voices are in
    if (voices.length === 2 && battle?.status === 'recording') {
      triggerJudgement();
    }
  }, [voices, battle, opponentId, user]);

  const triggerJudgement = async () => {
    setIsJudging(true);
    // Call our Vercel API (we'll add this next if you want)
    const res = await fetch('/api/battle/judge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ battleId }),
    });
    const result = await res.json();

    setWinner(result.winner);
    setBattle((prev) => prev ? { ...prev, status: 'finished' } : null);

    // Flame confetti for winner
    if (result.winner === user?.id) {
      confetti({ particleCount: 200, spread: 100, origin: { y: 0.6 } });
    }
    setIsJudging(false);
  };

  const handleVoiceUploaded = (url: string) => {
    setMyVoice(url);
    // Status updates automatically via realtime
  };

  const sendTip = async (amount: number) => {
    // TON Connect send to tip_pot (use our existing TON hook)
    alert(`Sending ${amount} TON to the pot 🔥 (TON Connect wired in next step)`);
    // Real impl: use tonConnectUI.sendTransaction...
  };

  if (!battle) return <div className="text-center py-20">Loading arena... 🔥</div>;

  const statusText = {
    waiting: 'Waiting for opponent...',
    recording: 'Record your 15s roast!',
    judging: 'AI judging the savagery...',
    finished: winner ? `${winner === user?.id ? 'YOU WIN' : 'OPPONENT WINS'} THE BATTLE!` : '',
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-black via-zinc-950 to-black text-white overflow-hidden">
      {/* HEADER */}
      <div className="flex items-center justify-between p-4 border-b border-orange-500/30">
        <div className="flex items-center gap-3">
          <Flame className="w-8 h-8 text-orange-500" />
          <div>
            <h1 className="text-2xl font-bold tracking-tighter">VOICE ROAST ARENA</h1>
            <p className="text-orange-400 text-sm">Streak ×{battle.streak_multiplier}</p>
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs opacity-60">POT</div>
          <div className="text-2xl font-mono font-bold text-lime-400 flex items-center gap-1">
            {battle.tip_pot} <span className="text-sm">TON</span>
          </div>
        </div>
      </div>

      {/* LIVE VS SCREEN */}
      <div className="relative p-6">
        <div className="flex items-center justify-center gap-8">
          {/* YOU */}
          <div className={`flex-1 text-center transition-all ${winner === user?.id ? 'scale-110' : ''}`}>
            <div className="w-24 h-24 mx-auto rounded-full overflow-hidden border-4 border-orange-500 ring-4 ring-orange-500/30">
              <img src={user?.photo_url || 'https://avatar.iran.liara.run/public'} alt="You" className="w-full h-full object-cover" />
            </div>
            <p className="mt-3 font-bold text-xl">{user?.first_name} (YOU)</p>
            <p className="text-xs opacity-60">Streak 🔥 {Math.floor(Math.random() * 20) + 5}</p>

            {/* YOUR RECORD / PLAYBACK */}
            {!myVoice ? (
              <RecordButton battleId={battleId} onRecordingComplete={handleVoiceUploaded} />
            ) : (
              <div className="mt-6 flex justify-center">
                <audio controls className="w-48 accent-orange-500">
                  <source src={myVoice} type="audio/webm" />
                </audio>
              </div>
            )}
          </div>

          {/* VS FLAME DIVIDER */}
          <div className="flex flex-col items-center -mt-8">
            <div className="text-[80px] font-black text-transparent bg-clip-text bg-gradient-to-b from-orange-500 to-red-600 rotate-12">
              VS
            </div>
            <Flame className="w-12 h-12 text-red-600 animate-pulse -mt-6" />
          </div>

          {/* OPPONENT */}
          <div className={`flex-1 text-center transition-all ${winner && winner !== user?.id ? 'scale-110' : ''}`}>
            <div className="w-24 h-24 mx-auto rounded-full overflow-hidden border-4 border-purple-500 ring-4 ring-purple-500/30">
              <img src="https://avatar.iran.liara.run/public" alt="Opponent" className="w-full h-full object-cover" />
            </div>
            <p className="mt-3 font-bold text-xl">Opponent</p>
            <p className="text-xs opacity-60">Streak 🔥 {Math.floor(Math.random() * 20) + 5}</p>

            {/* OPPONENT PLAYBACK */}
            {opponentVoice && (
              <div className="mt-6 flex justify-center">
                <audio controls className="w-48 accent-purple-500">
                  <source src={opponentVoice} type="audio/webm" />
                </audio>
              </div>
            )}
          </div>
        </div>

        {/* STATUS BAR */}
        <div className="mt-10 text-center">
          <div className="inline-flex items-center gap-2 bg-zinc-900/80 px-6 py-2 rounded-full border border-orange-500/20">
            <div className={`w-3 h-3 rounded-full animate-pulse ${battle.status === 'finished' ? 'bg-lime-400' : 'bg-red-500'}`} />
            <span className="font-mono uppercase tracking-widest text-sm">
              {statusText[battle.status]}
            </span>
          </div>
        </div>

        {/* TIP POT + SPECTATOR BUTTONS */}
        {battle.status !== 'finished' && (
          <div className="mt-8 flex gap-3 justify-center">
            {[0.1, 0.5, 1].map((amt) => (
              <button
                key={amt}
                onClick={() => sendTip(amt)}
                className="bg-gradient-to-r from-lime-500 to-emerald-600 px-6 py-3 rounded-2xl font-bold flex items-center gap-2 hover:scale-105 active:scale-95 transition-transform"
              >
                <Users className="w-5 h-5" /> +{amt} TON to pot
              </button>
            ))}
          </div>
        )}

        {/* RESULTS PANEL (after judge) */}
        {battle.status === 'finished' && voices.length === 2 && (
          <div className="mt-12 bg-zinc-900/70 border border-orange-500/30 rounded-3xl p-8">
            <div className="text-center mb-8">
              <Trophy className="w-16 h-16 mx-auto text-yellow-400 mb-2" />
              <h2 className="text-4xl font-black">BATTLE OVER</h2>
            </div>

            <div className="grid grid-cols-2 gap-8">
              {/* YOUR ROAST */}
              <div className={`p-6 rounded-2xl ${winner === user?.id ? 'bg-gradient-to-br from-orange-500/20 to-transparent border-2 border-orange-500' : 'bg-zinc-800/50'}`}>
                <p className="text-xs opacity-60 mb-2">YOUR ROAST</p>
                <p className="italic text-lg leading-snug">
                  {voices.find((v) => v.user_id === user?.id)?.roast_text || 'Savage incoming...'}
                </p>
                <div className="mt-4 text-4xl font-black text-orange-400">
                  {voices.find((v) => v.user_id === user?.id)?.score || 0} pts
                </div>
              </div>

              {/* OPPONENT ROAST */}
              <div className={`p-6 rounded-2xl ${winner !== user?.id ? 'bg-gradient-to-br from-purple-500/20 to-transparent border-2 border-purple-500' : 'bg-zinc-800/50'}`}>
                <p className="text-xs opacity-60 mb-2">OPPONENT ROAST</p>
                <p className="italic text-lg leading-snug">
                  {voices.find((v) => v.user_id === opponentId)?.roast_text || 'Savage incoming...'}
                </p>
                <div className="mt-4 text-4xl font-black text-purple-400">
                  {voices.find((v) => v.user_id === opponentId)?.score || 0} pts
                </div>
              </div>
            </div>

            <div className="text-center mt-10 text-5xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-orange-500 via-yellow-400 to-red-500">
              {winner === user?.id ? '🏆 YOU COOKED THEM 🏆' : '💀 THEY COOKED YOU 💀'}
            </div>
          </div>
        )}
      </div>

      {/* Share button */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2">
        <button className="bg-white text-black px-8 py-4 rounded-2xl font-bold text-lg shadow-2xl shadow-orange-500/50 flex items-center gap-3 active:scale-95">
          Share this roast 🔥
        </button>
      </div>
    </div>
  );
};
