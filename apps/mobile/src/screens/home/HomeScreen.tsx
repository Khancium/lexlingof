import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import LinearGradient from 'react-native-linear-gradient';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useAuthStore, type ContributorLevel } from '../../store/auth.store';
import { useAppStore } from '../../store/app.store';
import { api } from '../../services/api.service';
import { LEVEL_GRADIENT, LEVEL_THRESHOLDS, NEXT_LEVEL } from '../../utils/level';
import type { AppTabParamList } from '../../navigation/AppNavigator';
import { colors } from '../../theme/colors';

type Props = BottomTabScreenProps<AppTabParamList, 'Home'>;

type UserStats = {
  totalContributions: number;
  verifiedContributions: number;
  totalPoints: number;
  wordContributions: number;
  audioContributions: number;
  translationContributions: number;
  sceneContributionsCount: number;
  level: ContributorLevel;
};

type DailyScene = {
  id: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard' | 'expert';
};

type RecentContribution = {
  id: string;
  moduleType: 'WORD' | 'TRANSCRIPTION' | 'TRANSLATION' | 'SCENE';
  status: string;
  totalPoints: number | null;
  submittedAt: string;
};

const MODULE_ICON: Record<RecentContribution['moduleType'], string> = {
  WORD: 'mic',
  TRANSCRIPTION: 'cloud-upload',
  TRANSLATION: 'language',
  SCENE: 'image',
};

const STATUS_COLOR: Record<string, string> = {
  draft: colors.inkMuted,
  pending: colors.warning,
  under_review: colors.warning,
  verified: colors.success,
  needs_correction: colors.danger,
  rejected: colors.danger,
};

