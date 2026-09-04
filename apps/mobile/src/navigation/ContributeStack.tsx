import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ContributeHubScreen from '../screens/contribute/ContributeHubScreen';
import Module1Screen from '../screens/contribute/Module1Screen';
import Module2Screen from '../screens/contribute/Module2Screen';
import Module3Screen from '../screens/contribute/Module3Screen';
import Module4Screen from '../screens/contribute/Module4Screen';
import RecordingResultScreen from '../screens/contribute/RecordingResultScreen';

export type ContributeStackParamList = {
  ContributeHub: undefined;
  Module1Screen: undefined;
  Module2Screen: undefined;
  Module3Screen: undefined;
  Module4Screen: undefined;
  // Matches the backend's contribution_module enum exactly (WORD, TRANSCRIPTION,
  // TRANSLATION, SCENE) -- Module 2 "Upload Audio" contributions are moduleType
  // TRANSCRIPTION server-side, not "AUDIO".
  RecordingResultScreen: {
    moduleType: 'WORD' | 'TRANSCRIPTION' | 'TRANSLATION' | 'SCENE';
    pointsAwarded: number;
  };
};

const Stack = createNativeStackNavigator<ContributeStackParamList>();

export default function ContributeStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ContributeHub" component={ContributeHubScreen} />
      <Stack.Screen name="Module1Screen" component={Module1Screen} />
      <Stack.Screen name="Module2Screen" component={Module2Screen} />
      <Stack.Screen name="Module3Screen" component={Module3Screen} />
      <Stack.Screen name="Module4Screen" component={Module4Screen} />
      <Stack.Screen name="RecordingResultScreen" component={RecordingResultScreen} />
    </Stack.Navigator>
  );
}
