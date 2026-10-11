jest.mock("@vercel/analytics", () => ({ track: jest.fn() }));

import { track as vercelTrack } from "@vercel/analytics";
import { track } from "@/lib/analytics";

const originalEnabled = process.env.NEXT_PUBLIC_ENABLE_ANALYTICS_EVENTS;

afterEach(() => {
  jest.clearAllMocks();
  if (originalEnabled === undefined) delete process.env.NEXT_PUBLIC_ENABLE_ANALYTICS_EVENTS;
  else process.env.NEXT_PUBLIC_ENABLE_ANALYTICS_EVENTS = originalEnabled;
});

it("does not send custom events unless enabled", () => {
  delete process.env.NEXT_PUBLIC_ENABLE_ANALYTICS_EVENTS;
  track("apply_click", { page: "join-us" });
  expect(vercelTrack).not.toHaveBeenCalled();
});

it("sends allowed event data when enabled", () => {
  process.env.NEXT_PUBLIC_ENABLE_ANALYTICS_EVENTS = "true";
  track("apply_click", { page: "join-us" });
  expect(vercelTrack).toHaveBeenCalledWith("apply_click", { page: "join-us" });
});
