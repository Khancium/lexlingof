import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../../services/api.service';
import { uploadAudioFile } from '../../services/upload.service';
import { useAppStore } from '../../store/app.store';
import { useContributorLanguage } from '../../hooks/useContributorLanguage';
import AudioRecorder from '../../components/AudioRecorder';
import type { ContributeStackParamList } from '../../navigation/ContributeStack';

type Props = NativeStackScreenProps<ContributeStackParamList, 'Module3Screen'>;

type Sentence = {
  id: string;
  englishText: string;
  category: { id: string; name: string; slug: string } | null;
  difficulty: string;
};

type RecordingState = { path: string; durationMs: number; checksum: string };

export default function Module3Screen({ navigation }: Props) {
  const languages = useAppStore((state) => state.languages);
  const loadLanguages = useAppStore((state) => state.loadLanguages);
  const { languageId: defaultLanguageId, dialectId, isLoading: languageLoading } = useContributorLanguage();

  const [languageId, setLanguageId] = useState<string | null>(null);
  const [sentence, setSentence] = useState<Sentence | null>(null);
  const [loadingSentence, setLoadingSentence] = useState(true);
  const [sentenceError, setSentenceError] = useState<string | null>(null);

  const [translation, setTranslation] = useState('');
  const [romanization, setRomanization] = useState('');
  const [ipa, setIpa] = useState('');
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    loadLanguages();
  }, [loadLanguages]);

  useEffect(() => {
    if (defaultLanguageId && languageId === null) {
      setLanguageId(defaultLanguageId);
    }
  }, [defaultLanguageId, languageId]);

  const loadSentence = useCallback(async (forLanguageId: string) => {
    setLoadingSentence(true);
    setSentenceError(null);
    setTranslation('');
    setRomanization('');
    setIpa('');
    setRecording(null);
    try {
      setSentence(await api.contributions.getRandomSentence(forLanguageId));
    } catch (err) {
      setSentence(null);
      setSentenceError(err instanceof Error ? err.message : 'No sentences available');
    } finally {
      setLoadingSentence(false);
    }
  }, []);

  useEffect(() => {
    if (languageId) {
      loadSentence(languageId);
    }
  }, [languageId, loadSentence]);

  async function handleSubmit() {
    if (!sentence || !languageId || translation.trim().length === 0) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      let audioFileId: string | undefined;
      if (recording) {
        audioFileId = await uploadAudioFile({
          localPath: recording.path,
          durationMs: recording.durationMs,
          checksumSha256: recording.checksum,
          module: 'TRANSLATION',
        });
      }

      const result = await api.contributions.submitTranslation(sentence.id, {
        nativeText: translation.trim(),
        romanization: romanization.trim() || undefined,
        ipa: ipa.trim() || undefined,
        audioFileId,
        languageId,
        dialectId: dialectId ?? undefined,
      });

      navigation.replace('RecordingResultScreen', { moduleType: 'TRANSLATION', pointsAwarded: result.pointsAwarded });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit translation');
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = !!sentence && !!languageId && translation.trim().length > 0 && !isSubmitting;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.heading}>Translate a Sentence</Text>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {languages.length > 1 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              {languages.map((language) => (
                <TouchableOpacity
                  key={language.id}
                  style={[styles.chip, languageId === language.id && styles.chipSelected]}
                  onPress={() => setLanguageId(language.id)}
                >
                  <Text style={styles.chipText}>{language.nameEnglish}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          ) : null}

          {loadingSentence ? (
            <ActivityIndicator color="#059669" style={styles.loader} />
          ) : sentenceError || !sentence ? (
            <Text style={styles.errorText}>{sentenceError ?? 'No sentences available'}</Text>
          ) : (
            <>
              <View style={styles.sentenceCard}>
                {sentence.category ? (
                  <View style={styles.categoryBadge}>
                    <Text style={styles.categoryBadgeText}>{sentence.category.name}</Text>
                  </View>
                ) : null}
                <Text style={styles.sentenceText}>{sentence.englishText}</Text>
              </View>

              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Translation *"
                placeholderTextColor="#64748B"
                value={translation}
                onChangeText={setTranslation}
                multiline
              />
              <TextInput
                style={styles.input}
                placeholder="Romanization"
                placeholderTextColor="#64748B"
                value={romanization}
                onChangeText={setRomanization}
              />
              <TextInput style={styles.input} placeholder="IPA" placeholderTextColor="#64748B" value={ipa} onChangeText={setIpa} />

              <Text style={styles.recorderLabel}>Tap to record yourself reading your translation (optional)</Text>
              <AudioRecorder
                onRecordingComplete={(path, durationMs, checksum) => setRecording({ path, durationMs, checksum })}
                onError={(message) => setSubmitError(message)}
              />

              <Text style={styles.pointsPreview}>
                Base points, plus bonuses for adding romanization, IPA, and an audio recording.
              </Text>

              {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}

              <View style={styles.buttonRow}>
                <TouchableOpacity
                  style={styles.skipButton}
                  onPress={() => languageId && loadSentence(languageId)}
                >
                  <Text style={styles.skipButtonText}>Skip</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                >
                  {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>Submit</Text>}
                </TouchableOpacity>
              </View>
            </>
          )}

          {!defaultLanguageId && !languageLoading ? (
            <Text style={styles.errorText}>Set your language in Profile settings before contributing.</Text>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  flex: {
    flex: 1,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 8,
    marginBottom: 12,
  },
  content: {
    padding: 20,
    paddingTop: 0,
  },
  chipRow: {
    marginBottom: 14,
  },
  chip: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipSelected: {
    backgroundColor: '#059669',
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  loader: {
    marginTop: 40,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 10,
  },
  sentenceCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    marginBottom: 18,
  },
  categoryBadge: {
    alignSelf: 'flex-end',
    backgroundColor: '#334155',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    marginBottom: 10,
  },
  categoryBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  sentenceText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 30,
  },
  input: {
    backgroundColor: '#1E293B',
    color: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  recorderLabel: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 8,
  },
  pointsPreview: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 12,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
  },
  skipButton: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  submitButton: {
    flex: 2,
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
