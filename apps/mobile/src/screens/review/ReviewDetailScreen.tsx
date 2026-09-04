import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import recorderPlayer, { type PlayBackType } from 'react-native-audio-recorder-player';
import { api } from '../../services/api.service';
import type { ReviewStackParamList, ReviewQueueItem } from '../../navigation/ReviewStack';

type Props = NativeStackScreenProps<ReviewStackParamList, 'ReviewDetailScreen'>;

type Decision = 'valid' | 'needs_correction' | 'invalid';

const DECISION_LABEL: Record<Decision, string> = {
  valid: 'Valid',
  needs_correction: 'Needs Correction',
  invalid: 'Invalid',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatMs(ms: number): string {
  return recorderPlayer.mmss(Math.floor(ms / 1000));
}

export default function ReviewDetailScreen({ navigation, route }: Props) {
  const [item, setItem] = useState<ReviewQueueItem>(route.params.item);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [totalMs, setTotalMs] = useState(0);
  const [playerError, setPlayerError] = useState<string | null>(null);

  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [allDone, setAllDone] = useState(false);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      recorderPlayer.stopPlayer().catch(() => {});
      recorderPlayer.removePlayBackListener();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  async function togglePlayback() {
    if (isPlaying) {
      await recorderPlayer.stopPlayer();
      recorderPlayer.removePlayBackListener();
      setIsPlaying(false);
      return;
    }
    if (!item.detail.audioFileId) {
      return;
    }
    setPlayerError(null);
    try {
      const { url } = await api.audio.getPlayUrl(item.detail.audioFileId);
      recorderPlayer.addPlayBackListener((e: PlayBackType) => {
        setCurrentMs(e.currentPosition);
        setTotalMs(e.duration);
      });
      recorderPlayer.addPlaybackEndListener(() => {
        setIsPlaying(false);
        recorderPlayer.removePlayBackListener();
        recorderPlayer.removePlaybackEndListener();
      });
      await recorderPlayer.startPlayer(url);
      setIsPlaying(true);
    } catch (err) {
      setPlayerError(err instanceof Error ? err.message : 'Failed to play audio');
    }
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1800);
  }

  async function confirmDecision() {
    if (!pendingDecision) return;
    setIsSubmitting(true);
    try {
      await api.reviews.submitReview({
        contributionId: item.contributionId,
        decision: pendingDecision,
        notes: notes.trim() || undefined,
      });
      showToast(`Marked as ${DECISION_LABEL[pendingDecision]}`);
      setPendingDecision(null);
      setNotes('');

      await recorderPlayer.stopPlayer().catch(() => {});
      recorderPlayer.removePlayBackListener();
      setIsPlaying(false);
      setCurrentMs(0);
      setTotalMs(0);

      const next = await api.reviews.getQueue();
      const remaining = next.filter((q: ReviewQueueItem) => q.contributionId !== item.contributionId);
      if (remaining.length > 0) {
        setItem(remaining[0]);
      } else {
        setAllDone(true);
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to submit review');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (allDone) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.doneContainer}>
          <Text style={styles.doneText}>All reviews done! 🎉</Text>
          <TouchableOpacity style={styles.doneButton} onPress={() => navigation.goBack()}>
            <Text style={styles.doneButtonText}>Back to Review Queue</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Review</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.contributorName}>{item.contributor.displayName}</Text>
        <Text style={styles.contributorMeta}>
          {item.language?.nameEnglish ?? 'Unknown language'} · {formatDate(item.submittedAt)}
        </Text>

        {item.moduleType === 'WORD' ? (
          <View style={styles.card}>
            {item.detail.imageUrl ? (
              <Image source={{ uri: item.detail.imageUrl }} style={styles.detailImage} contentFit="cover" />
            ) : null}
            <Text style={styles.bigWord}>{item.detail.nativeWord}</Text>
            {item.detail.romanization ? <Text style={styles.subText}>Romanization: {item.detail.romanization}</Text> : null}
            {item.detail.ipa ? <Text style={styles.subText}>IPA: {item.detail.ipa}</Text> : null}
          </View>
        ) : null}

        {item.moduleType === 'TRANSLATION' ? (
          <View style={styles.card}>
            <Text style={styles.englishText}>{item.detail.englishText}</Text>
            <View style={styles.divider} />
            <Text style={styles.bigWord}>{item.detail.nativeText}</Text>
          </View>
        ) : null}

        {item.moduleType === 'SCENE' ? (
          <View style={styles.card}>
            {item.detail.imageUrl ? (
              <Image source={{ uri: item.detail.imageUrl }} style={styles.detailImage} contentFit="cover" />
            ) : null}
            <Text style={styles.bigWord}>{item.detail.title}</Text>
            <Text style={styles.subText}>Difficulty: {item.detail.difficulty}</Text>
          </View>
        ) : null}

        {item.moduleType === 'TRANSCRIPTION' ? (
          <View style={styles.card}>
            <Text style={styles.bigWord}>{item.detail.title}</Text>
            <Text style={styles.subText}>Type: {item.detail.recordingType}</Text>
            {item.detail.nativeText ? <Text style={styles.subText}>{item.detail.nativeText}</Text> : null}
          </View>
        ) : null}

        <View style={styles.playerCard}>
          <View style={styles.waveformPlaceholder} />
          <View style={styles.playerRow}>
            <TouchableOpacity onPress={togglePlayback} disabled={!item.detail.audioFileId}>
              <Ionicons
                name={isPlaying ? 'pause-circle' : 'play-circle'}
                size={44}
                color={item.detail.audioFileId ? '#2563EB' : '#334155'}
              />
            </TouchableOpacity>
            <Text style={styles.playerTime}>
              {formatMs(currentMs)} / {formatMs(totalMs)}
            </Text>
          </View>
          {!item.detail.audioFileId ? <Text style={styles.subText}>No audio recorded for this submission.</Text> : null}
          {playerError ? <Text style={styles.errorText}>{playerError}</Text> : null}
        </View>

        <Text style={styles.instruction}>Does this audio match the prompt? Is it genuine and not spam?</Text>

        <View style={styles.decisionColumn}>
          <TouchableOpacity style={[styles.decisionButton, styles.validButton]} onPress={() => setPendingDecision('valid')}>
            <Ionicons name="checkmark" size={20} color="#FFFFFF" />
            <Text style={styles.decisionButtonText}>Valid</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.decisionButton, styles.correctionButton]}
            onPress={() => setPendingDecision('needs_correction')}
          >
            <Ionicons name="warning" size={20} color="#0F172A" />
            <Text style={[styles.decisionButtonText, styles.correctionButtonText]}>Needs Correction</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.decisionButton, styles.invalidButton]} onPress={() => setPendingDecision('invalid')}>
            <Ionicons name="close" size={20} color="#FFFFFF" />
            <Text style={styles.decisionButtonText}>Invalid</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <Modal visible={pendingDecision !== null} transparent animationType="slide" onRequestClose={() => setPendingDecision(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>
              Mark as {pendingDecision ? DECISION_LABEL[pendingDecision] : ''}?
            </Text>
            <TextInput
              style={styles.sheetInput}
              placeholder="Optional reason / notes"
              placeholderTextColor="#64748B"
              value={notes}
              onChangeText={setNotes}
              multiline
            />
            <View style={styles.sheetButtonRow}>
              <TouchableOpacity style={styles.sheetCancelButton} onPress={() => setPendingDecision(null)}>
                <Text style={styles.sheetCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sheetConfirmButton} onPress={confirmDecision} disabled={isSubmitting}>
                {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.sheetConfirmText}>Confirm</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {toast ? (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  contributorName: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  contributorMeta: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 18,
    marginBottom: 16,
  },
  detailImage: {
    width: '100%',
    height: 180,
    borderRadius: 10,
    marginBottom: 14,
  },
  bigWord: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  englishText: {
    color: '#94A3B8',
    fontSize: 16,
  },
  divider: {
    height: 1,
    backgroundColor: '#334155',
    marginVertical: 12,
  },
  subText: {
    color: '#94A3B8',
    fontSize: 14,
    marginTop: 6,
  },
  playerCard: {
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
  },
  waveformPlaceholder: {
    height: 2,
    backgroundColor: '#334155',
    borderRadius: 1,
    marginBottom: 14,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  playerTime: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  errorText: {
    color: '#DC2626',
    fontSize: 13,
    marginTop: 8,
  },
  instruction: {
    color: '#FFFFFF',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
  },
  decisionColumn: {
    gap: 12,
  },
  decisionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 10,
    paddingVertical: 16,
  },
  validButton: {
    backgroundColor: '#059669',
  },
  correctionButton: {
    backgroundColor: '#FACC15',
  },
  invalidButton: {
    backgroundColor: '#DC2626',
  },
  decisionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  correctionButtonText: {
    color: '#0F172A',
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
  },
  sheetInput: {
    backgroundColor: '#0F172A',
    color: '#FFFFFF',
    borderRadius: 8,
    padding: 14,
    minHeight: 70,
    textAlignVertical: 'top',
    fontSize: 15,
    marginBottom: 16,
  },
  sheetButtonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  sheetCancelButton: {
    flex: 1,
    backgroundColor: '#334155',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetCancelText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  sheetConfirmButton: {
    flex: 1,
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  sheetConfirmText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  toast: {
    position: 'absolute',
    bottom: 30,
    left: 24,
    right: 24,
    backgroundColor: '#334155',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  doneContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  doneText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 24,
  },
  doneButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 28,
  },
  doneButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
