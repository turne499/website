"use client";

import type { AnchorHTMLAttributes } from "react";
import { track, type AnalyticsEvent, type AnalyticsProperties } from "@/lib/analytics";

type TrackedAnchorProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "onClick"> & {
  event: AnalyticsEvent;
  eventProperties?: AnalyticsProperties;
};

export function TrackedAnchor({ event, eventProperties, ...anchorProps }: TrackedAnchorProps) {
  return <a {...anchorProps} onClick={() => track(event, eventProperties)} />;
}
