import { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { NavigatorScreenParams } from '@react-navigation/native';
import Ionicons from 'react-native-vector-icons/Ionicons';
import HomeScreen from '../screens/home/HomeScreen';
import ContributeStack, { type ContributeStackParamList } from './ContributeStack';
import ReviewStack, { type ReviewStackParamList } from './ReviewStack';
import LeaderboardScreen from '../screens/leaderboard/LeaderboardScreen';
import ProfileStack, { type ProfileStackParamList } from './ProfileStack';
import { useAuthStore } from '../store/auth.store';
import { api } from '../services/api.service';

export type AppTabParamList = {
  Home: undefined;
  // NavigatorScreenParams lets a screen on another tab deep-link straight
  // into a specific nested screen, e.g.
  // navigation.navigate('Contribute', { screen: 'Module1Screen' }) from Home.
  Contribute: NavigatorScreenParams<ContributeStackParamList> | undefined;
  Review: NavigatorScreenParams<ReviewStackParamList> | undefined;
  Ranks: undefined;
  Profile: NavigatorScreenParams<ProfileStackParamList> | undefined;
};

const Tab = createBottomTabNavigator<AppTabParamList>();

const TAB_BAR_BACKGROUND = '#0F172A';
const ACTIVE_COLOR = '#2563EB';
const INACTIVE_COLOR = '#64748B';

function isGoldOrAbove(level: string | undefined): boolean {
  return level === 'GOLD' || level === 'PLATINUM';
}

export default function AppNavigator() {
  const level = useAuthStore((state) => state.user?.level);
  const canReview = isGoldOrAbove(level);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);

  useEffect(() => {
    if (!canReview) {
      setPendingReviewCount(0);
      return;
    }
    api.reviews
      .getQueue()
      .then((queue: unknown[]) => setPendingReviewCount(queue.length))
      .catch(() => {
        // Best-effort -- badge just stays at its last known value.
      });
  }, [canReview]);

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: TAB_BAR_BACKGROUND },
        tabBarActiveTintColor: ACTIVE_COLOR,
        tabBarInactiveTintColor: INACTIVE_COLOR,
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarLabel: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Contribute"
        component={ContributeStack}
        options={{
          tabBarLabel: 'Contribute',
          tabBarIcon: ({ color, size }) => <Ionicons name="mic-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Review"
        component={ReviewStack}
        options={{
          tabBarLabel: 'Review',
          tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-circle-outline" color={color} size={size} />,
          tabBarBadge: canReview && pendingReviewCount > 0 ? pendingReviewCount : undefined,
        }}
        listeners={{
          tabPress: (e) => {
            if (!canReview) {
              e.preventDefault();
              Alert.alert(
                'Keep contributing to unlock reviewing',
                'Reviewing other contributors\' submissions unlocks once you reach GOLD level.',
              );
            }
          },
        }}
      />
      <Tab.Screen
        name="Ranks"
        component={LeaderboardScreen}
        options={{
          tabBarLabel: 'Ranks',
          tabBarIcon: ({ color, size }) => <Ionicons name="trophy-outline" color={color} size={size} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileStack}
        options={{
          tabBarLabel: 'Profile',
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" color={color} size={size} />,
        }}
      />
    </Tab.Navigator>
  );
}
