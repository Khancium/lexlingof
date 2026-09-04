import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { api } from '../../services/api.service';
import { uploadAudioFile } from '../../services/upload.service';
import { useAppStore } from '../../store/app.store';
import { useContributorLanguage } from '../../hooks/useContributorLanguage';
import AudioRecorder from '../../components/AudioRecorder';
import type { ContributeStackParamList } from '../../navigation/ContributeStack';

type Props = NativeStackScreenProps<ContributeStackParamList, 'Module1Screen'>;

type Concept = {
  id: string;
  slug: string;
  labelEnglish: string;
  description: string | null;
  difficulty: string;
};

type WordLimits = {
  synonymCount: number;
  takesPerSynonym: Record<'1' | '2' | '3', number>;
  canAddSynonym: boolean;
  canAddTake: boolean;
  nextSynonymIndex: 1 | 2 | 3 | null;
  nextTakeIndex: 1 | 2 | 3 | null;
};

type NextConceptResponse = {
  concept: Concept;
  category: { id: string; name: string; slug: string };
  publicUrl: string | null;
  limits: WordLimits;
};

type RecordingState = { path: string; durationMs: number; checksum: string };

export default function Module1Screen({ navigation }: Props) {
  const categories = useAppStore((state) => state.categories);
  const loadCategories = useAppStore((state) => state.loadCategories);
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();

  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [data, setData] = useState<NextConceptResponse | null>(null);
  const [loadingConcept, setLoadingConcept] = useState(true);
  const [conceptError, setConceptError] = useState<string | null>(null);

  const [nativeWord, setNativeWord] = useState('');
  const [romanization, setRomanization] = useState('');
  const [ipa, setIpa] = useState('');
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  const loadNextConcept = useCallback(async (forCategoryId?: string) => {
    setLoadingConcept(true);
    setConceptError(null);
    setNativeWord('');
    setRomanization('');
    setIpa('');
    setRecording(null);
    try {
      const next = await api.concepts.getNext(forCategoryId);
      setData(next);
    } catch (err) {
      setData(null);
      setConceptError(err instanceof Error ? err.message : 'No concepts available');
    } finally {
      setLoadingConcept(false);
    }
  }, []);

  useEffect(() => {
    loadNextConcept(categoryId);
  }, [categoryId, loadNextConcept]);

  async function handleSubmit() {
    if (!data || !languageId || !recording || !data.limits.nextSynonymIndex || !data.limits.nextTakeIndex) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const audioFileId = await uploadAudioFile({
        localPath: recording.path,
        durationMs: recording.durationMs,
        checksumSha256: recording.checksum,
        module: 'WORD',
      });

      const result = await api.contributions.submitWord({
        audioFileId,
        conceptId: data.concept.id,
        languageId,
        dialectId: dialectId ?? undefined,
        nativeWord: nativeWord.trim(),
        romanization: romanization.trim() || undefined,
        ipa: ipa.trim() || undefined,
        synonymIndex: data.limits.nextSynonymIndex,
        takeIndex: data.limits.nextTakeIndex,
        durationMs: recording.durationMs,
      });

      navigation.replace('RecordingResultScreen', {
        moduleType: 'WORD',
        pointsAwarded: result.pointsAwarded,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit recording');
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    !!recording && nativeWord.trim().length > 0 && !!languageId && !!data?.limits.canAddTake && !isSubmitting;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Record a Word</Text>
        <TouchableOpacity onPress={() => loadNextConcept(categoryId)}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowContent}
      >
        <TouchableOpacity
          style={[styles.chip, categoryId === undefined && styles.chipSelected]}
          onPress={() => setCategoryId(undefined)}
        >
          <Text style={styles.chipText}>All</Text>
        </TouchableOpacity>
        {categories.map((category) => (
          <TouchableOpacity
            key={category.id}
            style={[styles.chip, categoryId === category.id && styles.chipSelected]}
            onPress={() => setCategoryId(category.id)}
          >
            <Ionicons name={category.icon ?? 'pricetag-outline'} size={14} color="#FFFFFF" />
            <Text style={styles.chipText}>{category.nameEnglish}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {loadingConcept ? (
          <ActivityIndicator color="#2563EB" style={styles.loader} />
        ) : conceptError || !data ? (
          <Text style={styles.errorText}>{conceptError ?? 'No concepts available'}</Text>
        ) : (
          <>
            <View style={styles.conceptCard}>
              {data.publicUrl ? (
                <Image source={{ uri: data.publicUrl }} style={styles.conceptImage} contentFit="cover" />
              ) : (
                <View style={[styles.conceptImage, styles.conceptImagePlaceholder]}>
                  <Ionicons name="image-outline" size={48} color="#64748B" />
                </View>
              )}
              <Text style={styles.conceptLabel}>{data.concept.labelEnglish}</Text>
              <Text style={styles.conceptCategory}>{data.category.name}</Text>
            </View>

            <View style={styles.indicatorRow}>
              <View>
                <Text style={styles.indicatorLabel}>
                  Synonym {data.limits.nextSynonymIndex ?? 3} of 3
                </Text>
                <View style={styles.dotsRow}>
                  {[1, 2, 3].map((idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.dot,
                        (data.limits.takesPerSynonym[String(idx) as '1' | '2' | '3'] ?? 0) > 0 && styles.dotFilled,
                      ]}
                    />
                  ))}
                </View>
              </View>
              <Text style={styles.indicatorLabel}>Take {data.limits.nextTakeIndex ?? 3} of 3</Text>
            </View>

            {!data.limits.canAddTake ? (
              <Text style={styles.completeText}>You've completed every recording for this concept.</Text>
            ) : (
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Your word *"
                  placeholderTextColor="#64748B"
                  value={nativeWord}
                  onChangeText={setNativeWord}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Romanization"
                  placeholderTextColor="#64748B"
                  value={romanization}
                  onChangeText={setRomanization}
                />
                <TextInput
                  style={styles.input}
                  placeholder="IPA"
                  placeholderTextColor="#64748B"
                  value={ipa}
                  onChangeText={setIpa}
                />

                <Text style={styles.recorderLabel}>Record your pronunciation (max 3 seconds)</Text>
                <AudioRecorder
                  maxDurationMs={3000}
                  onRecordingComplete={(path, durationMs, checksum) => setRecording({ path, durationMs, checksum })}
                  onError={(message) => setSubmitError(message)}
                />

                <Text style={styles.pointsPreview}>+10 base, +10 if verified = up to +20 pts</Text>

                {!languageId && !languageLoading ? (
                  <Text style={styles.errorText}>Set your language in Profile settings before contributing.</Text>
                ) : null}
                {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}

                <TouchableOpacity
                  style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={!canSubmit}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.submitButtonText}>Submit</Text>
                  )}
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
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
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  skipText: {
    color: '#2563EB',
    fontSize: 16,
    fontWeight: '600',
  },
  chipRow: {
    marginTop: 14,
    maxHeight: 44,
  },
  chipRowContent: {
    paddingHorizontal: 20,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipSelected: {
    backgroundColor: '#2563EB',
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  content: {
    padding: 20,
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
  conceptCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  conceptImage: {
    width: 140,
    height: 140,
    borderRadius: 12,
    marginBottom: 14,
  },
  conceptImagePlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  conceptLabel: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
  },
  conceptCategory: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 4,
  },
  indicatorRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  indicatorLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#334155',
  },
  dotFilled: {
    backgroundColor: '#2563EB',
  },
  completeText: {
    color: '#059669',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 20,
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
  submitButton: {
    backgroundColor: '#2563EB',
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
