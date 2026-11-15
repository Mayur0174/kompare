// Thin wrappers over native capabilities. Each falls back gracefully on the web.
import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

/** Native share sheet on Android/iOS, Web Share API in browsers, clipboard as a last resort. */
export async function shareLink(data: { title: string; text: string; url: string }): Promise<'shared' | 'copied' | 'cancelled'> {
  try {
    if (isNative) {
      const { Share } = await import('@capacitor/share');
      await Share.share({ ...data, dialogTitle: 'Share with' });
      return 'shared';
    }
    if (navigator.share) { await navigator.share(data); return 'shared'; }
    await navigator.clipboard.writeText(`${data.text} ${data.url}`);
    return 'copied';
  } catch {
    return 'cancelled';
  }
}

/** Asks for notification permission (Android 13+ shows the system prompt). */
export async function enableNotifications(): Promise<boolean> {
  if (!isNative) return false;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  let s = await LocalNotifications.checkPermissions();
  if (s.display !== 'granted' && s.display !== 'denied') s = await LocalNotifications.requestPermissions();
  return s.display === 'granted';
}

export async function notificationsGranted(): Promise<boolean> {
  if (!isNative) return false;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  return (await LocalNotifications.checkPermissions()).display === 'granted';
}

/** Shows system notifications (price drops). No-op on the web or without permission. */
export async function showNotifications(items: { id: number; title: string; body: string; link: string | null }[]) {
  if (!isNative || !items.length || !(await notificationsGranted())) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.schedule({
    notifications: items.map((n) => ({ id: n.id % 2_000_000_000, title: n.title, body: n.body, extra: { link: n.link } })),
  });
}

/** Tapping a system notification opens the linked screen. */
export async function onNotificationTap(open: (link: string) => void) {
  if (!isNative) return;
  const { LocalNotifications } = await import('@capacitor/local-notifications');
  await LocalNotifications.addListener('localNotificationActionPerformed', (a) => {
    const link = (a.notification.extra as { link?: string } | undefined)?.link;
    if (link) open(link);
  });
}
