import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useAuthStore } from '../store/auth.store';
import AuthStack from './AuthStack';
import AppNavigator from './AppNavigator';
import OnboardingScreen from '../screens/auth/OnboardingScreen';

// TODO: swap for the real Lexlingo logo asset once one is added to the project.
function LoadingScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.logo}>Lexlingo</Text>
      <ActivityIndicator size="large" color="#2563EB" style={styles.spinner} />
    </View>
  );
}

// No NavigationContainer here -- App.tsx owns the single one for the whole
// app. (loadUser() is likewise not called here: App.tsx's AppInitializer
// calls it once at startup, above this component.)
export default function RootNavigator() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const justRegistered = useAuthStore((state) => state.justRegistered);

  // isLoading is also toggled by login()/register() while they're in
  // flight, which those screens surface as an inline button spinner -- the
  // full-screen loader below is only for the one-time bootstrap check.
  // Tracked via isLoading's own first true->false transition (rather than
  // chaining off a local loadUser() call) since loadUser() is now called by
  // AppInitializer, not by this component.
  const [hasBootstrapped, setHasBootstrapped] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setHasBootstrapped(true);
    }
  }, [isLoading]);

  if (isLoading && !hasBootstrapped) {
    return <LoadingScreen />;
  }
  if (isAuthenticated && justRegistered) {
    // Standalone, not nested in AuthStack or AppNavigator's tabs -- it only
    // needs to be shown once, right after a fresh sign-up.
    return <OnboardingScreen />;
  }
  if (isAuthenticated) {
    return <AppNavigator />;
  }
  return <AuthStack />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0F172A',
  },
  logo: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 24,
  },
  spinner: {
    marginTop: 8,
  },
});
