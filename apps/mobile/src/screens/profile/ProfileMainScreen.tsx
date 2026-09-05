import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useAuthStore, type ContributorLevel } from '../../store/auth.store';
import { api } from '../../services/api.service';
import { LEVEL_GRADIENT, LEVEL_THRESHOLDS, NEXT_LEVEL } from '../../utils/level';
import type { ProfileStackParamList } from '../../navigation/ProfileStack';
import { colors } from '../../theme/colors';

type Props = NativeStackScreenProps<ProfileStackParamList, 'ProfileMainScreen'>;

type Stats = {
  totalContributions: number;
  verifiedContributions: number;
  totalPoints: number;
  wordContributions: number;
  audioContributions: number;
  translationContributions: number;
  sceneContributionsCount: number;
  level: ContributorLevel;
};

type Badge = { id: string; slug: string; name: string; description: string; icon: string; earnedAt?: string };

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

const MODULE_BAR_COLOR: Record<RecentContribution['moduleType'], string> = {
  WORD: colors.brand,
  TRANSCRIPTION: colors.accent,
  TRANSLATION: colors.success,
  SCENE: colors.warning,
};

const STATUS_COLOR: Record<string, string> = {
  draft: colors.inkMuted,
  pending: colors.warning,
  under_review: colors.warning,
  verified: colors.success,
  needs_correction: colors.danger,
  rejected: colors.danger,
};

