import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { api } from '../../services/api.service';
import { uploadAudioFile } from '../../services/upload.service';
import { useAppStore } from '../../store/app.store';
import { useAuthStore } from '../../store/auth.store';
import { useContributorLanguage } from '../../hooks/useContributorLanguage';
import AudioRecorder from '../../components/AudioRecorder';
import type { ContributeStackParamList } from '../../navigation/ContributeStack';
import { colors } from '../../theme/colors';
import { seededShuffle } from '../../utils/shuffle';

type Props = NativeStackScreenProps<ContributeStackParamList, 'Module1Screen'>;

type Category = { id: string; nameEnglish: string; icon: string | null; conceptCount?: number };

type ConceptListItem = {
  id: string;
  labelEnglish: string;
};

type ConceptDetail = {
  id: string;
  labelEnglish: string;
  category: { id: string; name: string };
  media: { publicUrl: string }[];
};

type WordLimits = {
  synonymCount: number;
  takesPerSynonym: Record<'1' | '2' | '3', number>;
  canAddSynonym: boolean;
  canAddTake: boolean;
  nextSynonymIndex: 1 | 2 | 3 | null;
  nextTakeIndex: 1 | 2 | 3 | null;
};

type RecordingState = { path: string; durationMs: number; checksum: string };
type Step = 'categories' | 'concepts' | 'record';

