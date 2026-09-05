import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useAuthStore } from '../../store/auth.store';
import { useAppStore, type Dialect, type Language } from '../../store/app.store';
import { api } from '../../services/api.service';
import { colors } from '../../theme/colors';

function PickerCard({
  title,
  subtitle,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[styles.card, selected && styles.cardSelected]} onPress={onPress}>
      <Text style={styles.cardTitle}>{title}</Text>
      {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
    </TouchableOpacity>
  );
}

export default function OnboardingScreen() {
  const clearJustRegistered = useAuthStore((state) => state.clearJustRegistered);
  const languages = useAppStore((state) => state.languages);
  const loadLanguages = useAppStore((state) => state.loadLanguages);

  const [languagesLoading, setLanguagesLoading] = useState(true);
  const [selectedLanguage, setSelectedLanguage] = useState<Language | null>(null);
  const [selectedDialect, setSelectedDialect] = useState<Dialect | null>(null);
  const [country, setCountry] = useState('');
  const [city, setCity] = useState('');
  const [tribe, setTribe] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLanguages()
      .catch(() => setError('Could not load languages'))
      .finally(() => setLanguagesLoading(false));
  }, [loadLanguages]);

  function selectLanguage(language: Language) {
    setSelectedLanguage(language);
    setSelectedDialect(null);
  }

  async function handleStart() {
    setIsSubmitting(true);
    setError(null);
    try {
      await api.users.updateMe({
        primaryLanguageId: selectedLanguage?.id,
        primaryDialectId: selectedDialect?.id,
        locationCountry: country.trim() || undefined,
        locationCity: city.trim() || undefined,
        tribe: tribe.trim() || undefined,
      });
      clearJustRegistered();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <TouchableOpacity style={styles.skipButton} onPress={() => clearJustRegistered()}>
        <Text style={styles.skipText}>Skip</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.heading}>Welcome to Lexlingo!</Text>
        <Text style={styles.subtitle}>Tell us about yourself to help us match you with relevant content</Text>

        <Text style={styles.sectionLabel}>Language</Text>
        {languagesLoading ? (
          <ActivityIndicator color={colors.brand} style={styles.sectionLoader} />
        ) : (
          <FlatList
            data={languages}
            keyExtractor={(item) => item.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            renderItem={({ item }) => (
              <PickerCard
                title={item.nameEnglish}
                subtitle={item.nameNative}
                selected={selectedLanguage?.id === item.id}
                onPress={() => selectLanguage(item)}
              />
            )}
          />
        )}

        {selectedLanguage && selectedLanguage.dialects.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>Dialect</Text>
            <FlatList
              data={selectedLanguage.dialects}
              keyExtractor={(item) => item.id}
              horizontal
              showsHorizontalScrollIndicator={false}
              renderItem={({ item }) => (
                <PickerCard
                  title={item.nameEnglish}
                  subtitle={item.nameNative}
                  selected={selectedDialect?.id === item.id}
                  onPress={() => setSelectedDialect(item)}
                />
              )}
            />
          </>
        ) : null}

        <Text style={styles.sectionLabel}>Location (optional)</Text>
        <TextInput
          style={styles.input}
          placeholder="Country"
          placeholderTextColor={colors.placeholder}
          value={country}
          onChangeText={setCountry}
        />
        <TextInput
          style={styles.input}
          placeholder="City"
          placeholderTextColor={colors.placeholder}
          value={city}
          onChangeText={setCity}
        />

        <Text style={styles.sectionLabel}>Tribe (optional)</Text>
        <TextInput style={styles.input} placeholder="Tribe" placeholderTextColor={colors.placeholder} value={tribe} onChangeText={setTribe} />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity style={styles.button} onPress={handleStart} disabled={isSubmitting}>
          {isSubmitting ? <ActivityIndicator color={colors.inkInverted} /> : <Text style={styles.buttonText}>Start Contributing</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  skipButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 1,
    padding: 8,
  },
  skipText: {
    color: colors.inkMuted,
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flexGrow: 1,
    padding: 24,
    paddingTop: 56,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: colors.inkMuted,
    marginBottom: 24,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 10,
    marginTop: 10,
  },
  sectionLoader: {
    marginBottom: 10,
  },
  card: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginRight: 10,
    borderWidth: 2,
    borderColor: 'transparent',
    minWidth: 120,
  },
  cardSelected: {
    borderColor: colors.brand,
  },
  cardTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: colors.inkMuted,
    fontSize: 13,
    marginTop: 2,
  },
  input: {
    backgroundColor: colors.surfaceCard,
    color: colors.ink,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.brand,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
    marginTop: 12,
  },
  buttonText: {
    color: colors.inkInverted,
    fontSize: 16,
    fontWeight: '600',
  },
});