export default function ProfileMainScreen({ navigation }: Props) {
  const user = useAuthStore((state) => state.user);
  const updateUser = useAuthStore((state) => state.updateUser);

  const [stats, setStats] = useState<Stats | null>(null);
  const [streak, setStreak] = useState(0);
  const [earnedBadges, setEarnedBadges] = useState<Badge[]>([]);
  const [totalBadgeCount, setTotalBadgeCount] = useState(0);
  const [recent, setRecent] = useState<RecentContribution[]>([]);

  const [isEditing, setIsEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [biography, setBiography] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [statsRes, badgesRes, contributionsRes] = await Promise.allSettled([
      api.users.getStats(),
      api.badges.getForUser(),
      api.users.getContributions({ limit: 5 }),
    ]);

    if (statsRes.status === 'fulfilled') {
      setStats(statsRes.value.stats);
      setStreak(statsRes.value.streak?.currentStreak ?? 0);
    }
    if (badgesRes.status === 'fulfilled') {
      setEarnedBadges(badgesRes.value.earned);
      setTotalBadgeCount(badgesRes.value.earned.length + badgesRes.value.available.length);
    }
    if (contributionsRes.status === 'fulfilled') {
      setRecent(contributionsRes.value.items);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  function startEditing() {
    setDisplayName(user?.displayName ?? '');
    setBiography('');
    setSaveError(null);
    setIsEditing(true);
  }

  async function saveProfile() {
    setIsSaving(true);
    setSaveError(null);
    try {
      await api.users.updateMe({ displayName: displayName.trim(), biography: biography.trim() || undefined });
      updateUser({ displayName: displayName.trim() });
      setIsEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save profile');
    } finally {
      setIsSaving(false);
    }
  }

  const level = stats?.level ?? user?.level ?? 'BRONZE';
  const verified = stats?.verifiedContributions ?? user?.verifiedContributions ?? 0;
  const nextLevel = NEXT_LEVEL[level];
  const nextThreshold = nextLevel ? LEVEL_THRESHOLDS[nextLevel] : null;
  const progressPct = nextThreshold ? Math.min(100, Math.round((verified / nextThreshold) * 100)) : 100;

  const moduleCounts: { module: RecentContribution['moduleType']; count: number }[] = [
    { module: 'WORD', count: stats?.wordContributions ?? 0 },
    { module: 'TRANSCRIPTION', count: stats?.audioContributions ?? 0 },
    { module: 'TRANSLATION', count: stats?.translationContributions ?? 0 },
    { module: 'SCENE', count: stats?.sceneContributionsCount ?? 0 },
  ];
  const maxModuleCount = Math.max(1, ...moduleCounts.map((m) => m.count));

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.displayName}>{user?.displayName}</Text>
          <TouchableOpacity onPress={() => navigation.navigate('SettingsScreen')}>
            <Ionicons name="settings-outline" size={24} color={colors.ink} />
          </TouchableOpacity>
        </View>

        <View style={[styles.levelBadge, { backgroundColor: LEVEL_GRADIENT[level][0] }]}>
          <Text style={styles.levelBadgeText}>{level}</Text>
        </View>

        {nextThreshold ? (
          <>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
            <Text style={styles.progressLabel}>
              {progressPct}% to {nextLevel}
            </Text>
          </>
        ) : (
          <Text style={styles.progressLabel}>Highest level reached</Text>
        )}

        <View style={styles.statsGrid}>
          <StatCell label="Total Contributions" value={stats?.totalContributions ?? 0} />
          <StatCell label="Verified" value={verified} />
          <StatCell label="Total Points" value={stats?.totalPoints ?? user?.totalPoints ?? 0} />
          <StatCell label="Current Streak" value={streak} />
        </View>

        <Text style={styles.sectionHeading}>Module breakdown</Text>
        <View style={styles.moduleBarCard}>
          {moduleCounts.map((m) => (
            <View key={m.module} style={styles.moduleBarRow}>
              <Ionicons name={MODULE_ICON[m.module]} size={14} color={colors.inkMuted} style={styles.moduleBarIcon} />
              <View style={styles.moduleBarTrack}>
                <View
                  style={[
                    styles.moduleBarFill,
                    { width: `${(m.count / maxModuleCount) * 100}%`, backgroundColor: MODULE_BAR_COLOR[m.module] },
                  ]}
                />
              </View>
              <Text style={styles.moduleBarCount}>{m.count}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionHeading}>My Badges</Text>
          <TouchableOpacity onPress={() => navigation.navigate('BadgeCollectionScreen')}>
            <Text style={styles.linkText}>See all {totalBadgeCount} badges</Text>
          </TouchableOpacity>
        </View>
        {earnedBadges.length === 0 ? (
          <Text style={styles.emptyText}>No badges earned yet.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.badgeRow}>
            {earnedBadges.map((badge) => (
              <View key={badge.id} style={styles.badgeCircleWrap}>
                <View style={styles.badgeCircle}>
                  <Text style={styles.badgeIconText}>{badge.icon}</Text>
                </View>
                <Text style={styles.badgeName} numberOfLines={1}>
                  {badge.name}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}

        <Text style={styles.sectionHeading}>Recent Activity</Text>
        {recent.length === 0 ? (
          <Text style={styles.emptyText}>No contributions yet.</Text>
        ) : (
          recent.map((item) => (
            <View key={item.id} style={styles.recentRow}>
              <Ionicons name={MODULE_ICON[item.moduleType]} size={18} color={colors.ink} />
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[item.status] ?? colors.inkMuted }]}>
                <Text style={styles.statusBadgeText}>{item.status.replace('_', ' ')}</Text>
              </View>
              <Text style={styles.recentPoints}>+{item.totalPoints ?? 0}</Text>
            </View>
          ))
        )}

        {isEditing ? (
          <View style={styles.editCard}>
            <TextInput
              style={styles.input}
              placeholder="Display name"
              placeholderTextColor={colors.placeholder}
              value={displayName}
              onChangeText={setDisplayName}
            />
            <TextInput
              style={[styles.input, styles.multiline]}
              placeholder="Biography"
              placeholderTextColor={colors.placeholder}
              value={biography}
              onChangeText={setBiography}
              multiline
            />
            {saveError ? <Text style={styles.errorText}>{saveError}</Text> : null}
            <View style={styles.editButtonRow}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setIsEditing(false)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={saveProfile} disabled={isSaving}>
                {isSaving ? <ActivityIndicator color={colors.inkInverted} /> : <Text style={styles.saveButtonText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity style={styles.editProfileButton} onPress={startEditing}>
            <Text style={styles.editProfileButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.statCell}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  displayName: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
  },
  levelBadge: {
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginBottom: 10,
  },
  levelBadgeText: {
    color: colors.inkInverted,
    fontSize: 16,
    fontWeight: '800',
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.brand,
  },
  progressLabel: {
    color: colors.inkMuted,
    fontSize: 12,
    marginTop: 6,
    marginBottom: 18,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  statCell: {
    width: '47%',
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
  },
  statValue: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
  },
  statLabel: {
    color: colors.inkMuted,
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  sectionHeading: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkText: {
    color: colors.brand,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 12,
  },
  moduleBarCard: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    padding: 14,
    marginBottom: 20,
    gap: 10,
  },
  moduleBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  moduleBarIcon: {
    width: 16,
  },
  moduleBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  moduleBarFill: {
    height: '100%',
  },
  moduleBarCount: {
    color: colors.inkMuted,
    fontSize: 12,
    width: 28,
    textAlign: 'right',
  },
  emptyText: {
    color: colors.inkMuted,
    fontSize: 13,
    marginBottom: 20,
  },
  badgeRow: {
    marginBottom: 20,
  },
  badgeCircleWrap: {
    alignItems: 'center',
    width: 76,
    marginRight: 12,
  },
  badgeCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceCard,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  badgeIconText: {
    fontSize: 24,
  },
  badgeName: {
    color: colors.ink,
    fontSize: 11,
    textAlign: 'center',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    padding: 12,
    marginBottom: 8,
  },
  statusBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    flex: 1,
  },
  statusBadgeText: {
    color: colors.inkInverted,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  recentPoints: {
    color: colors.success,
    fontSize: 14,
    fontWeight: '700',
  },
  editProfileButton: {
    marginTop: 20,
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  editProfileButtonText: {
    color: colors.inkInverted,
    fontSize: 15,
    fontWeight: '600',
  },
  editCard: {
    marginTop: 20,
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    padding: 16,
  },
  input: {
    backgroundColor: colors.surfaceMuted,
    color: colors.ink,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  multiline: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    marginBottom: 10,
  },
  editButtonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '600',
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveButtonText: {
    color: colors.inkInverted,
    fontSize: 14,
    fontWeight: '600',
  },
});
