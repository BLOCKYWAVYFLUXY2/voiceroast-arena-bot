import React, { useState, useRef, useEffect } from 'react';
import { Mic, Square, Timer } from 'lucide-react'; // or your icon library
import { supabase } from '../lib/supabaseClient'; // your existing client
import { useTelegram } from '../lib/telegram'; // our Telegram WebApp context

interface RecordButtonProps {
  battleId: string; // pass from BattleArena
  onRecordingComplete: (voiceUrl: string) => void;
}

export const RecordButton: React.FC<RecordButtonProps> = ({ battleId, onRecordingComplete }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(15);
  const [isUploading, setIsUploading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const { user } = useTelegram(); // our existing hook for tg.initDataUnsafe.user

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await uploadVoice(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setSecondsLeft(15);

      // 15-second countdown
      timerRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            stopRecording();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

    } catch (err) {
      console.error('Mic permission denied or error:', err);
      alert('Enable microphone in Telegram settings 🔥');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      streamRef.current?.getTracks().forEach(track => track.stop());
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const uploadVoice = async (audioBlob: Blob) => {
    setIsUploading(true);
    const fileName = `battle_${battleId}_${Date.now()}.webm`;

    const { data, error } = await supabase.storage
      .from('voice-roasts') // create this bucket in Supabase
      .upload(fileName, audioBlob, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('Upload failed:', error);
      alert('Upload failed — try again');
    } else {
      const { data: { publicUrl } } = supabase.storage
        .from('voice-roasts')
        .getPublicUrl(fileName);

      // Save battle record to DB + trigger AI processing
      await supabase.from('battle_voices').insert({
        battle_id: battleId,
        user_id: user?.id,
        voice_url: publicUrl,
        duration: 15,
      });

      onRecordingComplete(publicUrl); // update UI with your roast
    }
    setIsUploading(false);
  };

  // Visual pulsing ring
  const ringClass = isRecording 
    ? 'animate-[pulse_1s_ease-in-out_infinite] ring-8 ring-red-500/50' 
    : '';

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={isRecording ? stopRecording : startRecording}
        disabled={isUploading}
        className={`w-24 h-24 rounded-full flex items-center justify-center transition-all duration-300 ${ringClass} ${
          isRecording 
            ? 'bg-red-600 scale-110 shadow-2xl shadow-red-500/50' 
            : 'bg-gradient-to-br from-purple-600 to-orange-600 hover:scale-105'
        }`}
      >
        {isRecording ? (
          <Square className="w-12 h-12 text-white" />
        ) : (
          <Mic className="w-12 h-12 text-white" />
        )}
      </button>

      {isRecording && (
        <div className="flex items-center gap-2 text-red-500 font-mono text-xl font-bold">
          <Timer className="w-6 h-6" />
          00:{secondsLeft.toString().padStart(2, '0')}
        </div>
      )}

      {isUploading && <p className="text-orange-400">Sending roast to the arena... 🔥</p>}
    </div>
  );
};
