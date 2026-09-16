// firebase-admin v13's default export no longer carries `credential`/
// `messaging` (the old namespaced API from spec) -- those moved to the
// modular subpath imports below. Behavior is otherwise identical.
import { cert, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../db/index.js";
import { deviceTokens, users } from "../../db/schema.js";

let firebaseInitialized = false;

if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PROJECT_ID !== "placeholder") {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
  });
  firebaseInitialized = true;
}

export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<void> {
  if (!firebaseInitialized) {
    console.log(`[push] Firebase not configured, skipping push to user ${userId}: "${title}"`);
    return;
  }

  // The preference check and the token lookup don't depend on each other, so
  // they go out together -- at cross-region latency, running them in sequence
  // costs a round trip on every single notification for no reason.
  const [[user], tokens] = await Promise.all([
    db.select({ pushNotificationsEnabled: users.pushNotificationsEnabled }).from(users).where(eq(users.id, userId)).limit(1),
    db
      .select({ id: deviceTokens.id, token: deviceTokens.token })
      .from(deviceTokens)
      .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.isActive, true))),
  ]);

  if (user && !user.pushNotificationsEnabled) {
    console.log(`[push] user ${userId} has push notifications disabled, skipping: "${title}"`);
    return;
  }
  if (tokens.length === 0) return;

  // One multicast call instead of one round trip to FCM per device, and one
  // UPDATE for all the tokens FCM rejects instead of one each.
  const response = await getMessaging().sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    notification: { title, body },
    ...(data ? { data } : {}),
  });

  const staleIds: string[] = [];
  response.responses.forEach((result, i) => {
    const row = tokens[i]!;
    if (result.success) return;
    const code = (result.error as { code?: string } | undefined)?.code;
    if (code === "messaging/registration-token-not-registered") {
      staleIds.push(row.id);
    } else {
      console.error(`[push] failed to send to user ${userId} (token ${row.id}):`, result.error);
    }
  });

  if (staleIds.length > 0) {
    await db.update(deviceTokens).set({ isActive: false, updatedAt: new Date() }).where(inArray(deviceTokens.id, staleIds));
    console.log(`[push] deactivated ${staleIds.length} unregistered token(s) for user ${userId}`);
  }
  console.log(`[push] sent to user ${userId}: ${response.successCount}/${tokens.length} device(s)`);
}

export async function sendContributionVerifiedNotification(
  userId: string,
  moduleType: string,
  pointsAwarded: number,
): Promise<void> {
  return sendPushToUser(
    userId,
    "Contribution Verified! ✅",
    `Your ${moduleType.toLowerCase()} recording was verified. +${pointsAwarded} pts`,
  );
}

export async function sendBadgeEarnedNotification(userId: string, badgeName: string, badgeIcon: string): Promise<void> {
  return sendPushToUser(userId, `New Badge: ${badgeIcon} ${badgeName}`, "Keep contributing to unlock more!");
}

export async function sendLevelUpNotification(userId: string, newLevel: string): Promise<void> {
  return sendPushToUser(userId, `Level Up! You are now ${newLevel} 🎉`, "Your contribution level has increased!");
}
