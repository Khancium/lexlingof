import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../services/api.service';

type EarnedBadge = { id: string; name: string; description: string; icon: string; earnedAt: string };
type LockedBadge = { id: string; name: string; description: string; icon: string };

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BadgeCollectionScreen() {
  const [earned, setEarned] = useState<EarnedBadge[]>([]);
  const [locked, setLocked] = useState<LockedBadge[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.badges
      .getForUser()
      .then((res) => {
        setEarned(res.earned);
        setLocked(res.available);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Text style={styles.heading}>Badges</Text>

      {loading ? (
        <ActivityIndicator color="#2563EB" style={styles.loader} />
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionHeading}>Earned ({earned.length})</Text>
          <View style={styles.grid}>
            {earned.map((badge) => (
              <View key={badge.id} style={styles.card}>
                <Text style={styles.icon}>{badge.icon}</Text>
                <Text style={styles.name} numberOfLines={2}>
                  {badge.name}
                </Text>
                <Text style={styles.date}>{formatDate(badge.earnedAt)}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.sectionHeading}>Locked ({locked.length})</Text>
          <View style={styles.grid}>
            {locked.map((badge) => (
              <View key={badge.id} style={[styles.card, styles.cardLocked]}>
                <Text style={[styles.icon, styles.iconLocked]}>{badge.icon}</Text>
                <Text style={[styles.name, styles.nameLocked]} numberOfLines={2}>
                  {badge.name}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>
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
  loader: {
    marginTop: 40,
  },
  content: {
    padding: 20,
    paddingTop: 0,
  },
  sectionHeading: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
    marginTop: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: '3%',
    marginBottom: 12,
  },
  card: {
    width: '31%',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  cardLocked: {
    opacity: 0.4,
  },
  icon: {
    fontSize: 32,
    marginBottom: 8,
  },
  iconLocked: {
    opacity: 0.6,
  },
  name: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  nameLocked: {
    color: '#94A3B8',
  },
  date: {
    color: '#64748B',
    fontSize: 10,
    marginTop: 4,
  },
});
