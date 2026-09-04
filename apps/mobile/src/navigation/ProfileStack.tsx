import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProfileMainScreen from '../screens/profile/ProfileMainScreen';
import ContributionHistoryScreen from '../screens/profile/ContributionHistoryScreen';
import BadgeCollectionScreen from '../screens/profile/BadgeCollectionScreen';
import SettingsScreen from '../screens/profile/SettingsScreen';

export type ProfileStackParamList = {
  ProfileMainScreen: undefined;
  ContributionHistoryScreen: undefined;
  BadgeCollectionScreen: undefined;
  SettingsScreen: undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileMainScreen" component={ProfileMainScreen} />
      <Stack.Screen name="ContributionHistoryScreen" component={ContributionHistoryScreen} />
      <Stack.Screen name="BadgeCollectionScreen" component={BadgeCollectionScreen} />
      <Stack.Screen name="SettingsScreen" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
