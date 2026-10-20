import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import Ionicons from 'react-native-vector-icons/Ionicons';
import { useAuthStore } from '../../store/auth.store';
import type { AuthStackParamList } from '../../navigation/AuthStack';
import { colors } from '../../theme/colors';
import DuoButton from '../../components/DuoButton';
import { api } from '../../services/api.service';

type Props = NativeStackScreenProps<AuthStackParamList, 'Register'>;

type FieldErrors = {
  email?: string;
  password?: string;
  confirmPassword?: string;
};

function validate(email: string, password: string, confirmPassword: string): FieldErrors {
  const errors: FieldErrors = {};

  if (email.trim().length === 0) {
    errors.email = 'Email is required';
  }
  if (password.length < 8) {
    errors.password = 'Password must be at least 8 characters';
  }
  if (confirmPassword !== password) {
    errors.confirmPassword = 'Passwords do not match';
  }

  return errors;
}

export default function RegisterScreen({ navigation }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [termsVersion, setTermsVersion] = useState<string | null>(null);
  const [termsContent, setTermsContent] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsModalVisible, setTermsModalVisible] = useState(false);

  const register = useAuthStore((state) => state.register);
  const isLoading = useAuthStore((state) => state.isLoading);
  const error = useAuthStore((state) => state.error);

  // Fetched once up front so the exact version string is ready the moment
  // the user checks the box -- the backend re-validates this matches the
  // current version at submit time regardless (see auth.service.ts).
  useEffect(() => {
    api.terms
      .get()
      .then((t) => {
        setTermsVersion(t.version);
        setTermsContent(t.content);
      })
      .catch(() => {
        setTermsVersion(null);
      });
  }, []);

  function handleSubmit() {
    const errors = validate(email, password, confirmPassword);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }
    if (!termsAccepted || !termsVersion) {
      return;
    }

    // On success RootNavigator reactively routes to Onboarding once
    // isAuthenticated + justRegistered flip -- no explicit navigation here.
    register(email.trim(), password, termsVersion).catch(() => {
      // Surfaced via the store's `error` state below.
    });
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color={colors.ink} />
        </TouchableOpacity>

        <Text style={styles.heading}>Create Account</Text>

        <View style={styles.field}>
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.placeholder}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          {fieldErrors.email ? <Text style={styles.fieldError}>{fieldErrors.email}</Text> : null}
        </View>

        <View style={styles.field}>
          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor={colors.placeholder}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
          {fieldErrors.password ? <Text style={styles.fieldError}>{fieldErrors.password}</Text> : null}
        </View>

        <View style={styles.field}>
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            placeholderTextColor={colors.placeholder}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />
          {fieldErrors.confirmPassword ? <Text style={styles.fieldError}>{fieldErrors.confirmPassword}</Text> : null}
        </View>

        <TouchableOpacity style={styles.termsRow} onPress={() => setTermsAccepted((v) => !v)} activeOpacity={0.7}>
          <Ionicons
            name={termsAccepted ? 'checkbox' : 'square-outline'}
            size={22}
            color={termsAccepted ? colors.brand : colors.ink}
          />
          <Text style={styles.termsText}>
            I have read and agree to the{' '}
            <Text style={styles.termsLink} onPress={() => setTermsModalVisible(true)}>
              Terms and Conditions
            </Text>
          </Text>
        </TouchableOpacity>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <DuoButton
          title="Register"
          onPress={handleSubmit}
          disabled={isLoading || !termsAccepted || !termsVersion}
          style={styles.buttonSpacing}
        />
      </ScrollView>

      <Modal visible={termsModalVisible} animationType="slide" onRequestClose={() => setTermsModalVisible(false)}>
        <View style={styles.modalContainer}>
          <TouchableOpacity style={styles.backButton} onPress={() => setTermsModalVisible(false)}>
            <Ionicons name="close" size={24} color={colors.ink} />
          </TouchableOpacity>
          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalText}>{termsContent ?? 'Could not load the Terms and Conditions right now.'}</Text>
          </ScrollView>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    flexGrow: 1,
    padding: 24,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    marginBottom: 8,
  },
  heading: {
    fontSize: 26,
    fontWeight: '700',
    color: colors.ink,
    marginBottom: 24,
  },
  field: {
    marginBottom: 14,
  },
  input: {
    backgroundColor: colors.surfaceCard,
    color: colors.ink,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldError: {
    color: colors.danger,
    fontSize: 13,
    marginTop: 6,
  },
  errorText: {
    color: colors.danger,
    fontSize: 14,
    marginBottom: 14,
    textAlign: 'center',
  },
  buttonSpacing: {
    marginTop: 8,
  },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 14,
  },
  termsText: {
    flex: 1,
    fontSize: 14,
    color: colors.ink,
    lineHeight: 20,
  },
  termsLink: {
    color: colors.brand,
    fontWeight: '600',
  },
  modalContainer: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingTop: 48,
  },
  modalContent: {
    padding: 24,
  },
  modalText: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.ink,
  },
});
