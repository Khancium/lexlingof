import { useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors } from '../theme/colors';

type Props = {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  color?: string;
  shadowColor?: string;
  textColor?: string;
  style?: StyleProp<ViewStyle>;
};

const SHADOW_HEIGHT = 4;

// The signature Duolingo button: a flat color block sitting on a solid
// darker "shadow" a few px tall. Pressing it slides the button down onto
// its shadow (shadow visually disappears) for a tactile, game-like click --
// achieved with a real Animated.View translateY rather than RN's built-in
// elevation/shadow props, which can't produce this flat, no-blur look.
export default function DuoButton({
  title,
  onPress,
  disabled,
  color = colors.brand,
  shadowColor = colors.brandDark,
  textColor = colors.inkInverted,
  style,
}: Props) {
  const translateY = useRef(new Animated.Value(0)).current;

  function pressIn() {
    Animated.timing(translateY, { toValue: SHADOW_HEIGHT, duration: 80, useNativeDriver: true }).start();
  }
  function pressOut() {
    Animated.timing(translateY, { toValue: 0, duration: 80, useNativeDriver: true }).start();
  }

  return (
    <View style={[styles.shadowLayer, { backgroundColor: disabled ? colors.border : shadowColor }, style]}>
      <Animated.View style={{ transform: [{ translateY }] }}>
        <Pressable
          onPress={onPress}
          onPressIn={pressIn}
          onPressOut={pressOut}
          disabled={disabled}
          style={[styles.button, { backgroundColor: disabled ? colors.surfaceMuted : color }]}
        >
          <Text style={[styles.text, { color: disabled ? colors.inkMuted : textColor }]}>{title.toUpperCase()}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  shadowLayer: {
    borderRadius: 16,
  },
  button: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SHADOW_HEIGHT,
    minHeight: 50,
  },
  text: {
    fontFamily: 'Nunito_800ExtraBold',
    fontSize: 16,
    letterSpacing: 0.5,
  },
});
