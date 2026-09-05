import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import type { ContributeStackParamList } from '../../navigation/ContributeStack';
import { colors } from '../../theme/colors';

type Props = NativeStackScreenProps<ContributeStackParamList, 'RecordingResultScreen'>;

export default function RecordingResultScreen({ navigation, route }: Props) {
  const { pointsAwarded } = route.params;
  const scale = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 5 }).start();
  }, [scale]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Ionicons name="checkmark-circle" size={96} color={colors.success} />
        </Animated.View>

        <Text style={styles.title}>Contribution Submitted!</Text>
        <Text style={styles.points}>+{pointsAwarded} points</Text>

        <View style={styles.buttonColumn}>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => navigation.popToTop()}
          >
            <Text style={styles.primaryButtonText}>Contribute More</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => navigation.getParent()?.navigate('Home')}
          >
            <Text style={styles.secondaryButtonText}>Go Home</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 24,
  },
  points: {
    color: colors.success,
    fontSize: 32,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 40,
  },
  buttonColumn: {
    width: '100%',
    gap: 12,
  },
  primaryButton: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: colors.inkInverted,
    fontSize: 16,
    fontWeight: '600',
  },
  secondaryButton: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: '600',
  },
});
