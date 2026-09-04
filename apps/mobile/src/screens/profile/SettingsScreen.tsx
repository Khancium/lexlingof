import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/auth.store';
import { useAppStore, type Dialect, type Language } from '../../store/app.store';
import { api } from '../../services/api.service';

// Tracks apps/mobile/package.json's "version" field -- no expo-constants
// dependency is installed to read it at runtime, and adding one just for a
// static display string isn't worth another native-module rebuild cycle.
const APP_VERSION = '1.0.0';

type Profile = {
  displayName: string;
  language: { id: string } | null;
  dialect: { id: string } | null;
  location: { showLocation: boolean } | null;
};

export default function SettingsScreen() {
  const logout = useAuthStore((state) => state.logout);
  const updateUser = useAuthStore((state) => state.updateUser);
  const languages = useAppStore((state) => state.languages);
  const loadLanguages = useAppStore((state) => state.loadLanguages);

  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [languageId, setLanguageId] = useState<string | null>(null);
  const [dialectId, setDialectId] = useState<string | null>(null);
  const [showLocation, setShowLocation] = useState(true);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSavingName, setIsSavingName] = useState(false);

  useEffect(() => {
    loadLanguages();
    api.users
      .getMe()
      .then((profile: Profile) => {
        setDisplayName(profile.displayName);
        setLanguageId(profile.language?.id ?? null);
        setDialectId(profile.dialect?.id ?? null);
        setShowLocation(profile.location?.showLocation ?? true);
      })
      .finally(() => setLoading(false));
  }, [loadLanguages]);

  const selectedLanguage: Language | undefined = languages.find((l) => l.id === languageId);
  const selectedDialect: Dialect | undefined = selectedLanguage?.dialects.find((d) => d.id === dialectId);

  async function saveDisplayName() {
    if (displayName.trim().length < 2) return;
    setIsSavingName(true);
    try {
      await api.users.updateMe({ displayName: displayName.trim() });
      updateUser({ displayName: displayName.trim() });
    } catch {
      // Non-critical -- the field just keeps its current value on screen.
    } finally {
      setIsSavingName(false);
    }
  }

  async function toggleLocationPrivacy(value: boolean) {
    setShowLocation(value);
    try {
      await api.users.updateMe({ showLocation: value });
    } catch {
      setShowLocation(!value);
    }
  }

  async function applyLanguageDialect(newLanguageId: string, newDialectId: string | null) {
    setLanguageId(newLanguageId);
    setDialectId(newDialectId);
    setIsPickerOpen(false);
    try {
      await api.users.updateMe({ primaryLanguageId: newLanguageId, primaryDialectId: newDialectId ?? undefined });
    } catch {
      // Best-effort; the picker already reflects the attempted change.
    }
  }

  function handleSignOut() {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => logout() },
    ]);
  }

  function handleDeleteAccount() {
    Alert.alert(
      'Delete Account',
      'Account deletion isn’t available in the app yet. Please contact support to delete your account.',
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <ActivityIndicator color="#2563EB" style={styles.loader} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Text style={styles.heading}>Settings</Text>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>Language & Dialect</Text>
        <TouchableOpacity style={styles.row} onPress={() => setIsPickerOpen(true)}>
          <Text style={styles.rowLabel}>
            {selectedLanguage ? selectedLanguage.nameEnglish : 'Not set'}
            {selectedDialect ? ` · ${selectedDialect.nameEnglish}` : ''}
          </Text>
          <Text style={styles.rowAction}>Change</Text>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>Display Name</Text>
        <TextInput
          style={styles.input}
          value={displayName}
          onChangeText={setDisplayName}
          onBlur={saveDisplayName}
          placeholderTextColor="#64748B"
        />
        {isSavingName ? <ActivityIndicator color="#2563EB" style={styles.smallLoader} /> : null}

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextWrap}>
            <Text style={styles.rowLabel}>Show location on public profile</Text>
          </View>
          <Switch value={showLocation} onValueChange={toggleLocationPrivacy} trackColor={{ true: '#2563EB' }} />
        </View>

        <Text style={styles.sectionLabel}>About</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>App version</Text>
          <Text style={styles.rowValue}>{APP_VERSION}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Terms of Service</Text>
          <Text style={styles.rowValueMuted}>Coming soon</Text>
        </View>

        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutButtonText}>Sign Out</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.deleteAccountButton} onPress={handleDeleteAccount}>
          <Text style={styles.deleteAccountText}>Delete Account</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={isPickerOpen} transparent animationType="slide" onRequestClose={() => setIsPickerOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose language</Text>
            <ScrollView style={styles.sheetScroll}>
              {languages.map((language) => (
                <View key={language.id}>
                  <TouchableOpacity
                    style={[styles.pickerRow, languageId === language.id && styles.pickerRowSelected]}
                    onPress={() => applyLanguageDialect(language.id, null)}
                  >
                    <Text style={styles.pickerRowText}>{language.nameEnglish}</Text>
                  </TouchableOpacity>
                  {languageId === language.id
                    ? language.dialects.map((dialect) => (
                        <TouchableOpacity
                          key={dialect.id}
                          style={[styles.pickerRow, styles.pickerRowIndented, dialectId === dialect.id && styles.pickerRowSelected]}
                          onPress={() => applyLanguageDialect(language.id, dialect.id)}
                        >
                          <Text style={styles.pickerRowText}>{dialect.nameEnglish}</Text>
                        </TouchableOpacity>
                      ))
                    : null}
                </View>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.sheetCloseButton} onPress={() => setIsPickerOpen(false)}>
              <Text style={styles.sheetCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loader: {
    marginTop: 60,
  },
  smallLoader: {
    marginTop: -6,
    marginBottom: 10,
  },
  heading: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    paddingHorizontal: 20,
    paddingTop: 8,
    marginBottom: 14,
  },
  content: {
    padding: 20,
    paddingTop: 0,
  },
  sectionLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  rowLabel: {
    color: '#FFFFFF',
    fontSize: 14,
    flexShrink: 1,
  },
  rowAction: {
    color: '#2563EB',
    fontSize: 13,
    fontWeight: '600',
  },
  rowValue: {
    color: '#94A3B8',
    fontSize: 14,
  },
  rowValueMuted: {
    color: '#64748B',
    fontSize: 13,
  },
  input: {
    backgroundColor: '#1E293B',
    color: '#FFFFFF',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    marginBottom: 8,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1E293B',
    borderRadius: 10,
    padding: 14,
    marginTop: 20,
  },
  toggleTextWrap: {
    flex: 1,
    marginRight: 10,
  },
  signOutButton: {
    backgroundColor: '#DC2626',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 32,
  },
  signOutButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  deleteAccountButton: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  deleteAccountText: {
    color: '#64748B',
    fontSize: 12,
  },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#1E293B',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    maxHeight: '70%',
  },
  sheetTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 14,
  },
  sheetScroll: {
    marginBottom: 14,
  },
  pickerRow: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  pickerRowIndented: {
    paddingLeft: 26,
  },
  pickerRowSelected: {
    backgroundColor: '#0F172A',
  },
  pickerRowText: {
    color: '#FFFFFF',
    fontSize: 15,
  },
  sheetCloseButton: {
    backgroundColor: '#334155',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  sheetCloseText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
