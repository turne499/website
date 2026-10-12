import { track as vercelTrack } from "@vercel/analytics";

export type AnalyticsEvent =
  | "apply_click"
  | "contact_submit"
  | "mailing_list_click"
  | "instagram_click";

export type AnalyticsProperties = {
  page?: "join-us" | "contact" | "footer";
};

export function track(name: AnalyticsEvent, properties?: AnalyticsProperties) {
  if (process.env.NEXT_PUBLIC_ENABLE_ANALYTICS_EVENTS !== "true") return;
  vercelTrack(name, properties);
}
