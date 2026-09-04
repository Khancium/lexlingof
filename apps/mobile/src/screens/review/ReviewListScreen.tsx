import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useAuthStore } from '../../store/auth.store';
import { api } from '../../services/api.service';
import { LEVEL_THRESHOLDS } from '../../utils/level';
import type { ReviewStackParamList, ReviewQueueItem } from '../../navigation/ReviewStack';
import type { AppTabParamList } from '../../navigation/AppNavigator';
import type { CompositeScreenProps } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';

type Props = CompositeScreenProps<
  NativeStackScreenProps<ReviewStackParamList, 'ReviewListScreen'>,
  BottomTabScreenProps<AppTabParamList>
>;

const FILTERS: { label: string; value: ReviewQueueItem['moduleType'] | undefined }[] = [
  { label: 'ALL', value: undefined },
  { label: 'WORD', value: 'WORD' },
  { label: 'AUDIO', value: 'TRANSCRIPTION' },
  { label: 'TRANSLATE', value: 'TRANSLATION' },
  { label: 'SCENE', value: 'SCENE' },
];

const MODULE_ICON: Record<ReviewQueueItem['moduleType'], string> = {
  WORD: 'mic',
  TRANSCRIPTION: 'cloud-upload',
  TRANSLATION: 'language',
  SCENE: 'image',
};

const MODULE_NAME: Record<ReviewQueueItem['moduleType'], string> = {
  WORD: 'Word',
  TRANSCRIPTION: 'Audio Upload',
  TRANSLATION: 'Translation',
  SCENE: 'Scene',
};

function contentPreview(item: ReviewQueueItem): string[] {
  switch (item.moduleType) {
    case 'WORD':
      return [`Word: ${item.detail.nativeWord ?? ''}`];
    case 'TRANSLATION':
      return [`EN: ${item.detail.englishText ?? ''}`, item.detail.nativeText ?? ''];
    case 'SCENE':
      return [`Scene: ${item.detail.title ?? ''} (${item.detail.difficulty ?? ''})`];
    case 'TRANSCRIPTION':
      return [`Audio: ${item.detail.title ?? ''}`];
    default:
      return [];
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function UnlockReviewAccess({ navigation, verifiedContributions }: { navigation: Props['navigation']; verifiedContributions: number }) {
  const threshold = LEVEL_THRESHOLDS.GOLD;
  const progress = Math.min(1, verifiedContributions / threshold);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.unlockContainer}>
        <Ionicons name="trophy" size={72} color="#FBBF24" />
        <Text style={styles.unlockTitle}>Unlock Review Access</Text>
        <Text style={styles.unlockSubtitle}>Review access requires GOLD level (500 verified contributions)</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
        </View>
        <Text style={styles.progressLabel}>
          {verifiedContributions} / {threshold}
        </Text>
        <Text style={styles.unlockHint}>Keep contributing to unlock!</Text>
        <TouchableOpacity
          style={styles.contributeButton}
          onPress={() => navigation.navigate('Contribute', { screen: 'ContributeHub' })}
        >
          <Text style={styles.contributeButtonText}>Contribute Now</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default function ReviewListScreen({ navigation }: Props) {
  const user = useAuthStore((state) => state.user);
  const [filter, setFilter] = useState<ReviewQueueItem['moduleType'] | undefined>(undefined);
  const [items, setItems] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canReview = user?.level === 'GOLD' || user?.level === 'PLATINUM';

  const load = useCallback(async () => {
    setError(null);
    try {
      setItems(await api.reviews.getQueue(filter));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load review queue');
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      if (!canReview) return;
      setLoading(true);
      load().finally(() => setLoading(false));
    }, [canReview, load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (!canReview) {
    return <UnlockReviewAccess navigation={navigation} verifiedContributions={user?.verifiedContributions ?? 0} />;
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Text style={styles.heading}>Review Queue</Text>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.label}
            style={[styles.filterChip, filter === f.value && styles.filterChipSelected]}
            onPress={() => setFilter(f.value)}
          >
            <Text style={styles.filterChipText}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator color="#2563EB" style={styles.loader} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.contributionId}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FFFFFF" />}
          ListEmptyComponent={<Text style={styles.emptyText}>No pending reviews. All caught up!</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('ReviewDetailScreen', { item })}>
              <View style={styles.cardTopRow}>
                <Ionicons name={MODULE_ICON[item.moduleType]} size={18} color="#FFFFFF" />
                <Text style={styles.cardModuleName}>{MODULE_NAME[item.moduleType]}</Text>
                <Text style={styles.cardDate}>{formatDate(item.submittedAt)}</Text>
              </View>
              <Text style={styles.cardContributor}>
                {item.contributor.displayName}
                {item.language ? ` · ${item.language.nameEnglish}` : ''}
              </Text>
              {contentPreview(item).map((line, i) => (
                <Text key={i} style={styles.cardPreviewText} numberOfLines={2}>
                  {line}
                </Text>
              ))}
              {item.detail.durationMs ? (
                <View style={styles.durationBadge}>
                  <Text style={styles.durationBadgeText}>{(item.detail.durationMs / 1000).toFixed(1)}s</Text>
                </View>
              ) : null}
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 8,
    marginBottom: 14,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  filterChip: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  filterChipSelected: {
    backgroundColor: '#2563EB',
  },
  filterChipText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  loader: {
    marginTop: 40,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 20,
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 40,
  },
  listContent: {
    padding: 20,
    paddingTop: 0,
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  cardModuleName: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  cardDate: {
    color: '#64748B',
    fontSize: 12,
  },
  cardContributor: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 8,
  },
  cardPreviewText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  durationBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#334155',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 8,
  },
  durationBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
  },
  unlockContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  unlockTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 20,
    textAlign: 'center',
  },
  unlockSubtitle: {
    color: '#94A3B8',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 24,
  },
  progressTrack: {
    width: '100%',
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FBBF24',
  },
  progressLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  unlockHint: {
    color: '#94A3B8',
    fontSize: 14,
    marginTop: 20,
    marginBottom: 24,
  },
  contributeButton: {
    backgroundColor: '#2563EB',
    borderRadius: 8,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  contributeButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
