import { useEffect, useState } from 'react';
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
import Ionicons from 'react-native-vector-icons/Ionicons';
import { pick, types, isErrorWithCode, errorCodes, keepLocalCopy } from '@react-native-documents/picker';
import RNFS from 'react-native-blob-util';
import recorderPlayer from 'react-native-audio-recorder-player';
import { api } from '../../services/api.service';
import { uploadAudioFile, getAudioDurationMs } from '../../services/upload.service';
import { base64ToBytes, sha256Hex } from '../../utils/sha256';
import { useAppStore } from '../../store/app.store';
import { useContributorLanguage } from '../../hooks/useContributorLanguage';
import type { ContributeStackParamList } from '../../navigation/ContributeStack';
import { colors } from '../../theme/colors';

type Props = NativeStackScreenProps<ContributeStackParamList, 'Module2Screen'>;

const RECORDING_TYPES = ['conversation', 'story', 'interview', 'speech', 'song', 'other'] as const;

type PickedFile = { name: string; size: number; localPath: string };

type Segment = {
  segmentIndex: number;
  startMs: string;
  endMs: string;
  nativeText: string;
  romanization: string;
  ipa: string;
  speakerLabel: string;
};

export default function Module2Screen({ navigation }: Props) {
  const languages = useAppStore((state) => state.languages);
  const loadLanguages = useAppStore((state) => state.loadLanguages);
  const { languageId: defaultLanguageId, dialectId, isLoading: languageLoading } = useContributorLanguage();

  const [step, setStep] = useState<1 | 2>(1);

  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [title, setTitle] = useState('');
  const [recordingType, setRecordingType] = useState<(typeof RECORDING_TYPES)[number]>('conversation');
  const [languageId, setLanguageId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [culturalContext, setCulturalContext] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  const [audioUploadId, setAudioUploadId] = useState<string | null>(null);
  const [uploadedDurationMs, setUploadedDurationMs] = useState(0);
  const [pointsSoFar, setPointsSoFar] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const [nativeText, setNativeText] = useState('');
  const [romanization, setRomanization] = useState('');
  const [ipa, setIpa] = useState('');
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isSubmittingStep2, setIsSubmittingStep2] = useState(false);
  const [step2Error, setStep2Error] = useState<string | null>(null);

  useEffect(() => {
    loadLanguages();
  }, [loadLanguages]);

  useEffect(() => {
    if (defaultLanguageId && languageId === null) {
      setLanguageId(defaultLanguageId);
    }
  }, [defaultLanguageId, languageId]);

  async function handlePickFile() {
    setStep1Error(null);
    try {
      const [result] = await pick({ type: [types.audio] });
      const [copy] = await keepLocalCopy({
        files: [{ uri: result.uri, fileName: result.name ?? `audio_${Date.now()}` }],
        destination: 'cachesDirectory',
      });
      if (copy.status === 'error') {
        throw new Error(copy.copyError);
      }
      setPickedFile({
        name: result.name ?? 'Audio file',
        size: result.size ?? 0,
        localPath: copy.localUri,
      });
    } catch (err) {
      if (isErrorWithCode(err) && err.code === errorCodes.OPERATION_CANCELED) {
        return;
      }
      setStep1Error(err instanceof Error ? err.message : 'Failed to select file');
    }
  }

  async function handleUploadAndContinue() {
    if (!pickedFile || !languageId || title.trim().length === 0) {
      return;
    }
    setIsUploading(true);
    setStep1Error(null);
    try {
      const base64 = await RNFS.fs.readFile(pickedFile.localPath, 'base64');
      const checksum = sha256Hex(base64ToBytes(base64));
      const durationMs = Math.round(await getAudioDurationMs(pickedFile.localPath));

      const audioFileId = await uploadAudioFile({
        localPath: pickedFile.localPath,
        durationMs,
        checksumSha256: checksum,
        module: 'TRANSCRIPTION',
      });

      const result = await api.contributions.submitAudio({
        audioFileId,
        languageId,
        dialectId: dialectId ?? undefined,
        title: title.trim(),
        description: description.trim() || undefined,
        recordingType,
        location: location.trim() || undefined,
        culturalContext: culturalContext.trim() || undefined,
      });

      setAudioUploadId(result.audioUploadId);
      setUploadedDurationMs(durationMs);
      setPointsSoFar(result.pointsAwarded);
      setStep(2);
    } catch (err) {
      setStep1Error(err instanceof Error ? err.message : 'Failed to upload audio');
    } finally {
      setIsUploading(false);
    }
  }

  async function togglePlayback() {
    if (!pickedFile) return;
    if (isPlaying) {
      await recorderPlayer.stopPlayer();
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
    recorderPlayer.addPlaybackEndListener(() => {
      setIsPlaying(false);
      recorderPlayer.removePlaybackEndListener();
    });
    await recorderPlayer.startPlayer(pickedFile.localPath).catch(() => setIsPlaying(false));
  }

  function addSegment() {
    setSegments((prev) => [
      ...prev,
      { segmentIndex: prev.length, startMs: '', endMs: '', nativeText: '', romanization: '', ipa: '', speakerLabel: '' },
    ]);
  }

  function updateSegment(index: number, patch: Partial<Segment>) {
    setSegments((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  function removeSegment(index: number) {
    setSegments((prev) => prev.filter((_, i) => i !== index).map((s, i) => ({ ...s, segmentIndex: i })));
  }

  async function handleSubmitStep2() {
    if (!audioUploadId) return;
    setIsSubmittingStep2(true);
    setStep2Error(null);
    try {
      let total = pointsSoFar;

      if (nativeText.trim() || romanization.trim() || ipa.trim()) {
        const result = await api.contributions.addTranscription(audioUploadId, {
          nativeText: nativeText.trim() || undefined,
          romanization: romanization.trim() || undefined,
          ipa: ipa.trim() || undefined,
        });
        total += result.pointsAwarded ?? 0;
      }

      for (const segment of segments) {
        if (segment.startMs === '' || segment.endMs === '') {
          continue;
        }
        const result = await api.contributions.addSegment(audioUploadId, {
          segmentIndex: segment.segmentIndex,
          startMs: Number(segment.startMs),
          endMs: Number(segment.endMs),
          nativeText: segment.nativeText.trim() || undefined,
          romanization: segment.romanization.trim() || undefined,
          ipa: segment.ipa.trim() || undefined,
          speakerLabel: segment.speakerLabel.trim() || undefined,
        });
        total += result.pointsAwarded ?? 0;
      }

      navigation.replace('RecordingResultScreen', { moduleType: 'TRANSCRIPTION', pointsAwarded: total });
    } catch (err) {
      setStep2Error(err instanceof Error ? err.message : 'Failed to submit transcription');
    } finally {
      setIsSubmittingStep2(false);
    }
  }

  const canUpload = !!pickedFile && !!languageId && title.trim().length > 0 && !isUploading;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text style={styles.heading}>Upload Audio</Text>
        <Text style={styles.stepIndicator}>Step {step} of 2</Text>

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {step === 1 ? (
            <>
              <TouchableOpacity style={styles.uploadBox} onPress={handlePickFile}>
                <Ionicons name="cloud-upload-outline" size={36} color={colors.inkMuted} />
                <Text style={styles.uploadBoxText}>
                  {pickedFile ? pickedFile.name : 'Tap to select an audio file'}
                </Text>
                {pickedFile ? (
                  <Text style={styles.uploadBoxSubtext}>{(pickedFile.size / (1024 * 1024)).toFixed(2)} MB</Text>
                ) : null}
              </TouchableOpacity>
              <Text style={styles.fileSizeLimit}>Maximum file size: 100MB</Text>

              <TextInput
                style={styles.input}
                placeholder="Title *"
                placeholderTextColor={colors.placeholder}
                value={title}
                onChangeText={setTitle}
              />

              <Text style={styles.fieldLabel}>Recording type</Text>
              <View style={styles.chipWrap}>
                {RECORDING_TYPES.map((option) => (
                  <TouchableOpacity
                    key={option}
                    style={[styles.chip, recordingType === option && styles.chipSelected]}
                    onPress={() => setRecordingType(option)}
                  >
                    <Text style={styles.chipText}>{option}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Language</Text>
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

              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="Description"
                placeholderTextColor={colors.placeholder}
                value={description}
                onChangeText={setDescription}
                multiline
              />
              <TextInput
                style={styles.input}
                placeholder="Location"
                placeholderTextColor={colors.placeholder}
                value={location}
                onChangeText={setLocation}
              />
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="Cultural context"
                placeholderTextColor={colors.placeholder}
                value={culturalContext}
                onChangeText={setCulturalContext}
                multiline
              />

              {!defaultLanguageId && !languageLoading && !languageId ? (
                <Text style={styles.errorText}>Set your language in Profile settings before contributing.</Text>
              ) : null}
              {step1Error ? <Text style={styles.errorText}>{step1Error}</Text> : null}

              <TouchableOpacity
                style={[styles.submitButton, !canUpload && styles.submitButtonDisabled]}
                onPress={handleUploadAndContinue}
                disabled={!canUpload}
              >
                {isUploading ? (
                  <ActivityIndicator color={colors.inkInverted} />
                ) : (
                  <Text style={styles.submitButtonText}>Upload & Continue</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.playerBar}>
                <TouchableOpacity onPress={togglePlayback}>
                  <Ionicons name={isPlaying ? 'pause-circle' : 'play-circle'} size={40} color={colors.accent} />
                </TouchableOpacity>
                <Text style={styles.playerDuration}>{recorderPlayer.mmss(Math.floor(uploadedDurationMs / 1000))}</Text>
              </View>

              <Text style={styles.sectionHeading}>Transcription</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Native text"
                placeholderTextColor={colors.placeholder}
                value={nativeText}
                onChangeText={setNativeText}
                multiline
              />
              <TextInput
                style={styles.input}
                placeholder="Romanization"
                placeholderTextColor={colors.placeholder}
                value={romanization}
                onChangeText={setRomanization}
              />
              <TextInput style={styles.input} placeholder="IPA" placeholderTextColor={colors.placeholder} value={ipa} onChangeText={setIpa} />

              <TouchableOpacity style={styles.addSegmentButton} onPress={addSegment}>
                <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
                <Text style={styles.addSegmentText}>Add Time Segments</Text>
              </TouchableOpacity>

              {segments.map((segment, index) => (
                <View key={index} style={styles.segmentCard}>
                  <View style={styles.segmentHeaderRow}>
                    <Text style={styles.segmentTitle}>Segment {index + 1}</Text>
                    <TouchableOpacity onPress={() => removeSegment(index)}>
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.segmentRow}>
                    <TextInput
                      style={[styles.input, styles.segmentInput]}
                      placeholder="Start (ms)"
                      placeholderTextColor={colors.placeholder}
                      keyboardType="numeric"
                      value={segment.startMs}
                      onChangeText={(v) => updateSegment(index, { startMs: v })}
                    />
                    <TextInput
                      style={[styles.input, styles.segmentInput]}
                      placeholder="End (ms)"
                      placeholderTextColor={colors.placeholder}
                      keyboardType="numeric"
                      value={segment.endMs}
                      onChangeText={(v) => updateSegment(index, { endMs: v })}
                    />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="Native text"
                    placeholderTextColor={colors.placeholder}
                    value={segment.nativeText}
                    onChangeText={(v) => updateSegment(index, { nativeText: v })}
                  />
                  <TextInput
                    style={styles.input}
                    placeholder="Speaker label"
                    placeholderTextColor={colors.placeholder}
                    value={segment.speakerLabel}
                    onChangeText={(v) => updateSegment(index, { speakerLabel: v })}
                  />
                </View>
              ))}

              {step2Error ? <Text style={styles.errorText}>{step2Error}</Text> : null}

              <TouchableOpacity style={styles.submitButton} onPress={handleSubmitStep2} disabled={isSubmittingStep2}>
                {isSubmittingStep2 ? <ActivityIndicator color={colors.inkInverted} /> : <Text style={styles.submitButtonText}>Submit</Text>}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  flex: {
    flex: 1,
  },
  heading: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  stepIndicator: {
    color: colors.inkMuted,
    fontSize: 13,
    paddingHorizontal: 20,
    marginTop: 4,
    marginBottom: 12,
  },
  content: {
    padding: 20,
    paddingTop: 0,
  },
  uploadBox: {
    borderWidth: 2,
    borderColor: colors.border,
    borderStyle: 'dashed',
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    marginBottom: 8,
  },
  uploadBoxText: {
    color: colors.ink,
    fontSize: 14,
    marginTop: 10,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  uploadBoxSubtext: {
    color: colors.inkMuted,
    fontSize: 12,
    marginTop: 4,
  },
  fileSizeLimit: {
    color: colors.inkMuted,
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 18,
  },
  fieldLabel: {
    color: colors.inkMuted,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  chipRow: {
    marginBottom: 14,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  chip: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginRight: 8,
  },
  chipSelected: {
    backgroundColor: colors.accent,
  },
  chipText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  input: {
    backgroundColor: colors.surfaceCard,
    color: colors.ink,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  multiline: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  textArea: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginTop: 8,
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: colors.inkInverted,
    fontSize: 16,
    fontWeight: '600',
  },
  playerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
  },
  playerDuration: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '600',
  },
  sectionHeading: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  addSegmentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
  },
  addSegmentText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '600',
  },
  segmentCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  segmentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  segmentTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  segmentRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentInput: {
    flex: 1,
  },
});
