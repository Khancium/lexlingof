import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  PermissionsAndroid,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RNFS from 'react-native-blob-util';
import recorderPlayer, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  AVEncoderAudioQualityIOSType,
  type RecordBackType,
} from 'react-native-audio-recorder-player';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { base64ToBytes, sha256Hex } from '../utils/sha256';
import { stripFileScheme } from '../utils/path';

const COLORS = {
  primary: '#2563EB',
  danger: '#DC2626',
  success: '#059669',
  background: '#0F172A',
  surface: '#1E293B',
  warning: '#CA8A04',
  track: '#334155',
  textMuted: '#94A3B8',
};

// AudioSamplingRate/AVFormatIDKeyIOS are plain strings/numbers, not enums --
// AVEncodingOption is a TS union type with no runtime members, so 'aac' is
// used directly instead of a nonexistent AVEncodingOption.aac.
const audioSet = {
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
  AVNumberOfChannelsKeyIOS: 1,
  AVFormatIDKeyIOS: 'aac' as const,
  AudioSamplingRate: 44100,
};

type Status = 'idle' | 'requesting_permission' | 'recording' | 'paused' | 'done' | 'error';

type AudioRecorderProps = {
  maxDurationMs?: number;
  onRecordingComplete: (localFilePath: string, durationMs: number, checksum: string) => void;
  onError: (error: string) => void;
  onDurationUpdate?: (durationMs: number) => void;
};

function formatMmSs(elapsedMs: number): string {
  return recorderPlayer.mmss(Math.floor(elapsedMs / 1000));
}

function ringColorForElapsed(elapsedMs: number): string {
  if (elapsedMs >= 2700) {
    return COLORS.danger;
  }
  if (elapsedMs >= 2000) {
    return COLORS.warning;
  }
  return COLORS.success;
}

const RING_SIZE = 140;
const RING_STROKE = 10;
const RING_TICKS = 48;

