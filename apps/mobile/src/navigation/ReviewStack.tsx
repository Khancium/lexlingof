import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReviewListScreen from '../screens/review/ReviewListScreen';
import ReviewDetailScreen from '../screens/review/ReviewDetailScreen';

export type ReviewQueueItem = {
  contributionId: string;
  moduleType: 'WORD' | 'TRANSCRIPTION' | 'TRANSLATION' | 'SCENE';
  status: string;
  submittedAt: string;
  contributor: { id: string; displayName: string };
  language: { id: string; code: string; nameEnglish: string } | null;
  detail: {
    // WORD
    nativeWord?: string | null;
    romanization?: string | null;
    ipa?: string | null;
    durationMs?: number | null;
    // TRANSCRIPTION
    title?: string | null;
    recordingType?: string | null;
    nativeText?: string | null;
    // TRANSLATION
    englishText?: string | null;
    // SCENE
    difficulty?: string | null;
    // Present (possibly null) for every module after the reviews.service.ts
    // getQueue() fix -- WORD/SCENE always have one, TRANSCRIPTION always has
    // one, TRANSLATION's is optional since its audio recording is optional.
    audioFileId?: string | null;
    // WORD (concept image) and SCENE (scene image), also added by that fix.
    imageUrl?: string | null;
  };
};

export type ReviewStackParamList = {
  ReviewListScreen: undefined;
  ReviewDetailScreen: { item: ReviewQueueItem };
};

const Stack = createNativeStackNavigator<ReviewStackParamList>();

export default function ReviewStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ReviewListScreen" component={ReviewListScreen} />
      <Stack.Screen name="ReviewDetailScreen" component={ReviewDetailScreen} />
    </Stack.Navigator>
  );
}