export default function Module1Screen({ navigation }: Props) {
  const rawCategories = useAppStore((state) => state.categories) as Category[];
  const loadCategories = useAppStore((state) => state.loadCategories);
  const userId = useAuthStore((state) => state.user?.id);
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();

  const categories = useMemo(
    () => (userId ? seededShuffle(rawCategories, userId) : rawCategories),
    [rawCategories, userId],
  );

  const [step, setStep] = useState<Step>('categories');

  const [category, setCategory] = useState<Category | null>(null);
  const [concepts, setConcepts] = useState<ConceptListItem[]>([]);
  const [loadingConcepts, setLoadingConcepts] = useState(false);

  const [concept, setConcept] = useState<ConceptDetail | null>(null);
  const [limits, setLimits] = useState<WordLimits | null>(null);
  const [loadingConcept, setLoadingConcept] = useState(false);
  const [conceptError, setConceptError] = useState<string | null>(null);

  const [detailsOpen, setDetailsOpen] = useState(false);
  const [nativeWord, setNativeWord] = useState('');
  const [romanization, setRomanization] = useState('');
  const [ipa, setIpa] = useState('');
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  function openCategory(c: Category) {
    setCategory(c);
    setStep('concepts');
    setLoadingConcepts(true);
    api.concepts
      .getAll({ categoryId: c.id, limit: 100 })
      .then((res) => setConcepts(res.items ?? []))
      .finally(() => setLoadingConcepts(false));
  }

  const openConcept = useCallback(async (item: ConceptListItem) => {
    setStep('record');
    setLoadingConcept(true);
    setConceptError(null);
    setDetailsOpen(false);
    setNativeWord('');
    setRomanization('');
    setIpa('');
    setRecording(null);
    setSubmitError(null);
    try {
      const [detail, wordLimits] = await Promise.all([
        api.concepts.getById(item.id),
        api.concepts.getLimits(item.id),
      ]);
      setConcept(detail);
      setLimits(wordLimits);
    } catch (err) {
      setConcept(null);
      setConceptError(err instanceof Error ? err.message : 'Failed to load object');
    } finally {
      setLoadingConcept(false);
    }
  }, []);

  async function handleSubmit() {
    if (!concept || !languageId || !recording || !limits?.nextSynonymIndex || !limits?.nextTakeIndex) {
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
        conceptId: concept.id,
        languageId,
        dialectId: dialectId ?? undefined,
        nativeWord: nativeWord.trim() || undefined,
        romanization: romanization.trim() || undefined,
        ipa: ipa.trim() || undefined,
        synonymIndex: limits.nextSynonymIndex,
        takeIndex: limits.nextTakeIndex,
        durationMs: recording.durationMs,
      });

      navigation.replace('RecordingResultScreen', {
        moduleType: 'WORD',
        pointsAwarded: (result as { pointsAwarded: number }).pointsAwarded,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit recording');
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = !!recording && !!languageId && !!limits?.canAddTake && !isSubmitting;

  function goBack() {
    if (step === 'record') setStep('concepts');
    else if (step === 'concepts') setStep('categories');
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          {step !== 'categories' && (
            <TouchableOpacity onPress={goBack} style={styles.backButton}>
              <Ionicons name="chevron-back" size={22} color={colors.ink} />
            </TouchableOpacity>
          )}
          <Text style={styles.heading}>Record a Word</Text>
        </View>
      </View>

      {step === 'categories' && (
        <ScrollView contentContainerStyle={styles.gridContent}>
          <View style={styles.grid}>
            {categories.map((c) => (
              <TouchableOpacity key={c.id} style={styles.gridCard} onPress={() => openCategory(c)}>
                <Ionicons name={c.icon ?? 'pricetag-outline'} size={32} color={colors.brand} />
                <Text style={styles.gridCardLabel}>{c.nameEnglish}</Text>
                {typeof c.conceptCount === 'number' && (
                  <Text style={styles.gridCardMeta}>{c.conceptCount} objects</Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      )}

      {step === 'concepts' && (
        <ScrollView contentContainerStyle={styles.gridContent}>
          <Text style={styles.subheading}>{category?.nameEnglish}</Text>
          {loadingConcepts ? (
            <ActivityIndicator color={colors.brand} style={styles.loader} />
          ) : concepts.length === 0 ? (
            <Text style={styles.errorText}>No objects in this category yet.</Text>
          ) : (
            <View style={styles.grid}>
              {concepts.map((item) => (
                <TouchableOpacity key={item.id} style={styles.gridCard} onPress={() => openConcept(item)}>
                  <Ionicons name="image-outline" size={32} color={colors.inkMuted} />
                  <Text style={styles.gridCardLabel}>{item.labelEnglish}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {step === 'record' && (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {loadingConcept ? (
            <ActivityIndicator color={colors.brand} style={styles.loader} />
          ) : conceptError || !concept ? (
            <Text style={styles.errorText}>{conceptError ?? 'Failed to load object'}</Text>
          ) : (
            <>
              <View style={styles.conceptCard}>
                {concept.media[0]?.publicUrl ? (
                  <Image source={{ uri: concept.media[0].publicUrl }} style={styles.conceptImage} contentFit="cover" />
                ) : (
                  <View style={[styles.conceptImage, styles.conceptImagePlaceholder]}>
                    <Ionicons name="image-outline" size={48} color={colors.inkMuted} />
                  </View>
                )}
                <Text style={styles.conceptLabel}>{concept.labelEnglish}</Text>
                <Text style={styles.conceptCategory}>{concept.category.name}</Text>
              </View>

              <View style={styles.indicatorRow}>
                <View>
                  <Text style={styles.indicatorLabel}>Synonym {limits?.nextSynonymIndex ?? 3} of 3</Text>
                  <View style={styles.dotsRow}>
                    {[1, 2, 3].map((idx) => (
                      <View
                        key={idx}
                        style={[
                          styles.dot,
                          (limits?.takesPerSynonym[String(idx) as '1' | '2' | '3'] ?? 0) > 0 && styles.dotFilled,
                        ]}
                      />
                    ))}
                  </View>
                </View>
                <Text style={styles.indicatorLabel}>Take {limits?.nextTakeIndex ?? 3} of 3</Text>
              </View>

              {!limits?.canAddTake ? (
                <Text style={styles.completeText}>You've completed every recording for this concept.</Text>
              ) : (
                <>
                  <View style={styles.recorderCard}>
                    <AudioRecorder
                      maxDurationMs={5000}
                      onRecordingComplete={(path, durationMs, checksum) => setRecording({ path, durationMs, checksum })}
                      onError={(message) => setSubmitError(message)}
                    />
                    <Text style={styles.recorderLabel}>Tap to record</Text>
                  </View>

                  <View style={styles.detailsCard}>
                    <TouchableOpacity style={styles.detailsToggle} onPress={() => setDetailsOpen((v) => !v)}>
                      <Text style={styles.detailsToggleLabel}>Add word details (optional)</Text>
                      <Ionicons
                        name={detailsOpen ? 'chevron-up' : 'chevron-down'}
                        size={18}
                        color={colors.inkMuted}
                      />
                    </TouchableOpacity>
                    {detailsOpen && (
                      <View style={styles.detailsBody}>
                        <TextInput
                          style={styles.input}
                          placeholder="Your word"
                          placeholderTextColor={colors.placeholder}
                          value={nativeWord}
                          onChangeText={setNativeWord}
                        />
                        <TextInput
                          style={styles.input}
                          placeholder="Romanization"
                          placeholderTextColor={colors.placeholder}
                          value={romanization}
                          onChangeText={setRomanization}
                        />
                        <TextInput
                          style={[styles.input, styles.inputLast]}
                          placeholder="IPA"
                          placeholderTextColor={colors.placeholder}
                          value={ipa}
                          onChangeText={setIpa}
                        />
                      </View>
                    )}
                  </View>

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
                      <ActivityIndicator color={colors.inkInverted} />
                    ) : (
                      <Text style={styles.submitButtonText}>Submit</Text>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  backButton: {
    padding: 4,
  },
  heading: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
  },
  subheading: {
    color: colors.inkMuted,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  gridContent: {
    padding: 20,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridCard: {
    width: '47%',
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  gridCardLabel: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  gridCardMeta: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  content: {
    padding: 20,
  },
  loader: {
    marginTop: 40,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
    marginVertical: 10,
  },
  conceptCard: {
    backgroundColor: colors.surfaceCard,
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
    backgroundColor: colors.surfaceMuted,
  },
  conceptLabel: {
    color: colors.ink,
    fontSize: 26,
    fontWeight: '700',
  },
  conceptCategory: {
    color: colors.inkMuted,
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
    color: colors.ink,
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
    backgroundColor: colors.border,
  },
  dotFilled: {
    backgroundColor: colors.brand,
  },
  completeText: {
    color: colors.success,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 20,
  },
  recorderCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    paddingVertical: 28,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 16,
  },
  recorderLabel: {
    color: colors.inkMuted,
    fontSize: 13,
  },
  detailsCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  detailsToggle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  detailsToggleLabel: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '600',
  },
  detailsBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.ink,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  inputLast: {
    marginBottom: 0,
  },
  pointsPreview: {
    color: colors.inkMuted,
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 12,
  },
  submitButton: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.inkInverted,
    fontSize: 16,
    fontWeight: '600',
  },
});
