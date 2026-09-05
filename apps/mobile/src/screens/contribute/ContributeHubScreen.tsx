import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import type { ContributeStackParamList } from '../../navigation/ContributeStack';
import { colors } from '../../theme/colors';

type Props = NativeStackScreenProps<ContributeStackParamList, 'ContributeHub'>;

const CARDS: {
  screen: keyof ContributeStackParamList;
  color: string;
  icon: string;
  title: string;
  description: string;
}[] = [
  {
    screen: 'Module1Screen',
    color: colors.brand,
    icon: 'mic',
    title: 'Record Words',
    description: 'Record individual words in your language',
  },
  {
    screen: 'Module2Screen',
    color: colors.accent,
    icon: 'cloud-upload',
    title: 'Upload Audio',
    description: 'Share existing recordings of conversations and stories',
  },
  {
    screen: 'Module3Screen',
    color: '#059669',
    icon: 'language',
    title: 'Translate Sentences',
    description: 'Translate and record English sentences',
  },
  {
    screen: 'Module4Screen',
    color: '#D97706',
    icon: 'image',
    title: 'Describe a Scene',
    description: 'Describe what you see in an image',
  },
];

export default function ContributeHubScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Contribute</Text>

        {CARDS.map((card) => (
          <TouchableOpacity
            key={card.screen}
            style={[styles.card, { borderLeftColor: card.color }]}
            onPress={() => navigation.navigate(card.screen as never)}
          >
            <Ionicons name={card.icon} size={28} color={card.color} style={styles.cardIcon} />
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardDescription}>{card.description}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.inkMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    padding: 20,
  },
  heading: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 20,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    borderLeftWidth: 5,
    padding: 16,
    marginBottom: 14,
  },
  cardIcon: {
    marginRight: 14,
  },
  cardText: {
    flex: 1,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '700',
  },
  cardDescription: {
    color: colors.inkMuted,
    fontSize: 13,
    marginTop: 4,
  },
});