const DIFFICULTY_COLOR: Record<DailyScene['difficulty'], string> = {
  easy: colors.success,
  medium: colors.warning,
  hard: '#EA580C',
  expert: colors.danger,
};

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function HomeScreen({ navigation }: Props) {
  const user = useAuthStore((state) => state.user);
  const pendingUploadCount = useAppStore((state) => state.pendingUploadCount);

  const [stats, setStats] = useState<UserStats | null>(null);
  const [streakCount, setStreakCount] = useState(0);
  const [dailyScene, setDailyScene] = useState<DailyScene | null>(null);
  const [recent, setRecent] = useState<RecentContribution[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const [statsRes, contributionsRes] = await Promise.allSettled([
      api.users.getStats(),
      api.users.getContributions({ limit: 5 }),
    ]);

    if (statsRes.status === 'fulfilled') {
      setStats(statsRes.value.stats);
      setStreakCount(statsRes.value.streak?.currentStreak ?? 0);
    }
    if (contributionsRes.status === 'fulfilled') {
      setRecent(contributionsRes.value.items);
    }

    // Not every deployment has a daily scene configured -- treat any failure
    // as "no daily challenge today" rather than surfacing an error.
    try {
      setDailyScene(await api.scenes.getDaily());
    } catch {
      setDailyScene(null);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const level = stats?.level ?? user?.level ?? 'BRONZE';
  const verified = stats?.verifiedContributions ?? user?.verifiedContributions ?? 0;
  const nextLevel = NEXT_LEVEL[level];
  const nextThreshold = nextLevel ? LEVEL_THRESHOLDS[nextLevel] : null;
  const progress = nextThreshold ? Math.min(1, verified / nextThreshold) : 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.brand} />}
      >
        <Text style={styles.greeting}>
          {greeting()}, {user?.displayName ?? 'contributor'}
        </Text>

        {pendingUploadCount > 0 ? (
          <TouchableOpacity style={styles.pendingBanner}>
            <Ionicons name="cloud-upload-outline" size={18} color={colors.ink} />
            <Text style={styles.pendingBannerText}>
              {pendingUploadCount} recording{pendingUploadCount === 1 ? '' : 's'} pending upload. Tap to sync.
            </Text>
          </TouchableOpacity>
        ) : null}

        <LinearGradient colors={LEVEL_GRADIENT[level]} style={styles.levelCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <Text style={styles.levelName}>{level}</Text>
          <Text style={styles.levelSubtitle}>{verified} verified contributions</Text>
          {nextThreshold ? (
            <>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
              </View>
              <Text style={styles.progressLabel}>
                {verified} / {nextThreshold} for {nextLevel}
              </Text>
            </>
          ) : (
            <Text style={styles.progressLabel}>Highest level reached</Text>
          )}
        </LinearGradient>

        <View style={styles.statsRow}>
          <StatCard label="Total" value={stats?.totalContributions ?? 0} />
          <StatCard label="Verified" value={verified} />
          <StatCard label="Points" value={stats?.totalPoints ?? user?.totalPoints ?? 0} />
          <StatCard label="Streak" value={streakCount} />
        </View>

        {dailyScene ? (
          <TouchableOpacity
            style={styles.dailyCard}
            onPress={() => navigation.navigate('Contribute', { screen: 'Module4Screen' })}
          >
            <View style={styles.dailyHeaderRow}>
              <Text style={styles.dailyLabel}>Daily Challenge</Text>
              <View style={[styles.difficultyBadge, { backgroundColor: DIFFICULTY_COLOR[dailyScene.difficulty] }]}>
                <Text style={styles.difficultyBadgeText}>{dailyScene.difficulty}</Text>
              </View>
            </View>
            <Text style={styles.dailyTitle}>{dailyScene.title}</Text>
            <Text style={styles.dailyCta}>Describe this scene →</Text>
          </TouchableOpacity>
        ) : null}

        <Text style={styles.sectionHeading}>Contribute</Text>
        <View style={styles.moduleGrid}>
          <ModuleCard
            color={colors.brand}
            icon="mic"
            title="Record Words"
            description="3-second word clips"
            count={stats?.wordContributions}
            onPress={() => navigation.navigate('Contribute', { screen: 'Module1Screen' })}
          />
          <ModuleCard
            color={colors.accent}
            icon="cloud-upload"
            title="Upload Audio"
            description="Share recordings"
            count={stats?.audioContributions}
            onPress={() => navigation.navigate('Contribute', { screen: 'Module2Screen' })}
          />
          <ModuleCard
            color={colors.success}
            icon="language"
            title="Translate"
            description="English sentences"
            count={stats?.translationContributions}
            onPress={() => navigation.navigate('Contribute', { screen: 'Module3Screen' })}
          />
          <ModuleCard
            color={colors.warning}
            icon="image"
            title="Describe Scene"
            description="Picture descriptions"
            count={stats?.sceneContributionsCount}
            onPress={() => navigation.navigate('Contribute', { screen: 'Module4Screen' })}
          />
        </View>

        <Text style={styles.sectionHeading}>Recent contributions</Text>
        {recent.length === 0 ? (
          <Text style={styles.emptyText}>No contributions yet -- get started above.</Text>
        ) : (
          recent.map((item) => (
            <View key={item.id} style={styles.recentRow}>
              <Ionicons name={MODULE_ICON[item.moduleType]} size={20} color={colors.ink} style={styles.recentIcon} />
              <View style={styles.recentInfo}>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[item.status] ?? colors.inkMuted }]}>
                  <Text style={styles.statusBadgeText}>{item.status.replace('_', ' ')}</Text>
                </View>
                <Text style={styles.recentDate}>{formatDate(item.submittedAt)}</Text>
              </View>
              <Text style={styles.recentPoints}>+{item.totalPoints ?? 0}</Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ModuleCard({
  color,
  icon,
  title,
  description,
  count,
  onPress,
}: {
  color: string;
  icon: string;
  title: string;
  description: string;
  count?: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.moduleCard, { borderColor: color }]} onPress={onPress}>
      {count ? (
        <View style={[styles.moduleBadge, { backgroundColor: color }]}>
          <Text style={styles.moduleBadgeText}>{count}</Text>
        </View>
      ) : null}
      <Ionicons name={icon} size={28} color={color} />
      <Text style={styles.moduleTitle}>{title}</Text>
      <Text style={styles.moduleDescription}>{description}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 16,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FACC15',
    borderRadius: 16,
    padding: 12,
    marginBottom: 16,
  },
  pendingBannerText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
  },
  levelCard: {
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
  },
  levelName: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '800',
  },
  levelSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 14,
    marginTop: 4,
    marginBottom: 14,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#FFFFFF',
  },
  progressLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    marginTop: 8,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: '700',
  },
  statLabel: {
    color: colors.inkMuted,
    fontSize: 12,
    marginTop: 4,
  },
  dailyCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
  },
  dailyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  dailyLabel: {
    color: colors.inkMuted,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  difficultyBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  difficultyBadgeText: {
    color: colors.inkInverted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  dailyTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
  dailyCta: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '600',
  },
  sectionHeading: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 4,
  },
  moduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 20,
  },
  moduleCard: {
    width: '47%',
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    borderLeftWidth: 4,
    padding: 14,
    minHeight: 110,
  },
  moduleBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  moduleBadgeText: {
    color: colors.inkInverted,
    fontSize: 11,
    fontWeight: '700',
  },
  moduleTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '700',
    marginTop: 10,
  },
  moduleDescription: {
    color: colors.inkMuted,
    fontSize: 12,
    marginTop: 4,
  },
  emptyText: {
    color: colors.inkMuted,
    fontSize: 14,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
  },
  recentIcon: {
    marginRight: 12,
  },
  recentInfo: {
    flex: 1,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginBottom: 4,
  },
  statusBadgeText: {
    color: colors.inkInverted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize',
  },
  recentDate: {
    color: colors.inkMuted,
    fontSize: 12,
  },
  recentPoints: {
    color: colors.success,
    fontSize: 15,
    fontWeight: '700',
  },
});