// Circular progress built from rotated tick marks rather than an SVG arc --
// no SVG library is installed, and rotating each tick around this
// full-size container's own center (which coincides with the ring's center)
// avoids the sign-error-prone translate/rotate/translate pivot math an
// SVG-free filled-arc would need.
function ProgressRing({
  progress,
  color,
  children,
}: {
  progress: number;
  color: string;
  children: React.ReactNode;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  const filledTicks = Math.round(clamped * RING_TICKS);
  const tickWidth = 3;
  const tickHeight = RING_STROKE;

  return (
    <View style={styles.ringContainer}>
      {Array.from({ length: RING_TICKS }).map((_, i) => {
        const angle = (360 / RING_TICKS) * i;
        const isFilled = i < filledTicks;
        return (
          <View key={i} style={[styles.ringTickPivot, { transform: [{ rotate: `${angle}deg` }] }]}>
            <View
              style={[
                styles.ringTick,
                {
                  width: tickWidth,
                  height: tickHeight,
                  left: RING_SIZE / 2 - tickWidth / 2,
                  backgroundColor: isFilled ? color : COLORS.track,
                },
              ]}
            />
          </View>
        );
      })}
      <View style={styles.ringCenter}>{children}</View>
    </View>
  );
}

function MicLevelBar({ metering }: { metering: number }) {
  return (
    <View style={styles.meterTrack}>
      <View style={[styles.meterFill, { width: `${Math.round(metering * 100)}%` }]} />
    </View>
  );
}

export default function AudioRecorder({
  maxDurationMs,
  onRecordingComplete,
  onError,
  onDurationUpdate,
}: AudioRecorderProps) {
  const [status, setStatus] = useState<Status>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [metering, setMetering] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Guards the auto-stop call in the listener against firing more than once
  // while stopRecording() is still in flight (the listener keeps firing
  // between the threshold being crossed and the recorder actually stopping).
  const stoppingRef = useRef(false);
  const elapsedMsRef = useRef(0);

  useEffect(() => {
    elapsedMsRef.current = elapsedMs;
  }, [elapsedMs]);

  useEffect(() => {
    return () => {
      recorderPlayer.removeRecordBackListener();
    };
  }, []);

  const stopRecording = useCallback(async () => {
    if (stoppingRef.current) {
      return;
    }
    stoppingRef.current = true;

    try {
      const resultPath = stripFileScheme(await recorderPlayer.stopRecorder());
      recorderPlayer.removeRecordBackListener();

      const finalElapsedMs = elapsedMsRef.current;
      setAudioPath(resultPath);
      setStatus('done');

      const base64 = await RNFS.fs.readFile(resultPath, 'base64');
      const checksum = sha256Hex(base64ToBytes(base64));

      onRecordingComplete(resultPath, finalElapsedMs, checksum);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to stop recording';
      setStatus('error');
      setErrorMessage(message);
      onError(message);
    } finally {
      stoppingRef.current = false;
    }
  }, [onRecordingComplete, onError]);

  const startRecording = useCallback(async () => {
    setStatus('requesting_permission');

    if (Platform.OS === 'android') {
      try {
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          setStatus('error');
          setErrorMessage('Microphone permission denied');
          onError('Microphone permission denied');
          return;
        }
      } catch {
        setStatus('error');
        setErrorMessage('Microphone permission denied');
        onError('Microphone permission denied');
        return;
      }
    }
    // iOS: the native module triggers the AVAudioSession permission prompt
    // itself on startRecorder(), backed by NSMicrophoneUsageDescription.

    try {
      const outputPath = `${RNFS.fs.dirs.CacheDir}/lexlingo_recording_${Date.now()}.m4a`;
      stoppingRef.current = false;
      setElapsedMs(0);
      setMetering(0);

      await recorderPlayer.startRecorder(outputPath, audioSet, true);

      recorderPlayer.addRecordBackListener((e: RecordBackType) => {
        const current = Math.round(e.currentPosition);
        setElapsedMs(current);
        const db = e.currentMetering ?? -60;
        setMetering(Math.max(0, Math.min(1, (db + 60) / 60)));
        onDurationUpdate?.(current);

        // Module 1 auto-stop -- second enforcement layer after the UI
        // countdown; the server also caps durationMs on confirm.
        if (maxDurationMs && current >= maxDurationMs) {
          stopRecording();
        }
      });

      setStatus('recording');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start recording';
      setStatus('error');
      setErrorMessage(message);
      onError(message);
    }
  }, [maxDurationMs, onDurationUpdate, onError, stopRecording]);

  const pauseRecording = useCallback(async () => {
    await recorderPlayer.pauseRecorder();
    setStatus('paused');
  }, []);

  const resumeRecording = useCallback(async () => {
    await recorderPlayer.resumeRecorder();
    setStatus('recording');
  }, []);

  const retake = useCallback(() => {
    setStatus('idle');
    setElapsedMs(0);
    setAudioPath(null);
    setMetering(0);
    setErrorMessage(null);
  }, []);

  const playRecording = useCallback(async () => {
    if (!audioPath) {
      return;
    }
    try {
      await recorderPlayer.startPlayer(audioPath);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to play recording');
    }
  }, [audioPath, onError]);

  if (status === 'requesting_permission') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={COLORS.primary} />
        <Text style={styles.mutedText}>Requesting microphone access...</Text>
      </View>
    );
  }

  if (status === 'idle') {
    return (
      <View style={styles.centered}>
        <TouchableOpacity style={styles.recordButton} onPress={startRecording}>
          <Ionicons name="mic" size={36} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.mutedText}>
          {maxDurationMs ? 'Tap to record (max 3 seconds)' : 'Tap to start recording'}
        </Text>
      </View>
    );
  }

  if (status === 'recording' && maxDurationMs) {
    const remainingSeconds = Math.max(0, (maxDurationMs - elapsedMs) / 1000).toFixed(1);
    return (
      <View style={styles.centered}>
        <ProgressRing progress={elapsedMs / maxDurationMs} color={ringColorForElapsed(elapsedMs)}>
          <Text style={styles.ringText}>{remainingSeconds}</Text>
        </ProgressRing>
        <Text style={styles.remainingText}>seconds remaining</Text>
        <MicLevelBar metering={metering} />
        <Text style={styles.mutedText}>Recording... auto-stops at 3 seconds</Text>
      </View>
    );
  }

  if (status === 'recording' && !maxDurationMs) {
    return (
      <View style={styles.centered}>
        <Text style={styles.timerText}>{formatMmSs(elapsedMs)}</Text>
        <MicLevelBar metering={metering} />
        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.actionButton, styles.pauseButton]} onPress={pauseRecording}>
            <Ionicons name="pause" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Pause</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.stopButton]} onPress={stopRecording}>
            <Ionicons name="stop" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Stop</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (status === 'paused') {
    return (
      <View style={styles.centered}>
        <Text style={styles.timerText}>{formatMmSs(elapsedMs)}</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.actionButton, styles.resumeButton]} onPress={resumeRecording}>
            <Ionicons name="play" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Resume</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.stopButton]} onPress={stopRecording}>
            <Ionicons name="stop" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Stop</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (status === 'done') {
    return (
      <View style={styles.centered}>
        <Ionicons name="checkmark-circle" size={64} color={COLORS.success} />
        <Text style={styles.doneText}>Recorded: {(elapsedMs / 1000).toFixed(1)}s</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity style={[styles.actionButton, styles.primaryButton]} onPress={playRecording}>
            <Ionicons name="play" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Play</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionButton, styles.retakeButton]} onPress={retake}>
            <Ionicons name="refresh" size={20} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Retake</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // status === 'error'
  return (
    <View style={styles.centered}>
      <Ionicons name="alert-circle" size={64} color={COLORS.danger} />
      <Text style={styles.errorText}>{errorMessage}</Text>
      <TouchableOpacity style={[styles.actionButton, styles.primaryButton]} onPress={retake}>
        <Text style={styles.actionButtonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  recordButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mutedText: {
    color: COLORS.textMuted,
    fontSize: 14,
    textAlign: 'center',
  },
  ringContainer: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringTickPivot: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
  },
  ringTick: {
    position: 'absolute',
    top: 0,
    borderRadius: 2,
  },
  ringCenter: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '700',
  },
  remainingText: {
    color: COLORS.danger,
    fontSize: 14,
    fontWeight: '600',
  },
  timerText: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  meterTrack: {
    width: 220,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.track,
    overflow: 'hidden',
  },
  meterFill: {
    height: '100%',
    backgroundColor: COLORS.primary,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  pauseButton: {
    backgroundColor: COLORS.surface,
  },
  resumeButton: {
    backgroundColor: COLORS.success,
  },
  stopButton: {
    backgroundColor: COLORS.danger,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
  },
  retakeButton: {
    backgroundColor: COLORS.surface,
  },
  doneText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  errorText: {
    color: COLORS.danger,
    fontSize: 16,
    textAlign: 'center',
  },
});
