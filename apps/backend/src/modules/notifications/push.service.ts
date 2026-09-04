// firebase-admin v13's default export no longer carries `credential`/
// `messaging` (the old namespaced API from spec) -- those moved to the
// modular subpath imports below. Behavior is otherwise identical.
import { cert, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { and, eq } from "drizzle-orm";

import { db } from "../../db/index.js";
import { deviceTokens } from "../../db/schema.js";

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

  const tokens = await db
    .select({ id: deviceTokens.id, token: deviceTokens.token })
    .from(deviceTokens)
    .where(and(eq(deviceTokens.userId, userId), eq(deviceTokens.isActive, true)));

  for (const { id, token } of tokens) {
    try {
      await getMessaging().send({ token, notification: { title, body }, ...(data ? { data } : {}) });
      console.log(`[push] sent to user ${userId} (token ${id})`);
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code;
      if (code === "messaging/registration-token-not-registered") {
        await db.update(deviceTokens).set({ isActive: false, updatedAt: new Date() }).where(eq(deviceTokens.id, id));
        console.log(`[push] token ${id} no longer registered, deactivated`);
      } else {
        console.error(`[push] failed to send to user ${userId} (token ${id}):`, err);
      }
    }
  }
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
