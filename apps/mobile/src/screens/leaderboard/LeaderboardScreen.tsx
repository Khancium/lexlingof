import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useAuthStore, type ContributorLevel } from '../../store/auth.store';
import { api } from '../../services/api.service';

type Period = 'all_time' | 'weekly' | 'monthly';

type LeaderboardRow = {
  rank: number;
  userId: string;
  displayName: string;
  level: ContributorLevel;
  totalPoints: number;
  verifiedContributions: number;
  currentStreak: number;
  language: { id: string; code: string; nameEnglish: string } | null;
};

const PERIOD_TABS: { label: string; value: Period }[] = [
  { label: 'ALL TIME', value: 'all_time' },
  { label: 'THIS WEEK', value: 'weekly' },
  { label: 'THIS MONTH', value: 'monthly' },
];

const RANK_COLOR: Record<number, string> = { 1: '#FBBF24', 2: '#CBD5E1', 3: '#B45309' };

const LEVEL_BADGE_COLOR: Record<ContributorLevel, string> = {
  BRONZE: '#92400E',
  SILVER: '#6B7280',
  GOLD: '#B45309',
  PLATINUM: '#6D28D9',
};

export default function LeaderboardScreen() {
  const currentUser = useAuthStore((state) => state.user);
  const [period, setPeriod] = useState<Period>('all_time');
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (forPeriod: Period) => {
    setRows(await api.leaderboard.getGlobal({ period: forPeriod, limit: 100 }));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load(period);
    }, [period, load]),
  );

  async function handleRefresh() {
    setRefreshing(true);
    await load(period);
    setRefreshing(false);
  }

  const myRow = useMemo(
    () => (currentUser ? rows.find((r) => r.userId === currentUser.id) ?? null : null),
    [rows, currentUser],
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Text style={styles.heading}>Leaderboard</Text>

      <View style={styles.periodRow}>
        {PERIOD_TABS.map((tab) => (
          <TouchableOpacity
            key={tab.value}
            style={[styles.periodTab, period === tab.value && styles.periodTabSelected]}
            onPress={() => setPeriod(tab.value)}
          >
            <Text style={[styles.periodTabText, period === tab.value && styles.periodTabTextSelected]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {myRow ? (
        <View style={styles.myRankBanner}>
          <Text style={styles.myRankText}>
            Your rank: #{myRow.rank} • {myRow.totalPoints.toLocaleString()} pts
          </Text>
        </View>
      ) : null}

      <FlatList
        data={rows}
        keyExtractor={(item) => item.userId}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FFFFFF" />}
        renderItem={({ item }) => {
          const isMe = item.userId === currentUser?.id;
          return (
            <View style={[styles.row, isMe && styles.rowHighlighted]}>
              <Text style={[styles.rankText, RANK_COLOR[item.rank] ? { color: RANK_COLOR[item.rank] } : null]}>
                #{item.rank}
              </Text>
              <View style={styles.rowMiddle}>
                <Text style={styles.displayName}>{item.displayName}</Text>
                <View style={styles.rowMeta}>
                  {item.language ? <Text style={styles.metaText}>{item.language.nameEnglish}</Text> : null}
                  <View style={[styles.levelBadge, { backgroundColor: LEVEL_BADGE_COLOR[item.level] }]}>
                    <Text style={styles.levelBadgeText}>{item.level}</Text>
                  </View>
                </View>
              </View>
              <View style={styles.rowRight}>
                <Text style={styles.pointsText}>{item.totalPoints.toLocaleString()} pts</Text>
                <View style={styles.streakRow}>
                  <Ionicons name="flame" size={14} color="#EA580C" />
                  <Text style={styles.streakText}>{item.currentStreak}</Text>
                </View>
              </View>
            </View>
          );
        }}
      />
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
  periodRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 12,
  },
  periodTab: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
  },
  periodTabSelected: {
    backgroundColor: '#2563EB',
  },
  periodTabText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '700',
  },
  periodTabTextSelected: {
    color: '#FFFFFF',
  },
  myRankBanner: {
    marginHorizontal: 20,
    backgroundColor: '#1E3A8A',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  myRankText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowHighlighted: {
    borderColor: '#2563EB',
  },
  rankText: {
    width: 40,
    color: '#94A3B8',
    fontSize: 16,
    fontWeight: '700',
  },
  rowMiddle: {
    flex: 1,
  },
  displayName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  metaText: {
    color: '#94A3B8',
    fontSize: 12,
  },
  levelBadge: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  levelBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
  },
  rowRight: {
    alignItems: 'flex-end',
  },
  pointsText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  streakText: {
    color: '#EA580C',
    fontSize: 12,
    fontWeight: '700',
  },
});
