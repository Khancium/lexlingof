import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { api } from '../../services/api.service';
import { uploadAudioFile } from '../../services/upload.service';
import { useContributorLanguage } from '../../hooks/useContributorLanguage';
import AudioRecorder from '../../components/AudioRecorder';
import type { ContributeStackParamList } from '../../navigation/ContributeStack';

type Props = NativeStackScreenProps<ContributeStackParamList, 'Module4Screen'>;

type Scene = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
  isDaily: boolean;
  imageUrl: string | null;
};

type RecordingState = { path: string; durationMs: number; checksum: string };

const DIFFICULTY_COLOR: Record<Scene['difficulty'], string> = {
  easy: '#059669',
  medium: '#CA8A04',
  hard: '#EA580C',
  expert: '#DC2626',
};

const IMAGE_HEIGHT = Dimensions.get('window').height * 0.45;

export default function Module4Screen({ navigation }: Props) {
  const { languageId, dialectId, isLoading: languageLoading } = useContributorLanguage();

  const [scene, setScene] = useState<Scene | null>(null);
  const [loadingScene, setLoadingScene] = useState(true);
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordingState | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const loadScene = useCallback(async (excludeId?: string) => {
    setLoadingScene(true);
    setSceneError(null);
    setRecording(null);
    try {
      setScene(await api.scenes.getRandom(excludeId));
    } catch (err) {
      setScene(null);
      setSceneError(err instanceof Error ? err.message : 'No scenes available');
    } finally {
      setLoadingScene(false);
    }
  }, []);

  useEffect(() => {
    loadScene();
  }, [loadScene]);

  async function handleSubmit() {
    if (!scene || !languageId || !recording) {
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const audioFileId = await uploadAudioFile({
        localPath: recording.path,
        durationMs: recording.durationMs,
        checksumSha256: recording.checksum,
        module: 'SCENE',
      });

      const result = await api.scenes.submitContribution(scene.id, {
        audioFileId,
        durationMs: recording.durationMs,
        languageId,
        dialectId: dialectId ?? undefined,
      });

      navigation.replace('RecordingResultScreen', { moduleType: 'SCENE', pointsAwarded: result.pointsAwarded });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit scene description');
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit = !!recording && !!languageId && !isSubmitting;

  if (loadingScene) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator color="#D97706" style={styles.loader} />
      </SafeAreaView>
    );
  }

  if (sceneError || !scene) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <Text style={styles.errorText}>{sceneError ?? 'No scenes available'}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.imageWrapper}>
        {scene.imageUrl ? (
          <Image source={{ uri: scene.imageUrl }} style={styles.image} contentFit="cover" />
        ) : (
          <View style={[styles.image, styles.imagePlaceholder]} />
        )}
        <View style={[styles.difficultyBadge, { backgroundColor: DIFFICULTY_COLOR[scene.difficulty] }]}>
          <Text style={styles.difficultyBadgeText}>{scene.difficulty}</Text>
        </View>
        <Text style={styles.sceneTitle}>{scene.title}</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.instructions}>
          Describe what you see in this image in your own language. Tell us what is happening. Take as much time as
          you need.
        </Text>

        <AudioRecorder
          onRecordingComplete={(path, durationMs, checksum) => setRecording({ path, durationMs, checksum })}
          onError={(message) => setSubmitError(message)}
        />

        <Text style={styles.pointsPreview}>
          Base: 20 pts. Bonuses: longer description (60s+), today's daily scene, expert difficulty.
        </Text>

        {!languageId && !languageLoading ? (
          <Text style={styles.errorText}>Set your language in Profile settings before contributing.</Text>
        ) : null}
        {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}

        <TouchableOpacity style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]} onPress={handleSubmit} disabled={!canSubmit}>
          {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>Submit</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={styles.differentSceneButton} onPress={() => loadScene(scene.id)}>
          <Text style={styles.differentSceneText}>Different scene</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loader: {
    marginTop: 60,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
    marginHorizontal: 20,
  },
  imageWrapper: {
    height: IMAGE_HEIGHT,
    justifyContent: 'flex-end',
  },
  image: {
    ...StyleSheet.absoluteFill,
  },
  imagePlaceholder: {
    backgroundColor: '#1E293B',
  },
  difficultyBadge: {
    position: 'absolute',
    left: 16,
    bottom: 16,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  difficultyBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  sceneTitle: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    right: 0,
    textAlign: 'center',
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  content: {
    padding: 20,
  },
  instructions: {
    color: '#FFFFFF',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 16,
    textAlign: 'center',
  },
  pointsPreview: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    marginVertical: 14,
  },
  submitButton: {
    backgroundColor: '#D97706',
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
  differentSceneButton: {
    alignItems: 'center',
    paddingVertical: 14,
  },
  differentSceneText: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
  },
});
