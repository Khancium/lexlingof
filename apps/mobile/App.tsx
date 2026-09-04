import { useEffect, useRef } from 'react';
import { Alert, Platform } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AuthorizationStatus,
  getMessaging,
  getToken,
  onMessage,
  requestPermission,
} from '@react-native-firebase/messaging';
import RootNavigator from './src/navigation/RootNavigator';
import { useAuthStore } from './src/store/auth.store';
import { syncService } from './src/services/sync.service';
import { api } from './src/services/api.service';

const DEVICE_TOKEN_KEY = 'lexlingo_device_token';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60 * 1000,
    },
  },
});

function AppInitializer({ children }: { children: React.ReactNode }) {
  const loadUser = useAuthStore((state) => state.loadUser);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  const deviceTokenRef = useRef<string | null>(null);
  const hasRegisteredDeviceRef = useRef(false);

  useEffect(() => {
    loadUser();
    syncService.startNetworkListener();

    const messagingInstance = getMessaging();

    (async () => {
      try {
        const authStatus = await requestPermission(messagingInstance);
        const granted =
          authStatus === AuthorizationStatus.AUTHORIZED || authStatus === AuthorizationStatus.PROVISIONAL;

        if (granted) {
          const token = await getToken(messagingInstance);
          await AsyncStorage.setItem(DEVICE_TOKEN_KEY, token);
          deviceTokenRef.current = token;
          // isAuthenticated may already be true by the time this resolves
          // (or may still be loading) -- the effect below handles both.
          if (useAuthStore.getState().isAuthenticated) {
            registerDevice(token);
          }
        }
      } catch (err) {
        console.error('[push] Failed to set up FCM', err);
      }
    })();

    const unsubscribeOnMessage = onMessage(messagingInstance, async (remoteMessage) => {
      Alert.alert(
        remoteMessage.notification?.title ?? 'Lexlingo',
        remoteMessage.notification?.body ?? undefined,
      );
    });

    return unsubscribeOnMessage;
    // Runs once at app startup -- loadUser/startNetworkListener/FCM setup
    // are all one-time initialization, not tied to any prop/state here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function registerDevice(token: string) {
    if (hasRegisteredDeviceRef.current) {
      return;
    }
    hasRegisteredDeviceRef.current = true;
    try {
      await api.devices.register(token, Platform.OS as 'ios' | 'android');
    } catch (err) {
      hasRegisteredDeviceRef.current = false;
      console.error('[push] Failed to register device token', err);
    }
  }

  // Auth resolves asynchronously (loadUser() above) and can happen after the
  // FCM token is already obtained -- register the device as soon as both are
  // ready, in whichever order they actually finish.
  useEffect(() => {
    if (isAuthenticated && deviceTokenRef.current) {
      registerDevice(deviceTokenRef.current);
    }
  }, [isAuthenticated]);

  return <>{children}</>;
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <NavigationContainer>
            <AppInitializer>
              <RootNavigator />
            </AppInitializer>
          </NavigationContainer>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
